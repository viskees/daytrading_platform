from __future__ import annotations

import asyncio
import contextlib
import os
import time
from dataclasses import dataclass
from datetime import timezone as dt_timezone
from typing import List, Optional, Set

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

import redis
from alpaca.data.enums import DataFeed
from alpaca.data.live.stock import StockDataStream

from scanner.models import ScannerUniverseTicker
from scanner.services.barstore_redis import delete_symbol, push_bar
from scanner.services.types import Bar1m


def _env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise SystemExit(f"{name} not set")
    return v


def _get_feed_enum() -> DataFeed:
    raw = (os.getenv("ALPACA_DATA_FEED") or "iex").strip().lower()
    if raw == "iex":
        return DataFeed.IEX
    if raw == "sip":
        return DataFeed.SIP
    raise SystemExit("ALPACA_DATA_FEED must be 'iex' or 'sip'")


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


@dataclass
class Counters:
    bars: int = 0
    trades: int = 0
    quotes: int = 0


class Command(BaseCommand):
    help = "Run a long-lived Alpaca WebSocket ingestor buffering 1-minute bars into Redis."

    def add_arguments(self, parser):
        parser.add_argument("--keep", type=int, default=180)
        parser.add_argument("--reconnect-delay", type=float, default=3.0)
        parser.add_argument("--universe-poll-seconds", type=float, default=10.0)
        parser.add_argument("--idle-sleep-seconds", type=float, default=5.0)
        parser.add_argument("--heartbeat-seconds", type=float, default=30.0)

        # Logging toggles (default ON, provide --no-... to disable)
        parser.add_argument("--no-log-bars", action="store_true", help="Disable BAR logs")
        parser.add_argument("--no-log-trades", action="store_true", help="Disable TRADE logs")
        parser.add_argument("--log-quotes", action="store_true", default=False, help="Enable QUOTE logs (noisy)")

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
        # Django management commands are sync; run the async loop explicitly.
        asyncio.run(self._main(**opts))

    async def _main(self, **opts):
        api_key = _env("ALPACA_API_KEY")
        api_secret = _env("ALPACA_API_SECRET")
        feed = _get_feed_enum()

        keep = int(opts["keep"])
        reconnect_delay = float(opts["reconnect_delay"])
        universe_poll_seconds = float(opts["universe_poll_seconds"])
        idle_sleep_seconds = float(opts["idle_sleep_seconds"])
        heartbeat_seconds = float(opts["heartbeat_seconds"])

        log_bars = not bool(opts["no_log_bars"])
        log_trades = not bool(opts["no_log_trades"])
        log_quotes = bool(opts["log_quotes"])

        redis_debug_seconds = float(opts["redis_debug_seconds"])
        warn_no_data_seconds = float(opts["warn_no_data_seconds"])
        write_redis_heartbeat = bool(opts["write_redis_heartbeat"])

        current: Set[str] = set()

        while True:
            # Refresh stale connections safely (in thread)
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

                feed_name = "iex" if feed == DataFeed.IEX else "sip"
                self.stdout.write(
                    f"(Re)connecting Alpaca WS ({feed_name}) symbols={len(symbols)} keep={keep} "
                    f"hb={heartbeat_seconds:.1f}s universe_poll={universe_poll_seconds:.1f}s "
                    f"log_bars={log_bars} log_trades={log_trades} log_quotes={log_quotes}"
                )
                self.stdout.write(f"Subscribed symbols: {symbols}")
                self.stdout.write(
                    f"Subscribing streams: bars={log_bars} trades={log_trades} quotes={log_quotes}"
                )

                reconnect_requested = await self._run_stream(
                    api_key=api_key,
                    api_secret=api_secret,
                    feed=feed,
                    symbols=symbols,
                    current_set=current,
                    keep=keep,
                    universe_poll_seconds=universe_poll_seconds,
                    heartbeat_seconds=heartbeat_seconds,
                    redis_debug_seconds=redis_debug_seconds,
                    warn_no_data_seconds=warn_no_data_seconds,
                    write_redis_heartbeat=write_redis_heartbeat,
                    log_bars=log_bars,
                    log_trades=log_trades,
                    log_quotes=log_quotes,
                )

                if reconnect_requested:
                    self.stdout.write("Universe changed; reconnecting with updated subscriptions…")
                    await asyncio.sleep(0.5)
                    continue

                self.stderr.write(f"Alpaca WS stopped unexpectedly. Reconnecting in {reconnect_delay}s…")
                await asyncio.sleep(reconnect_delay)
                continue

            await asyncio.sleep(1)

    async def _run_stream(
        self,
        *,
        api_key: str,
        api_secret: str,
        feed: DataFeed,
        symbols: List[str],
        current_set: Set[str],
        keep: int,
        universe_poll_seconds: float,
        heartbeat_seconds: float,
        redis_debug_seconds: float,
        warn_no_data_seconds: float,
        write_redis_heartbeat: bool,
        log_bars: bool,
        log_trades: bool,
        log_quotes: bool,
    ) -> bool:
        # timestamps
        last_bar_ts: Optional[timezone.datetime] = None
        last_trade_ts: Optional[timezone.datetime] = None
        last_quote_ts: Optional[timezone.datetime] = None

        counters = Counters()
        started = time.time()
        r = _redis_client()

        stream = StockDataStream(
            api_key=api_key,
            secret_key=api_secret,
            feed=feed,  # enum required
        )

        reconnect_requested = False

        async def on_bar(bar) -> None:
            nonlocal last_bar_ts
            try:
                sym = (getattr(bar, "symbol", "") or "").upper().strip()
                if not sym or sym not in current_set:
                    return

                ts = _utc(getattr(bar, "timestamp", None))
                if ts is None:
                    return

                last_bar_ts = ts
                counters.bars += 1

                if log_bars:
                    self.stdout.write(
                        f"BAR {sym} {ts.isoformat()} "
                        f"O={getattr(bar,'open',None)} H={getattr(bar,'high',None)} "
                        f"L={getattr(bar,'low',None)} C={getattr(bar,'close',None)} "
                        f"V={getattr(bar,'volume',None)}"
                    )

                push_bar(
                    sym,
                    Bar1m(
                        ts=ts,
                        o=float(getattr(bar, "open")),
                        h=float(getattr(bar, "high")),
                        l=float(getattr(bar, "low")),
                        c=float(getattr(bar, "close")),
                        v=float(getattr(bar, "volume")),
                    ),
                    keep=keep,
                )
            except Exception as e:
                self.stderr.write(f"on_bar error: {e!r}")

        async def on_trade(trade) -> None:
            nonlocal last_trade_ts
            try:
                sym = (getattr(trade, "symbol", "") or "").upper().strip()
                if not sym or sym not in current_set:
                    return

                ts = _utc(getattr(trade, "timestamp", None) or getattr(trade, "t", None))
                if ts:
                    last_trade_ts = ts
                counters.trades += 1

                if log_trades:
                    price = getattr(trade, "price", None) or getattr(trade, "p", None)
                    size = getattr(trade, "size", None) or getattr(trade, "s", None)
                    ts_s = ts.isoformat() if ts else "?"
                    self.stdout.write(f"TRADE {sym} {ts_s} P={price} S={size}")
            except Exception as e:
                self.stderr.write(f"on_trade error: {e!r}")

        async def on_quote(quote) -> None:
            nonlocal last_quote_ts
            try:
                sym = (getattr(quote, "symbol", "") or "").upper().strip()
                if not sym or sym not in current_set:
                    return

                ts = _utc(getattr(quote, "timestamp", None) or getattr(quote, "t", None))
                if ts:
                    last_quote_ts = ts
                counters.quotes += 1

                if log_quotes:
                    bp = getattr(quote, "bid_price", None) or getattr(quote, "bp", None)
                    ap = getattr(quote, "ask_price", None) or getattr(quote, "ap", None)
                    bs = getattr(quote, "bid_size", None) or getattr(quote, "bs", None)
                    a_s = getattr(quote, "ask_size", None) or getattr(quote, "as", None)
                    ts_s = ts.isoformat() if ts else "?"
                    self.stdout.write(f"QUOTE {sym} {ts_s} BP={bp} BS={bs} AP={ap} AS={a_s}")
            except Exception as e:
                self.stderr.write(f"on_quote error: {e!r}")

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

                    # heartbeat
                    if heartbeat_seconds > 0 and now_m - last_heartbeat >= heartbeat_seconds:
                        last_heartbeat = now_m
                        lb = last_bar_ts.isoformat().replace("+00:00", "Z") if last_bar_ts else "never"
                        lt = last_trade_ts.isoformat().replace("+00:00", "Z") if last_trade_ts else "never"
                        lq = last_quote_ts.isoformat().replace("+00:00", "Z") if last_quote_ts else "never"
                        self.stdout.write(
                            f"Heartbeat: subscribed={len(current_set)} "
                            f"last_bar={lb} last_trade={lt} last_quote={lq} "
                            f"counts(bars={counters.bars}, trades={counters.trades}, quotes={counters.quotes})"
                        )

                        if write_redis_heartbeat:
                            r.set(
                                "scanner:ingestor:heartbeat",
                                timezone.now().isoformat(),
                                ex=60,
                            )

                    # redis debug counts
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

                    # "no data yet" warning
                    if warn_no_data_seconds > 0 and now_m - started >= warn_no_data_seconds:
                        if now_m - last_no_data_warn >= warn_no_data_seconds:
                            last_no_data_warn = now_m
                            if counters.trades == 0 and counters.bars == 0:
                                self.stderr.write(
                                    "No WS data received yet (no trades, no bars). "
                                    "Common causes: market closed, IEX entitlement, symbol not trading, "
                                    "or WS not delivering events. Run REST latest-trade test inside container."
                                )

                    # universe check
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
                            stream.stop()
                            return

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self.stderr.write(f"monitor loop error (continuing): {e!r}")

        # subscribe
        if log_bars:
            stream.subscribe_bars(on_bar, *symbols)
        if log_trades:
            stream.subscribe_trades(on_trade, *symbols)
        if log_quotes:
            stream.subscribe_quotes(on_quote, *symbols)

        monitor_task = asyncio.create_task(monitor())
        monitor_task.add_done_callback(lambda t: _safe_task_result(t, "monitor", self.stderr.write))

        try:
            self.stdout.write("Alpaca stream.run() starting…")
            # alpaca stream.run() is sync -> run in a background thread
            await asyncio.to_thread(stream.run)
        finally:
            monitor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await monitor_task

        return reconnect_requested