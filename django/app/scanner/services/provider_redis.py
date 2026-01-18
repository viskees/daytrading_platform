from __future__ import annotations

from typing import Dict, List

from scanner.services.barstore_redis import fetch_bars
from scanner.services.engine import Bar1m


def fetch_latest_bars_1m(symbols: List[str], lookback_minutes: int) -> Dict[str, List[Bar1m]]:
    # We just read the latest minute bars from Redis that the WS ingestor maintains.
    return fetch_bars(symbols, minutes=lookback_minutes)