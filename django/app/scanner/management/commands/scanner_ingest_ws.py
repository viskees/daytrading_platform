from __future__ import annotations

import asyncio
import contextlib
import inspect
import os
import time
from dataclasses import dataclass
from datetime import timezone as dt_timezone
from typing import Dict, List, Optional, Set

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

import redis
from ib_insync import IB, Stock

from scanner.models import ScannerUniverseTicker
from scanner.services.barstore_redis import delete_symbol, push_bar
from scanner.services.types import Bar1m


def _get_enabled_symbols_sync() -> List[str]:
    """
    IMPORTANT: This function is sync (ORM). Call it from async code via asyncio.to_thread().
    """
    symbols = list(
        ScannerUniverseTicker.objects.filter(enabled=True).values_list("symbol", flat=True)
    )
    return sorted({s.upper().strip() for s in symbols if s and s.strip()})


def _redis_client() -> redis.Redis:
    url = os.getenv("REDIS_URL") or "redis://redis:6379/0"
    return redis.Redis.from_url(url, decode_responses=True)


def _bar_key(sym: str) -> str:
    return f"scanner:bars:{sym.upper()}"


def _utc(ts) -> Optional[timezone.datetime]:
    if ts is None:
        return None
    if getattr(ts, "tzinfo", None) is None:
        return ts.replace(tzinfo=dt_timezone.utc)
    return ts.astimezone(dt_timezone.utc)


def _safe_task_result(task: asyncio.Task, name: str, stderr_write) -> None:
    try:
        exc = task.exception()
    except asyncio.CancelledError:
        return
    except Exception as e:
        stderr_write(f"{name} task: failed to read exception: {e!r}")
        return
    if exc:
        stderr_write(f"{name} task crashed: {exc!r}")


def _env_str(name: str, default: str) -> str:
    v = (os.getenv(name) or "").strip()
    return v or default


def _env_int(name: str, default: int) -> int:
    v = (os.getenv(name) or "").strip()
    if not v:
        return default
    try:
        return int(v)
    except ValueError:
        raise SystemExit(f"{name} must be an integer")


def _env_bool01(name: str, default: bool) -> bool:
    v = (os.getenv(name) or "").strip()
    if not v:
        return default
    return v.lower() in ("1", "true", "yes", "y", "on")


@dataclass
class Counters:
    bars: int = 0


class Command(BaseCommand):
    help = "Run a long-lived IBKR Gateway ingestor buffering 1-minute bars into Redis."

    def add_arguments(self, parser):
        parser.add_argument("--keep", type=int, default=180)
        parser.add_argument("--reconnect-delay", type=float, default=3.0)
        parser.add_argument("--universe-poll-seconds", type=float, default=10.0)
        parser.add_argument("--idle-sleep-seconds", type=float, default=5.0)
        parser.add_argument("--heartbeat-seconds", type=float, default=30.0)

        # Logging toggles (default ON, provide --no-... to disable)
        parser.add_argument("--no-log-bars", action="store_true", help="Disable BAR logs")

        # Kept for CLI compatibility; IBKR ingestor is bar-only for now
        parser.add_argument("--no-log-trades", action="store_true", help="(ignored for IBKR) kept for compatibility")
        parser.add_argument("--log-quotes", action="store_true", default=False, help="(ignored for IBKR) kept for compatibility")

        # Extra debug
        parser.add_argument("--redis-debug-seconds", type=float, default=30.0)
        parser.add_argument("--warn-no-data-seconds", type=float, default=90.0)
        parser.add_argument(
            "--write-redis-heartbeat",
            action="store_true",
            default=True,
            help="Write scanner:ingestor:heartbeat key every heartbeat (default True)",
        )

    def handle(self, *args, **opts):
        asyncio.run(self._main(**opts))

    async def _main(self, **opts):
        keep = int(opts["keep"])
        reconnect_delay = float(opts["reconnect_delay"])
        universe_poll_seconds = float(opts["universe_poll_seconds"])
        idle_sleep_seconds = float(opts["idle_sleep_seconds"])
        heartbeat_seconds = float(opts["heartbeat_seconds"])

        log_bars = not bool(opts["no_log_bars"])

        redis_debug_seconds = float(opts["redis_debug_seconds"])
        warn_no_data_seconds = float(opts["warn_no_data_seconds"])
        write_redis_heartbeat = bool(opts["write_redis_heartbeat"])

        # IBKR connection settings (compose-friendly defaults)
        ib_host = _env_str("IBKR_HOST", "ib-gateway")
        ib_port = _env_int("IBKR_PORT", 4004)  # paper default for container-to-container
        ib_client_id = _env_int("IBKR_CLIENT_ID", 101)
        ib_use_rth = _env_bool01("IBKR_USE_RTH", True)

        if bool(opts["log_quotes"]) or bool(opts["no_log_trades"]):
            self.stdout.write("Note: IBKR ingestor currently supports bars only (trade/quote flags are ignored).")

        current: Set[str] = set()

        while True:
            await asyncio.to_thread(close_old_connections)

            desired_list = await asyncio.to_thread(_get_enabled_symbols_sync)
            desired = set(desired_list)

            if not desired:
                if current:
                    self.stdout.write("Universe became empty. Clearing Redis keys.")
                    for sym in current:
                        delete_symbol(sym)
                    current = set()
                self.stdout.write("Universe empty; sleeping…")
                await asyncio.sleep(idle_sleep_seconds)
                continue

            if desired != current:
                removed = current - desired
                for sym in removed:
                    delete_symbol(sym)

                current = desired
                symbols = sorted(current)

                self.stdout.write(
                    f"(Re)connecting IBKR GW {ib_host}:{ib_port} clientId={ib_client_id} "
                    f"symbols={len(symbols)} keep={keep} hb={heartbeat_seconds:.1f}s "
                    f"universe_poll={universe_poll_seconds:.1f}s useRTH={int(ib_use_rth)} "
                    f"log_bars={log_bars}"
                )
                self.stdout.write(f"Subscribed symbols: {symbols}")

                reconnect_requested = await self._run_ibkr(
                    ib_host=ib_host,
                    ib_port=ib_port,
                    ib_client_id=ib_client_id,
                    use_rth=ib_use_rth,
                    symbols=symbols,
                    current_set=current,
                    keep=keep,
                    universe_poll_seconds=universe_poll_seconds,
                    heartbeat_seconds=heartbeat_seconds,
                    redis_debug_seconds=redis_debug_seconds,
                    warn_no_data_seconds=warn_no_data_seconds,
                    write_redis_heartbeat=write_redis_heartbeat,
                    log_bars=log_bars,
                )

                if reconnect_requested:
                    self.stdout.write("Universe changed; reconnecting with updated subscriptions…")
                    await asyncio.sleep(0.5)
                    continue

                self.stderr.write(f"IBKR stream stopped unexpectedly. Reconnecting in {reconnect_delay}s…")
                await asyncio.sleep(reconnect_delay)
                continue

            await asyncio.sleep(1)

    async def _run_ibkr(
        self,
        *,
        ib_host: str,
        ib_port: int,
        ib_client_id: int,
        use_rth: bool,
        symbols: List[str],
        current_set: Set[str],
        keep: int,
        universe_poll_seconds: float,
        heartbeat_seconds: float,
        redis_debug_seconds: float,
        warn_no_data_seconds: float,
        write_redis_heartbeat: bool,
        log_bars: bool,
    ) -> bool:
        last_bar_ts: Optional[timezone.datetime] = None
        counters = Counters()
        started = time.time()
        r = _redis_client()

        ib = IB()
        reconnect_requested = False

        last_pushed: Dict[str, Optional[timezone.datetime]] = {s: None for s in symbols}
        subscriptions: Dict[str, object] = {}

        def push_from_ib_bar(sym: str, bar) -> None:
            nonlocal last_bar_ts
            try:
                if sym not in current_set:
                    return

                ts = _utc(getattr(bar, "date", None))
                if ts is None:
                    return

                prev = last_pushed.get(sym)
                if prev is not None and ts <= prev:
                    return

                last_pushed[sym] = ts
                last_bar_ts = ts
                counters.bars += 1

                o = float(getattr(bar, "open"))
                h = float(getattr(bar, "high"))
                l = float(getattr(bar, "low"))
                c = float(getattr(bar, "close"))
                v = float(getattr(bar, "volume") or 0.0)

                if log_bars:
                    self.stdout.write(f"BAR {sym} {ts.isoformat()} O={o} H={h} L={l} C={c} V={v}")

                push_bar(sym, Bar1m(ts=ts, o=o, h=h, l=l, c=c, v=v), keep=keep)
            except Exception as e:
                self.stderr.write(f"push_from_ib_bar error {sym}: {e!r}")

        async def connect() -> None:
            """
            Robust connect:
            - retries (GW can be slow to finish apiStart)
            - uses readonly=True *if supported* to prevent order-sync spam in Read-Only API mode
            """
            sig = inspect.signature(ib.connectAsync)
            supports_readonly = "readonly" in sig.parameters

            last_err: Optional[Exception] = None
            for attempt in range(1, 6):
                try:
                    self.stdout.write(
                        f"IBKR connectAsync attempt {attempt}/5 to {ib_host}:{ib_port} clientId={ib_client_id} "
                        f"(readonly_supported={supports_readonly})…"
                    )

                    kwargs = dict(host=ib_host, port=ib_port, clientId=ib_client_id, timeout=60)
                    if supports_readonly:
                        kwargs["readonly"] = True  # THIS is what stops open/completed orders syncing.

                    await ib.connectAsync(**kwargs)

                    if ib.isConnected():
                        if supports_readonly:
                            self.stdout.write("IBKR connected (readonly=True).")
                        else:
                            self.stdout.write(
                                "IBKR connected (readonly arg not supported by this ib_insync). "
                                "If you still see order-sync spam, upgrade ib_insync."
                            )
                        return

                    last_err = RuntimeError("connectAsync finished but ib.isConnected() is False")

                except TimeoutError as e:
                    last_err = e
                except Exception as e:
                    last_err = e

                await asyncio.sleep(min(2.0 * attempt, 10.0))

            raise RuntimeError(f"IBKR connect failed after retries: {last_err!r}")

        async def disconnect() -> None:
            if ib.isConnected():
                ib.disconnect()

        async def subscribe_all() -> None:
            for sym in symbols:
                if sym not in current_set:
                    continue

                contract = Stock(sym, "SMART", "USD")
                await ib.qualifyContractsAsync(contract)

                bars = await ib.reqHistoricalDataAsync(
                    contract,
                    endDateTime="",
                    durationStr="2 D",
                    barSizeSetting="1 min",
                    whatToShow="TRADES",
                    useRTH=use_rth,
                    formatDate=1,
                    keepUpToDate=True,
                )

                def _on_update(bars_list, has_new_bar, _sym=sym):
                    if not has_new_bar or not bars_list:
                        return
                    push_from_ib_bar(_sym, bars_list[-1])

                bars.updateEvent += _on_update
                subscriptions[sym] = bars
                await asyncio.sleep(0.05)

        async def unsubscribe_all() -> None:
            for _, bars in subscriptions.items():
                try:
                    bars.updateEvent.clear()
                except Exception:
                    pass
                try:
                    ib.cancelHistoricalData(bars)
                except Exception:
                    pass
            subscriptions.clear()

        async def monitor() -> None:
            nonlocal reconnect_requested

            last_universe_check = 0.0
            last_heartbeat = 0.0
            last_redis_debug = 0.0
            last_no_data_warn = 0.0

            while True:
                try:
                    await asyncio.sleep(0.5)
                    now_m = time.time()

                    if heartbeat_seconds > 0 and now_m - last_heartbeat >= heartbeat_seconds:
                        last_heartbeat = now_m
                        lb = last_bar_ts.isoformat().replace("+00:00", "Z") if last_bar_ts else "never"
                        self.stdout.write(
                            f"Heartbeat: subscribed={len(current_set)} last_bar={lb} "
                            f"counts(bars={counters.bars}) connected={ib.isConnected()}"
                        )
                        if write_redis_heartbeat:
                            r.set("scanner:ingestor:heartbeat", timezone.now().isoformat(), ex=60)

                    if redis_debug_seconds > 0 and now_m - last_redis_debug >= redis_debug_seconds:
                        last_redis_debug = now_m
                        sample = symbols[: min(len(symbols), 5)]
                        counts = {}
                        for s in sample:
                            try:
                                counts[s] = int(r.llen(_bar_key(s)))
                            except Exception:
                                counts[s] = -1
                        self.stdout.write(f"RedisDebug: sample={sample} counts={counts}")

                    if warn_no_data_seconds > 0 and now_m - started >= warn_no_data_seconds:
                        if now_m - last_no_data_warn >= warn_no_data_seconds:
                            last_no_data_warn = now_m
                            if counters.bars == 0:
                                self.stderr.write(
                                    "No IBKR bar data received yet. Common causes: market closed, "
                                    "no market data entitlement, or GW not fully logged in."
                                )

                    if universe_poll_seconds > 0 and now_m - last_universe_check >= universe_poll_seconds:
                        last_universe_check = now_m
                        await asyncio.to_thread(close_old_connections)
                        latest_list = await asyncio.to_thread(_get_enabled_symbols_sync)
                        latest = set(latest_list)

                        if latest != current_set:
                            reconnect_requested = True
                            self.stdout.write(
                                f"UniverseChanged: old={sorted(current_set)} new={sorted(latest)} -> stopping stream"
                            )
                            return

                    if not ib.isConnected():
                        self.stderr.write("IBKR disconnected. Forcing reconnect.")
                        return

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self.stderr.write(f"monitor loop error (continuing): {e!r}")

        monitor_task: Optional[asyncio.Task] = None

        try:
            self.stdout.write("IBKR connectAsync()…")
            await connect()
            self.stdout.write("IBKR connected. Subscribing to 1-min bars…")
            await subscribe_all()

            monitor_task = asyncio.create_task(monitor())
            monitor_task.add_done_callback(lambda t: _safe_task_result(t, "monitor", self.stderr.write))
            await monitor_task

        finally:
            if monitor_task:
                monitor_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await monitor_task
            with contextlib.suppress(Exception):
                await unsubscribe_all()
            with contextlib.suppress(Exception):
                await disconnect()

        return reconnect_requested