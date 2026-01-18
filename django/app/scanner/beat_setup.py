from __future__ import annotations

from django_celery_beat.models import IntervalSchedule, PeriodicTask


SCANNER_TICK_TASK_NAME = "scanner-tick-every-minute"
SCANNER_TICK_TASK_PATH = "scanner.tasks.scanner_tick"


def ensure_scanner_periodic_task(enabled: bool = True) -> None:
    """
    Ensure the scanner_tick periodic task exists in django-celery-beat DB.

    Runs safely multiple times.
    """
    interval, _ = IntervalSchedule.objects.get_or_create(
        every=60,
        period=IntervalSchedule.SECONDS,
    )

    PeriodicTask.objects.update_or_create(
        name=SCANNER_TICK_TASK_NAME,
        defaults={
            "task": SCANNER_TICK_TASK_PATH,
            "enabled": enabled,
            "interval": interval,
            "crontab": None,
            "solar": None,
            "clocked": None,
            "one_off": False,
        },
    )