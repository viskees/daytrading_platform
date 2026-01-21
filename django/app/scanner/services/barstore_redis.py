from __future__ import annotations

import json
from dataclasses import asdict
from datetime import timezone as dt_timezone
from typing import Iterable, List

from django.conf import settings
from django.utils import timezone

import redis

from scanner.services.types import Bar1m

# Module-level Redis client (reused across calls)
_REDIS: redis.Redis | None = None


def _redis() -> redis.Redis:
    """
    Return a cached Redis client. redis-py will still manage a connection pool
    internally, but caching the client avoids repeated construction overhead.
    """
    global _REDIS
    if _REDIS is None:
        url = getattr(settings, "REDIS_URL", None) or "redis://redis:6379/0"
        _REDIS = redis.Redis.from_url(url, decode_responses=True)
    return _REDIS


def key_for_symbol(symbol: str) -> str:
    return f"scanner:bars:{symbol.upper()}"


def push_bar(symbol: str, bar: Bar1m, keep: int = 120) -> None:
    """
    Keep last N bars in a Redis list (newest at head).
    """
    r = _redis()
    payload = asdict(bar)
    payload["ts"] = bar.ts.isoformat()

    k = key_for_symbol(symbol)
    max_i = max(keep - 1, 0)

    # pipeline makes LPUSH + LTRIM + EXPIRE one round-trip
    pipe = r.pipeline()
    pipe.lpush(k, json.dumps(payload))
    pipe.ltrim(k, 0, max_i)
    pipe.expire(k, 60 * 60 * 24)  # 24h TTL
    pipe.execute()


def fetch_bars(symbols: Iterable[str], minutes: int) -> dict[str, List[Bar1m]]:
    """
    Fetch up to `minutes + 6` most recent bars per symbol.
    Returns oldest-first list per symbol.

    Storage is newest-first in Redis (LPUSH). We reverse for consumers.
    Uses a pipeline for performance when fetching many symbols.
    """
    r = _redis()
    out: dict[str, List[Bar1m]] = {}

    want = max(minutes + 6, 10)
    syms = [s.upper().strip() for s in symbols if s and s.strip()]

    if not syms:
        return out

    pipe = r.pipeline()
    keys: list[tuple[str, str]] = []
    for sym in syms:
        k = key_for_symbol(sym)
        keys.append((sym, k))
        pipe.lrange(k, 0, want - 1)  # newest-first

    results = pipe.execute()

    for (sym, _k), raw in zip(keys, results):
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
                # Skip malformed entries (best-effort)
                continue

        out[sym] = bars

    return out


def delete_symbol(symbol: str) -> None:
    r = _redis()
    r.delete(key_for_symbol(symbol))