from __future__ import annotations

import logging
from typing import Optional

import requests
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections
from django.db.models import Q
from django.utils import timezone

from scanner.models import ScannerConfig, ScannerTriggerEvent, UserScannerSettings
from scanner.services.engine import run_engine_once
from datetime import timedelta

logger = logging.getLogger(__name__)


@shared_task(bind=True, ignore_result=False)
def scanner_tick(self) -> int:
    """
    Runs the scanner engine once (intended every 60s via Celery beat).

    Returns number of created trigger events in this tick.
    """
    close_old_connections()

    cfg, _ = ScannerConfig.objects.get_or_create(id=1)
    if not cfg.enabled:
        logger.info("scanner_tick: disabled")
        return 0

    created = int(run_engine_once())
    logger.info("scanner_tick: created=%s", created)
    return created

@shared_task(bind=True, ignore_result=True)
def scanner_prune_trigger_events(self, retention_days: int = 30) -> int:
    """
    Delete old ScannerTriggerEvent rows to prevent unbounded DB growth.
    Returns number of rows deleted.
    """
    close_old_connections()

    try:
        days = int(retention_days or 30)
    except Exception:
        days = 30
    if days < 1:
        days = 1

    cutoff = timezone.now() - timedelta(days=days)

    qs = ScannerTriggerEvent.objects.filter(triggered_at__lt=cutoff)
    deleted, _ = qs.delete()

    logger.info("scanner_prune_trigger_events: retention_days=%s deleted=%s", days, deleted)
    return int(deleted)

def _n(x) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)
        if v != v:  # NaN
            return None
        return v
    except Exception:
        return None


def _fmt_px(v: Optional[float]) -> str:
    if v is None:
        return "—"
    if v < 1:
        return f"{v:.4f}"
    if v < 10:
        return f"{v:.3f}"
    return f"{v:.2f}"


def _fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return "—"
    s = "+" if v >= 0 else ""
    return f"{s}{v:.2f}%"


def _fmt_rvol(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:.2f}x"


def _pushover_send(
    *,
    app_token: str,
    user_key: str,
    title: str,
    message: str,
    device: str = "",
    url: str = "",
    url_title: str = "",
    priority: int = 0,
    sound: str = "",
) -> None:
    """
    Low-level pushover sender. Raises on non-200 responses.
    """
    payload = {
        "token": app_token,
        "user": user_key,
        "title": title,
        "message": message,
        "priority": int(priority),
    }
    if device:
        payload["device"] = device
    if url:
        payload["url"] = url
    if url_title:
        payload["url_title"] = url_title
    if sound:
        payload["sound"] = sound

    resp = requests.post(
        "https://api.pushover.net/1/messages.json",
        data=payload,
        timeout=10,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Pushover failed: {resp.status_code} {resp.text[:300]}")


def _is_hod_break(ev: ScannerTriggerEvent) -> bool:
    """
    Consider it a HOD break if:
      - broke_hod=True OR
      - reason_tags contains HOD_BREAK
    """
    try:
        if bool(getattr(ev, "broke_hod", False)):
            return True
    except Exception:
        pass

    tags = getattr(ev, "reason_tags", None) or []
    if isinstance(tags, (list, tuple)):
        return "HOD_BREAK" in [str(x) for x in tags if x]
    return False


@shared_task(bind=True, ignore_result=True)
def scanner_notify_pushover_trigger(self, trigger_id: int) -> None:
    """
    Send pushover notifications for a single ScannerTriggerEvent to all users that:
      - follow_alerts=True
      - pushover_enabled=True
      - pushover_user_key set
      - cleared_until is None OR cleared_until < triggered_at
      - passes per-user gating:
          - notify_only_hod_break (if true)
          - notify_min_score (if set, requires ev.score >= threshold)
    """
    close_old_connections()

    app_token = (getattr(settings, "PUSHOVER_APP_TOKEN", "") or "").strip()
    if not app_token:
        logger.warning("scanner_notify_pushover_trigger: PUSHOVER_APP_TOKEN not set; skipping")
        return

    try:
        ev = ScannerTriggerEvent.objects.get(id=trigger_id)
    except ScannerTriggerEvent.DoesNotExist:
        logger.warning("scanner_notify_pushover_trigger: trigger_id=%s does not exist", trigger_id)
        return

    # derive last price
    px = _n(getattr(ev, "last_price", None)) or _n(getattr(ev, "c", None))
    p1 = _n(getattr(ev, "pct_change_1m", None))
    p5 = _n(getattr(ev, "pct_change_5m", None))
    r1 = _n(getattr(ev, "rvol_1m", None))
    r5 = _n(getattr(ev, "rvol_5m", None))
    score = _n(getattr(ev, "score", None))

    why = getattr(ev, "reason_tags", None) or []
    if isinstance(why, (list, tuple)):
        why_txt = ", ".join([str(x) for x in why if x])
    else:
        why_txt = str(why)

    title = f"Scanner: {ev.symbol}"
    message = (
        f"Px {_fmt_px(px)} | %1m {_fmt_pct(p1)} | %5m {_fmt_pct(p5)}\n"
        f"rVol1m {_fmt_rvol(r1)} | rVol5m {_fmt_rvol(r5)}\n"
        f"Score: {('—' if score is None else f'{score:.0f}')}\n"
        f"Why: {why_txt or '—'}"
    )

    trig_ts = getattr(ev, "triggered_at", None) or timezone.now()
    hod_break = _is_hod_break(ev)

    qs = (
        UserScannerSettings.objects.select_related("user")
        .filter(follow_alerts=True, pushover_enabled=True)
        .exclude(pushover_user_key__isnull=True)
        .exclude(pushover_user_key__exact="")
        .filter(Q(cleared_until__isnull=True) | Q(cleared_until__lt=trig_ts))
    )

    sent = 0
    for s in qs:
        user_key = (s.pushover_user_key or "").strip()
        if not user_key:
            continue

        # Per-user gating
        try:
            if bool(getattr(s, "notify_only_hod_break", False)) and not hod_break:
                continue
        except Exception:
            pass

        thr = getattr(s, "notify_min_score", None)
        thr = _n(thr)
        if thr is not None:
            # If score is unknown, treat as not passing
            if score is None or score < thr:
                continue

        # idempotency: avoid duplicates per (trigger,user)
        cache_key = f"scanner:pushover:sent:{trigger_id}:{s.user_id}"
        if not cache.add(cache_key, "1", timeout=6 * 60 * 60):  # 6 hours
            continue

        try:
            _pushover_send(
                app_token=app_token,
                user_key=user_key,
                title=title,
                message=message,
                device=(getattr(s, "pushover_device", "") or "").strip(),
                priority=int(getattr(s, "pushover_priority", 0) or 0),
                sound=(getattr(s, "pushover_sound", "") or "").strip(),
            )
            sent += 1
        except Exception:
            logger.exception(
                "scanner_notify_pushover_trigger: failed trigger_id=%s user_id=%s",
                trigger_id,
                s.user_id,
            )

    logger.info("scanner_notify_pushover_trigger: trigger_id=%s sent=%s", trigger_id, sent)