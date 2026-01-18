from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.core.management.base import BaseCommand
from django.utils import timezone

from scanner.services.barstore_redis import push_bar
from scanner.services.types import Bar1m  # <- if you don't have this, see note below

from datetime import timezone as dt_timezone


class Command(BaseCommand):
    help = "Emit synthetic 1m bars into Redis for a symbol (for end-to-end scanner testing)."

    def add_arguments(self, parser):
        parser.add_argument("symbol", nargs="?", default="TEST")
        parser.add_argument("--n", type=int, default=8)
        parser.add_argument("--start-price", type=float, default=10.0)
        parser.add_argument("--step", type=float, default=0.12)

        # Backwards compatible: if these are not set, we fall back to start-volume behavior.
        parser.add_argument("--start-volume", type=int, default=20000)

        # NEW: deterministic “low lookback + last-bar spike”
        parser.add_argument("--flat-volume", type=int, default=None)
        parser.add_argument("--spike-volume", type=int, default=None)

        # Make the timestamps aligned on the minute
        parser.add_argument("--start-minutes-ago", type=int, default=8)

    def handle(self, *args, **opts):
        symbol = (opts["symbol"] or "TEST").upper().strip()
        n = int(opts["n"])
        start_price = float(opts["start_price"])
        step = float(opts["step"])

        start_volume = int(opts["start_volume"])
        flat_volume: Optional[int] = opts["flat_volume"]
        spike_volume: Optional[int] = opts["spike_volume"]

        # Start time = N minutes ago, aligned to minute
        now = timezone.now().astimezone(dt_timezone.utc)
        start_ts = (now - timezone.timedelta(minutes=int(opts["start_minutes_ago"]))).replace(
            second=0, microsecond=0
        )

        self.stdout.write(f"Emitting {n} synthetic 1m bars for {symbol} starting at {start_price:.2f}")

        price = start_price
        prev_close = start_price

        for i in range(n):
            ts = start_ts + timezone.timedelta(minutes=i)

            # Price path: simple upward drift
            o = prev_close
            c = o + step
            h = max(o, c) + (step * 0.5)
            l = min(o, c) - (step * 0.2)

            # Volume: either old behavior (start-volume grows), or deterministic flat+spike
            if flat_volume is not None and spike_volume is not None:
                v = float(spike_volume if i == n - 1 else flat_volume)
            else:
                # keep old behavior (growing volumes)
                v = float(start_volume * (1.2 ** i))

            push_bar(symbol, Bar1m(ts=ts, o=o, h=h, l=l, c=c, v=v), keep=180)

            self.stdout.write(
                f"  {ts.strftime('%H:%M:%S')}  O:{o:.2f} H:{h:.2f} L:{l:.2f} C:{c:.2f} V:{int(v)}"
            )

            prev_close = c

        self.stdout.write("✅ Done. Now run the engine (or wait for Celery beat) to see a trigger.")