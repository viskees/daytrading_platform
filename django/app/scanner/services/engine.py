from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from django.utils import timezone

from scanner.models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings
from scanner.serializers import ScannerTriggerEventSerializer
from scanner.services.barstore_redis import fetch_bars
from scanner.services.realtime import publish_trigger_event_to_users
from scanner.services.types import Bar1m


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


def compute_metrics(symbol: str, bars: List[Bar1m], lookback_minutes: int) -> Optional[Tuple[Metrics, Dict]]:
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

    # rolling avg of 1m volume over lookback window (exclude last bar to reduce self-inflation)
    lb = min(max(lookback_minutes, 5), len(bars) - 1)
    lookback_slice = bars[-(lb + 1):-1]
    avg_vol = float(sum(b.v for b in lookback_slice) / max(len(lookback_slice), 1))

    # avoid divide by zero
    rvol_1m = vol_1m / max(avg_vol, 1.0)
    rvol_5m = vol_5m / max(avg_vol * 5.0, 1.0)

    pct_change_1m = (last.c - prev.c) / max(prev.c, 1e-9) * 100.0
    pct_change_5m = (last.c - prev5.c) / max(prev5.c, 1e-9) * 100.0

    prior_hod = float(max(b.h for b in bars[:-1]))
    hod = float(max(prior_hod, float(last.h)))
    broke_hod = bool(float(last.h) > prior_hod)

    # Basic score (tune later): weight volume ignition + movement + hod break
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
        avg_vol_1m_lookback=avg_vol,
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

    - If not in cooldown => True
    - If in cooldown:
        - if realert_on_new_hod is False => False
        - if realert_on_new_hod is True => True only when current HOD exceeds last trigger's HOD
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

    bars_map = fetch_bars(symbols, minutes=cfg.rvol_lookback_minutes)

    follower_ids = list(
        UserScannerSettings.objects.filter(follow_alerts=True).values_list("user_id", flat=True)
    )

    created = 0

    for sym in symbols:
        bars = bars_map.get(sym) or []
        res = compute_metrics(sym, bars, lookback_minutes=cfg.rvol_lookback_minutes)
        if not res:
            continue

        m, _extra = res

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

        # Realtime broadcast (payload matches REST serializer)
        try:
            payload = ScannerTriggerEventSerializer(ev).data
            publish_trigger_event_to_users(follower_ids, payload)
        except Exception:
            pass

        # Pushover notify (async) - import inside to avoid circular imports
        try:
            from scanner.tasks import scanner_notify_pushover_trigger
            scanner_notify_pushover_trigger.delay(ev.id)
        except Exception:
            # Engine should never crash because notification enqueue failed
            pass

    return created