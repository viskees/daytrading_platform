from __future__ import annotations

import json
from dataclasses import asdict
from typing import Iterable, List, Optional

from django.conf import settings
from django.utils import timezone
from datetime import timezone as dt_timezone

import redis

from scanner.services.types import Bar1m


def _redis() -> redis.Redis:
    url = getattr(settings, "REDIS_URL", None) or "redis://redis:6379/0"
    return redis.Redis.from_url(url, decode_responses=True)


def key_for_symbol(symbol: str) -> str:
    return f"scanner:bars:{symbol.upper()}"


def push_bar(symbol: str, bar: Bar1m, keep: int = 120) -> None:
    """
    Keep last N bars in a Redis list (newest at head).
    """
    r = _redis()
    payload = asdict(bar)
    # datetime -> iso
    payload["ts"] = bar.ts.isoformat()
    k = key_for_symbol(symbol)

    pipe = r.pipeline()
    pipe.lpush(k, json.dumps(payload))
    pipe.ltrim(k, 0, max(keep - 1, 0))
    # keep key from living forever if symbol removed later
    pipe.expire(k, 60 * 60 * 24)  # 24h
    pipe.execute()


def fetch_bars(symbols: Iterable[str], minutes: int) -> dict[str, List[Bar1m]]:
    """
    Fetch up to `minutes + 5` most recent bars per symbol (oldest-first list).
    """
    r = _redis()
    out: dict[str, List[Bar1m]] = {}

    want = max(minutes + 6, 10)

    for sym in symbols:
        k = key_for_symbol(sym)
        raw = r.lrange(k, 0, want - 1)  # newest-first
        bars: List[Bar1m] = []
        for s in reversed(raw):  # oldest-first
            try:
                d = json.loads(s)
                ts = timezone.datetime.fromisoformat(d["ts"])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=dt_timezone.utc)
                else:
                    ts = ts.astimezone(dt_timezone.utc)
                bars.append(
                    Bar1m(
                        ts=ts,
                        o=float(d["o"]),
                        h=float(d["h"]),
                        l=float(d["l"]),
                        c=float(d["c"]),
                        v=float(d["v"]),
                    )
                )
            except Exception:
                continue
        out[sym] = bars

    return out

def delete_symbol(symbol: str) -> None:
    r = _redis()
    r.delete(key_for_symbol(symbol))