from __future__ import annotations

import os
import time
import asyncio
from typing import List, Optional, Set

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from alpaca.data.live.stock import StockDataStream
from alpaca.data.enums import DataFeed  # <-- IMPORTANT

from scanner.models import ScannerUniverseTicker
from scanner.services.barstore_redis import delete_symbol, push_bar
from scanner.services.engine import Bar1m


class UniverseChanged(Exception):
    """Internal signal to restart websocket with updated subscriptions."""
    pass


def _get_enabled_symbols() -> List[str]:
    symbols = list(
        ScannerUniverseTicker.objects.filter(enabled=True).values_list("symbol", flat=True)
    )
    return sorted({s.upper().strip() for s in symbols if s and s.strip()})


def _env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise SystemExit(f"{name} not set")
    return v


def _get_feed_enum() -> DataFeed:
    """
    alpaca-py 0.43.x expects feed as DataFeed enum, not str.
    Env values allowed: 'iex' or 'sip' (case-insensitive).
    """
    raw = (os.getenv("ALPACA_DATA_FEED") or "iex").strip().lower()
    if raw == "iex":
        return DataFeed.IEX
    if raw == "sip":
        return DataFeed.SIP
    raise SystemExit("ALPACA_DATA_FEED must be 'iex' or 'sip'")


class Command(BaseCommand):
    help = "Run a long-lived Alpaca WebSocket ingestor buffering 1-minute bars into Redis."

    def add_arguments(self, parser):
        parser.add_argument("--keep", type=int, default=180)
        parser.add_argument("--reconnect-delay", type=float, default=3.0)
        parser.add_argument("--universe-poll-seconds", type=float, default=10.0)
        parser.add_argument("--idle-sleep-seconds", type=float, default=5.0)
        parser.add_argument("--heartbeat-seconds", type=float, default=60.0)

    def handle(self, *args, **opts):
        api_key = _env("ALPACA_API_KEY")
        api_secret = _env("ALPACA_API_SECRET")
        feed = _get_feed_enum()  # <-- enum

        keep = int(opts["keep"])
        reconnect_delay = float(opts["reconnect_delay"])
        universe_poll_seconds = float(opts["universe_poll_seconds"])
        idle_sleep_seconds = float(opts["idle_sleep_seconds"])
        heartbeat_seconds = float(opts["heartbeat_seconds"])

        current: Set[str] = set()
        last_bar_ts: Optional[timezone.datetime] = None

        while True:
            close_old_connections()

            desired = set(_get_enabled_symbols())

            if not desired:
                if current:
                    self.stdout.write("Universe became empty. Clearing Redis keys.")
                    for sym in current:
                        delete_symbol(sym)
                    current = set()
                self.stdout.write("Universe empty; sleeping…")
                time.sleep(idle_sleep_seconds)
                continue

            if desired != current:
                removed = current - desired
                for sym in removed:
                    delete_symbol(sym)

                current = desired
                symbols = sorted(current)

                # pretty log label
                feed_name = "iex" if feed == DataFeed.IEX else "sip"
                self.stdout.write(f"(Re)connecting Alpaca WS ({feed_name}) with {len(symbols)} symbols…")

                async def run_stream():
                    nonlocal last_bar_ts

                    stream = StockDataStream(
                        api_key=api_key,
                        secret_key=api_secret,
                        feed=feed,  # <-- enum, fixes the .value crash
                    )

                    last_universe_check = time.time()
                    last_heartbeat = 0.0

                    async def on_bar(bar):
                        nonlocal last_universe_check, last_heartbeat, last_bar_ts

                        now_monotonic = time.time()

                        # Heartbeat
                        if heartbeat_seconds > 0 and now_monotonic - last_heartbeat >= heartbeat_seconds:
                            last_heartbeat = now_monotonic
                            lb = last_bar_ts.isoformat().replace("+00:00", "Z") if last_bar_ts else "never"
                            self.stdout.write(f"Heartbeat: subscribed={len(current)} last_bar={lb}")

                        # Universe check
                        if now_monotonic - last_universe_check >= universe_poll_seconds:
                            last_universe_check = now_monotonic
                            latest = set(_get_enabled_symbols())
                            if latest != current:
                                raise UniverseChanged()

                        sym = (getattr(bar, "symbol", "") or "").upper().strip()
                        if not sym or sym not in current:
                            return

                        ts = getattr(bar, "timestamp", None)
                        if ts is None:
                            return

                        # Ensure UTC-aware
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        else:
                            ts = ts.astimezone(timezone.utc)

                        last_bar_ts = ts

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

                    stream.subscribe_bars(on_bar, *symbols)

                    # Run forever
                    await stream._run_forever()

                try:
                    asyncio.run(run_stream())
                except UniverseChanged:
                    self.stdout.write("Universe changed; reconnecting with updated subscriptions…")
                    time.sleep(0.5)
                    continue
                except Exception as exc:
                    self.stderr.write(
                        f"Alpaca WS crashed/disconnected: {exc!r}. Reconnecting in {reconnect_delay}s…"
                    )
                    time.sleep(reconnect_delay)
                    continue
            else:
                time.sleep(1)