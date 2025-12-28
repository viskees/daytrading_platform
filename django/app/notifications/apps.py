from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "notifications"

    def ready(self):
        from .dispatcher import register
        from .handlers import email_admin
        from . import events

        # Register handlers for events we care about
        register(events.USER_REGISTERED, email_admin)
        register(events.FEATURE_CREATED, email_admin)
        register(events.BUG_CREATED, email_admin)