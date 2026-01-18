from __future__ import annotations

from datetime import timedelta
from typing import Dict, List

from django.utils import timezone
from scanner.services.engine import Bar1m


class DataProviderError(Exception):
    pass


def fetch_latest_bars_1m(symbols: List[str], lookback_minutes: int) -> Dict[str, List[Bar1m]]:
    now = timezone.now().replace(second=0, microsecond=0)

    out: Dict[str, List[Bar1m]] = {s: [] for s in symbols}

    if "TEST" not in symbols:
        return out

    # Build 31 bars: first 30 are low volume, last one is huge volume + green candle
    bars: List[Bar1m] = []
    price = 10.00

    for i in range(lookback_minutes):
        ts = now - timedelta(minutes=(lookback_minutes - i))
        o = price
        c = price * 1.000  # flat
        h = max(o, c)
        l = min(o, c)
        v = 1000.0
        bars.append(Bar1m(ts=ts, o=o, h=h, l=l, c=c, v=v))

    # Last bar: ignition
    ts = now
    o = price
    c = price * 1.02   # +2%
    h = c
    l = o
    v = 200_000.0
    bars.append(Bar1m(ts=ts, o=o, h=h, l=l, c=c, v=v))

    out["TEST"] = bars
    return out