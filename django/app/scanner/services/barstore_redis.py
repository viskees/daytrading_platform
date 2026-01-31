from __future__ import annotations

import json
from dataclasses import asdict
from datetime import timezone as dt_timezone
from typing import Iterable, List, Optional, Tuple

from django.conf import settings
from django.utils import timezone

import redis

from scanner.services.types import Bar1m
from scanner.services.trading_day import trading_day_id

# Module-level Redis client (reused across calls)
_REDIS: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _REDIS
    if _REDIS is None:
        url = getattr(settings, "REDIS_URL", None) or "redis://redis:6379/0"
        _REDIS = redis.Redis.from_url(url, decode_responses=True)
    return _REDIS


# -----------------------------
# Bars (day-scoped)
# -----------------------------
def bars_key(symbol: str, day: str) -> str:
    return f"scanner:bars:{day}:{symbol.upper()}"


def push_bar(symbol: str, bar: Bar1m, keep: int = 120, day: Optional[str] = None) -> str:
    """
    Keep last N bars in a Redis list (newest at head), scoped to a trading day.
    Returns the Redis key used.
    """
    r = _redis()
    payload = asdict(bar)
    payload["ts"] = bar.ts.isoformat()

    d = day or trading_day_id(bar.ts)
    k = bars_key(symbol, d)
    max_i = max(keep - 1, 0)

    pipe = r.pipeline()
    pipe.lpush(k, json.dumps(payload))
    pipe.ltrim(k, 0, max_i)
    # 36h TTL so yesterday is briefly inspectable
    pipe.expire(k, 60 * 60 * 36)
    pipe.execute()
    return k


def fetch_bars(symbols: Iterable[str], minutes: int, day: str) -> dict[str, List[Bar1m]]:
    """
    Fetch up to `minutes + 6` most recent bars per symbol for a given trading day.
    Returns oldest-first list per symbol.
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
        k = bars_key(sym, day)
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
                continue
        out[sym] = bars

    return out


def fetch_all_bars(symbol: str, day: str, max_bars: int = 2000) -> List[Bar1m]:
    """
    Fetch ALL bars for symbol/day (up to max_bars), oldest-first.
    Used for self-healing HOD rebuild.
    """
    r = _redis()
    sym = symbol.upper().strip()
    if not sym:
        return []

    k = bars_key(sym, day)
    raw = r.lrange(k, 0, max_bars - 1)  # newest-first
    bars: List[Bar1m] = []

    for s in reversed(raw):
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

    return bars


# -----------------------------
# HOD state (day-scoped)
# -----------------------------
def hod_key(symbol: str, day: str) -> str:
    return f"scanner:hod:{day}:{symbol.upper()}"


def get_hod_state(symbol: str, day: str) -> Tuple[Optional[float], Optional[float], Optional[timezone.datetime]]:
    """
    Returns (hod, prev_hod, ts_utc) or (None, None, None) if missing/invalid.
    """
    r = _redis()
    sym = symbol.upper().strip()
    if not sym:
        return None, None, None

    k = hod_key(sym, day)
    raw = r.get(k)
    if not raw:
        return None, None, None

    try:
        d = json.loads(raw)
        hod = float(d.get("hod")) if d.get("hod") is not None else None
        prev = float(d.get("prev_hod")) if d.get("prev_hod") is not None else None

        ts = d.get("ts")
        if ts:
            ts_dt = timezone.datetime.fromisoformat(ts)
            if ts_dt.tzinfo is None:
                ts_dt = ts_dt.replace(tzinfo=dt_timezone.utc)
            else:
                ts_dt = ts_dt.astimezone(dt_timezone.utc)
        else:
            ts_dt = None

        return hod, prev, ts_dt
    except Exception:
        return None, None, None


def update_hod_state(symbol: str, day: str, bar_high: float, bar_ts: timezone.datetime) -> None:
    """
    Update the per-day HOD state for (day, symbol) using the new bar's high.
    Stores:
      - hod: max(previous_hod, bar_high)
      - prev_hod: previous_hod (before this bar)
      - ts: bar_ts (UTC ISO)

    Note: not strictly atomic across multiple writers; but your setup has a single ingestor stream,
    so it's sufficient. If you ever run multiple ingestors, we can switch to a Lua script.
    """
    r = _redis()
    sym = symbol.upper().strip()
    if not sym:
        return

    k = hod_key(sym, day)

    # Read existing
    hod, _prev, _ts = get_hod_state(sym, day)
    prior_hod = hod

    # Compute new
    h = float(bar_high)
    if prior_hod is None:
        new_hod = h
        prev_hod = None
    else:
        new_hod = max(float(prior_hod), h)
        prev_hod = float(prior_hod)

    payload = {
        "hod": new_hod,
        "prev_hod": prev_hod,
        "ts": bar_ts.astimezone(dt_timezone.utc).isoformat(),
    }

    # Write with TTL similar to bars
    r.set(k, json.dumps(payload), ex=60 * 60 * 36)


def rebuild_hod_state_from_bars(symbol: str, day: str) -> Tuple[Optional[float], Optional[float], Optional[timezone.datetime]]:
    """
    Self-healing: rebuild hod state from today's full bar list.
    We compute:
      - hod: max(highs over all bars)
      - prev_hod: max(highs over all bars except last)  (for broke_hod correctness)
      - ts: last bar ts
    Then we store it in Redis and return it.
    """
    bars = fetch_all_bars(symbol, day)
    if not bars:
        return None, None, None

    last = bars[-1]
    hod = float(max(b.h for b in bars))
    prev_hod = float(max(b.h for b in bars[:-1])) if len(bars) >= 2 else None
    ts = last.ts

    # Store it
    r = _redis()
    sym = symbol.upper().strip()
    if sym:
        k = hod_key(sym, day)
        payload = {
            "hod": hod,
            "prev_hod": prev_hod,
            "ts": ts.astimezone(dt_timezone.utc).isoformat(),
        }
        r.set(k, json.dumps(payload), ex=60 * 60 * 36)

    return hod, prev_hod, ts


def delete_symbol(symbol: str) -> int:
    """
    Delete all bar keys + hod keys for this symbol across all days.
    Returns number of keys deleted.
    """
    r = _redis()
    sym = symbol.upper().strip()
    if not sym:
        return 0

    patterns = [
        f"scanner:bars:*:{sym}",
        f"scanner:hod:*:{sym}",
    ]

    keys: List[str] = []
    for pat in patterns:
        keys.extend(list(r.scan_iter(match=pat, count=500)))

    if not keys:
        return 0
    return int(r.delete(*keys))