from __future__ import annotations

import logging

from celery import shared_task
from django.db import close_old_connections

from scanner.models import ScannerConfig
from scanner.services.engine import run_engine_once

logger = logging.getLogger(__name__)


@shared_task(bind=True, ignore_result=False)
def scanner_tick(self) -> int:
    """
    Runs the scanner engine once (intended every 60s via Celery beat).

    Reads:
      - ScannerConfig (DB; updated by UI)
      - Universe tickers (DB)
      - Bars from Redis (barstore_redis)

    Writes:
      - ScannerTriggerEvent rows (DB)

    Returns number of created trigger events in this tick.
    """
    # Prevent stale DB connections in long-lived workers
    close_old_connections()

    cfg, _ = ScannerConfig.objects.get_or_create(id=1)
    if not cfg.enabled:
        logger.info("scanner_tick: disabled")
        return 0

    created = int(run_engine_once())
    logger.info("scanner_tick: created=%s", created)
    return created