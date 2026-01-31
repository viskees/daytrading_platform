from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from django.utils import timezone

from scanner.models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings
from scanner.serializers import ScannerTriggerEventSerializer
from scanner.services.barstore_redis import fetch_bars, get_hod_state, rebuild_hod_state_from_bars
from scanner.services.realtime import publish_hotlist_to_users, publish_trigger_event_to_users
from scanner.services.trading_day import current_trading_day_id
from scanner.services.types import Bar1m


# --- MVP-professional rVol baselines (pure intraday, day-scoped bars) ---
# 1m rVol baseline: 30–60 minutes (pick 45 as a stable default)
RVOL_1M_BASELINE_MINUTES_DEFAULT = 45
# 5m rVol baseline: 60–120 minutes (pick 90 as a stable default)
RVOL_5M_BASELINE_MINUTES_DEFAULT = 90


@dataclass(frozen=True)
class Metrics:
    symbol: str
    bar: Bar1m
    vol_1m: float
    vol_5m: float
    avg_vol_1m_lookback: float
    rvol_1m: float
    rvol_5m: float
    pct_change_1m: float
    pct_change_5m: float
    hod: float
    broke_hod: bool
    score: float
    reason_tags: List[str]


def _avg(values: List[float]) -> float:
    if not values:
        return 0.0
    return float(sum(values) / max(len(values), 1))


def compute_metrics(
    symbol: str,
    bars: List[Bar1m],
    lookback_minutes: int,
    hod: float,
    prior_hod: Optional[float],
) -> Optional[Tuple[Metrics, Dict]]:
    """
    bars: assumed oldest-first input.
    returns Metrics for the last bar.
    """
    if not bars:
        return None

    # Require at least 6 bars to compute 5m change cleanly
    if len(bars) < 6:
        return None

    last = bars[-1]
    prev = bars[-2]
    last5 = bars[-5:]  # last 5 bars
    prev5 = bars[-6]   # 5 minutes ago close

    vol_1m = float(last.v)
    vol_5m = float(sum(b.v for b in last5))

    # -----------------------------
    # rVol baselines (pure intraday)
    # -----------------------------
    # Your config field rvol_lookback_minutes is currently used as a generic lookback.
    # For #4 we keep it, but apply trader-grade defaults for 1m vs 5m baselines.
    #
    # If you later want them configurable, we can add fields to ScannerConfig:
    #   rvol_1m_baseline_minutes, rvol_5m_baseline_minutes
    #
    base_1m = int(max(5, RVOL_1M_BASELINE_MINUTES_DEFAULT))
    base_5m = int(max(10, RVOL_5M_BASELINE_MINUTES_DEFAULT))

    # Exclude the last bar from baseline to avoid self-inflation
    # 1m baseline slice: last base_1m bars (excluding current)
    avail_excl_last = len(bars) - 1
    lb_1m = min(base_1m, avail_excl_last)
    slice_1m = bars[-(lb_1m + 1):-1] if lb_1m > 0 else []
    avg_vol_1m = _avg([float(b.v) for b in slice_1m])

    # 5m baseline:
    # compute rolling 5-bar sums over the baseline window (excluding any window that includes the current bar)
    # Need at least 5 bars to compute a single 5m sum.
    # We'll use up to base_5m minutes of data excluding the current bar.
    lb_5m = min(base_5m, avail_excl_last)
    slice_5m = bars[-(lb_5m + 1):-1] if lb_5m > 0 else []

    rolling_5m_sums: List[float] = []
    if len(slice_5m) >= 5:
        # build rolling sums over the slice (oldest-first)
        vols = [float(b.v) for b in slice_5m]
        # rolling window sum length 5
        w = 5
        running = sum(vols[:w])
        rolling_5m_sums.append(float(running))
        for i in range(w, len(vols)):
            running += vols[i] - vols[i - w]
            rolling_5m_sums.append(float(running))

    avg_vol_5m = _avg(rolling_5m_sums)

    # Avoid divide by zero (use 1.0 floor)
    rvol_1m = vol_1m / max(avg_vol_1m, 1.0)
    rvol_5m = vol_5m / max(avg_vol_5m, 1.0)

    # -----------------------------
    # Price changes
    # -----------------------------
    pct_change_1m = (last.c - prev.c) / max(prev.c, 1e-9) * 100.0
    pct_change_5m = (last.c - prev5.c) / max(prev5.c, 1e-9) * 100.0

    # -----------------------------
    # HOD from Redis (day-scoped)
    # -----------------------------
    hod = float(hod or 0.0)
    ph = prior_hod

    if ph is None:
        # Best-effort fallback: approximate from available bars excluding last
        try:
            ph = float(max(b.h for b in bars[:-1])) if len(bars) >= 2 else None
        except Exception:
            ph = None

    broke_hod = bool(ph is not None and float(last.h) > float(ph))

    # -----------------------------
    # Basic score (tune later)
    # -----------------------------
    score = 0.0
    score += min(rvol_1m, 20.0) * 5.0
    score += min(max(pct_change_1m, 0.0), 10.0) * 4.0
    if broke_hod:
        score += 20.0

    reason_tags: List[str] = []
    if rvol_1m >= 1.0:
        reason_tags.append("RVOL_1M")
    if rvol_5m >= 1.0:
        reason_tags.append("RVOL_5M")
    if pct_change_1m >= 0.0:
        reason_tags.append("UP_1M")
    if broke_hod:
        reason_tags.append("HOD_BREAK")

    m = Metrics(
        symbol=symbol,
        bar=last,
        vol_1m=vol_1m,
        vol_5m=vol_5m,
        avg_vol_1m_lookback=float(avg_vol_1m),  # keep field meaning coherent
        rvol_1m=rvol_1m,
        rvol_5m=rvol_5m,
        pct_change_1m=pct_change_1m,
        pct_change_5m=pct_change_5m,
        hod=hod,
        broke_hod=broke_hod,
        score=score,
        reason_tags=reason_tags,
    )
    return m, {}


def should_trigger(m: Metrics, cfg: ScannerConfig) -> Tuple[bool, List[str]]:
    """
    Apply your MVP trigger rules.
    """
    tags: List[str] = []
    if m.vol_1m < cfg.min_vol_1m:
        return False, tags

    # rvol thresholds
    if m.rvol_1m < cfg.rvol_1m_threshold and m.rvol_5m < cfg.rvol_5m_threshold:
        return False, tags

    # price confirmation
    price_ok = (m.pct_change_1m >= cfg.min_pct_change_1m) or (m.pct_change_5m >= cfg.min_pct_change_5m)
    if cfg.require_hod_break:
        price_ok = price_ok and m.broke_hod
    if not price_ok:
        return False, tags

    if cfg.require_green_candle and not (m.bar.c >= m.bar.o):
        return False, tags

    # Build reason tags that explain the decision
    if m.rvol_1m >= cfg.rvol_1m_threshold:
        tags.append("RVOL_1M_THR")
    if m.rvol_5m >= cfg.rvol_5m_threshold:
        tags.append("RVOL_5M_THR")
    if m.pct_change_1m >= cfg.min_pct_change_1m:
        tags.append("PCT_1M_THR")
    if m.pct_change_5m >= cfg.min_pct_change_5m:
        tags.append("PCT_5M_THR")
    if m.broke_hod:
        tags.append("HOD_BREAK")

    return True, tags


def in_cooldown(symbol: str, now: datetime, cooldown_minutes: int) -> bool:
    cutoff = now - timedelta(minutes=cooldown_minutes)
    return ScannerTriggerEvent.objects.filter(symbol=symbol, triggered_at__gte=cutoff).exists()


def allow_trigger_with_cooldown(m: Metrics, cfg: ScannerConfig, now: datetime) -> bool:
    """
    Cooldown gate with optional 'realert on new HOD' override.
    """
    cutoff = now - timedelta(minutes=cfg.cooldown_minutes)

    last_ev: Optional[ScannerTriggerEvent] = (
        ScannerTriggerEvent.objects
        .filter(symbol=m.symbol)
        .order_by("-triggered_at")
        .only("id", "triggered_at", "hod")
        .first()
    )

    if not last_ev:
        return True

    if last_ev.triggered_at < cutoff:
        return True

    if not cfg.realert_on_new_hod:
        return False

    try:
        last_hod = float(last_ev.hod or 0.0)
    except Exception:
        last_hod = 0.0

    return float(m.hod or 0.0) > last_hod


def _dedupe_tags(tags: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for t in tags:
        if not t:
            continue
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _hot_item(m: Metrics) -> Dict[str, object]:
    """
    Lean websocket row for the HOT5 table.
    Keep it minimal and stable for the frontend.
    """
    hod_distance_pct: Optional[float] = None
    try:
        last_price = float(m.bar.c)
        hod = float(m.hod or 0.0)
        if abs(last_price) >= 1e-9 and hod > 0.0:
            hod_distance_pct = (hod - last_price) / last_price * 100.0
    except Exception:
        hod_distance_pct = None

    try:
        bar_ts = m.bar.ts.isoformat()
    except Exception:
        bar_ts = ""

    return {
        "symbol": m.symbol,
        "score": float(m.score),
        "last_price": float(m.bar.c),
        "pct_change_1m": float(m.pct_change_1m),
        "pct_change_5m": float(m.pct_change_5m),
        "rvol_1m": float(m.rvol_1m),
        "rvol_5m": float(m.rvol_5m),
        "vol_1m": float(m.vol_1m),
        "vol_5m": float(m.vol_5m),
        "hod": float(m.hod),
        "hod_distance_pct": hod_distance_pct,
        "broke_hod": bool(m.broke_hod),
        "bar_ts": bar_ts,
        "reason_tags": list(m.reason_tags or []),
    }


def run_engine_once(now: Optional[datetime] = None) -> int:
    """
    Run one full scanner pass over the universe using bars buffered in Redis.
    Returns number of trigger events created.
    """
    now = now or timezone.now()

    cfg, _ = ScannerConfig.objects.get_or_create(id=1)
    if not cfg.enabled:
        return 0

    symbols = list(ScannerUniverseTicker.objects.filter(enabled=True).values_list("symbol", flat=True))
    symbols = [s.upper().strip() for s in symbols if s and s.strip()]
    if not symbols:
        return 0

    day = current_trading_day_id(now)
    bars_map = fetch_bars(symbols, minutes=cfg.rvol_lookback_minutes, day=day)

    follower_ids = list(
        UserScannerSettings.objects.filter(follow_alerts=True).values_list("user_id", flat=True)
    )
    live_feed_user_ids = list(
        UserScannerSettings.objects.filter(live_feed_enabled=True).values_list("user_id", flat=True)
    )

    created = 0
    all_metrics: List[Metrics] = []

    for sym in symbols:
        bars = bars_map.get(sym) or []

        # Need enough bars for 5m logic
        if len(bars) < 6:
            continue

        # --- HOD state (fast path) ---
        hod, prev_hod, hod_ts = get_hod_state(sym, day)

        # --- Self-heal if missing or stale ---
        last_ts = bars[-1].ts if bars else None
        needs_rebuild = (
            hod is None
            or hod_ts is None
            or (last_ts is not None and hod_ts is not None and last_ts > hod_ts)
        )
        if needs_rebuild:
            hod, prev_hod, hod_ts = rebuild_hod_state_from_bars(sym, day)

        if hod is None:
            continue

        res = compute_metrics(
            sym,
            bars,
            lookback_minutes=cfg.rvol_lookback_minutes,
            hod=float(hod),
            prior_hod=prev_hod,
        )
        if not res:
            continue

        m, _extra = res
        all_metrics.append(m)

        # --- Trigger logic ---
        if not allow_trigger_with_cooldown(m, cfg, now):
            continue

        ok, decision_tags = should_trigger(m, cfg)
        if not ok:
            continue

        ev = ScannerTriggerEvent.objects.create(
            symbol=sym,
            triggered_at=now,
            reason_tags=_dedupe_tags(decision_tags + (m.reason_tags or [])),

            o=m.bar.o, h=m.bar.h, l=m.bar.l, c=m.bar.c, v=m.bar.v,
            last_price=m.bar.c,

            vol_1m=m.vol_1m,
            vol_5m=m.vol_5m,

            avg_vol_1m_lookback=m.avg_vol_1m_lookback,
            rvol_1m=m.rvol_1m,
            rvol_5m=m.rvol_5m,

            pct_change_1m=m.pct_change_1m,
            pct_change_5m=m.pct_change_5m,

            hod=m.hod,
            broke_hod=m.broke_hod,

            score=m.score,

            config_snapshot={
                "enabled": cfg.enabled,
                "timeframe": cfg.timeframe,
                "min_vol_1m": cfg.min_vol_1m,
                "rvol_lookback_minutes": cfg.rvol_lookback_minutes,
                "rvol_1m_threshold": cfg.rvol_1m_threshold,
                "rvol_5m_threshold": cfg.rvol_5m_threshold,
                "min_pct_change_1m": cfg.min_pct_change_1m,
                "min_pct_change_5m": cfg.min_pct_change_5m,
                "require_green_candle": cfg.require_green_candle,
                "require_hod_break": cfg.require_hod_break,
                "cooldown_minutes": cfg.cooldown_minutes,
                "realert_on_new_hod": cfg.realert_on_new_hod,
            },
        )
        created += 1

        # Realtime broadcast of trigger (payload matches REST serializer)
        try:
            payload = ScannerTriggerEventSerializer(ev).data
            publish_trigger_event_to_users(follower_ids, payload)
        except Exception:
            pass

        # Pushover notify (async)
        try:
            from scanner.tasks import scanner_notify_pushover_trigger
            scanner_notify_pushover_trigger.delay(ev.id)
        except Exception:
            pass

    # --- HOT5 broadcast (independent from triggers) ---
    if all_metrics and live_feed_user_ids:
        try:
            top = sorted(all_metrics, key=lambda x: float(x.score or 0.0), reverse=True)[:5]
            items = [_hot_item(m) for m in top]
            publish_hotlist_to_users(live_feed_user_ids, items)
        except Exception:
            pass

    return created