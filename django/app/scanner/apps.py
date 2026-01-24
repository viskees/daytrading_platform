from __future__ import annotations

from django.apps import AppConfig
from django.db.models.signals import post_migrate


class ScannerAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "scanner"

    def ready(self) -> None:
        # Ensure beat schedule exists after migrations
        from .beat_setup import ensure_scanner_periodic_task

        def _on_post_migrate(**kwargs):
            ensure_scanner_periodic_task(enabled=True)

        post_migrate.connect(_on_post_migrate, sender=self)