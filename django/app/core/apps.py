from django.apps import AppConfig
from django.conf import settings
import os, logging
log = logging.getLogger(__name__)

class CoreConfig(AppConfig):
    name = "core"
    def ready(self):
        try:
            os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
            if not os.access(settings.MEDIA_ROOT, os.W_OK):
                log.warning("MEDIA_ROOT is not writable: %s", settings.MEDIA_ROOT)
        except Exception as e:
            log.warning("Failed to prepare MEDIA_ROOT=%s: %s", settings.MEDIA_ROOT, e)
