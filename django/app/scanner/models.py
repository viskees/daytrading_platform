from django.conf import settings
from django.db import models


class ScannerConfig(models.Model):
    """
    Global (singleton-ish) config used by the scanner engine.
    Only editable by SCANNER_ADMIN.
    """
    enabled = models.BooleanField(default=False)

    # MVP timeframe fixed to 1m (kept as a field for future)
    timeframe = models.CharField(max_length=10, default="1m")

    # Volume ignition
    min_vol_1m = models.PositiveIntegerField(default=50000)
    rvol_lookback_minutes = models.PositiveIntegerField(default=180)
    rvol_1m_threshold = models.FloatField(default=4.0)
    rvol_5m_threshold = models.FloatField(default=2.5)

    # Price confirmation
    min_pct_change_1m = models.FloatField(default=0.8)
    min_pct_change_5m = models.FloatField(default=2.0)
    require_green_candle = models.BooleanField(default=False)
    require_hod_break = models.BooleanField(default=False)

    # Noise control
    cooldown_minutes = models.PositiveIntegerField(default=15)
    realert_on_new_hod = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"ScannerConfig(enabled={self.enabled})"


class ScannerUniverseTicker(models.Model):
    """
    Global universe list (MVP: max ~50 symbols) curated by admin.
    """
    symbol = models.CharField(max_length=16, unique=True)
    enabled = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["symbol"]

    def __str__(self):
        return self.symbol


class ScannerTriggerEvent(models.Model):
    """
    Global trigger events (visible to all users).
    Stores AI-ready snapshot metrics at trigger time.
    """
    symbol = models.CharField(max_length=16, db_index=True)
    triggered_at = models.DateTimeField(db_index=True)

    # Why it fired
    reason_tags = models.JSONField(default=list)  # e.g. ["RVOL_1M", "HOD_BREAK"]

    # Snapshot: latest 1m bar
    o = models.FloatField(null=True, blank=True)
    h = models.FloatField(null=True, blank=True)
    l = models.FloatField(null=True, blank=True)
    c = models.FloatField(null=True, blank=True)
    v = models.FloatField(null=True, blank=True)

    # Snapshot: computed metrics
    last_price = models.FloatField(null=True, blank=True)

    vol_1m = models.FloatField(null=True, blank=True)
    vol_5m = models.FloatField(null=True, blank=True)

    avg_vol_1m_lookback = models.FloatField(null=True, blank=True)
    rvol_1m = models.FloatField(null=True, blank=True)
    rvol_5m = models.FloatField(null=True, blank=True)

    pct_change_1m = models.FloatField(null=True, blank=True)
    pct_change_5m = models.FloatField(null=True, blank=True)

    hod = models.FloatField(null=True, blank=True)
    broke_hod = models.BooleanField(default=False)

    score = models.FloatField(null=True, blank=True)

    # Store the config snapshot (so future AI can learn under which settings it fired)
    config_snapshot = models.JSONField(default=dict)

    class Meta:
        ordering = ["-triggered_at"]

    def __str__(self):
        return f"{self.symbol} @ {self.triggered_at.isoformat()}"


class UserScannerSettings(models.Model):
    """
    Per-user settings for scanner + notifications.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="scanner_settings",
    )

    # Trigger feed + eligibility for push alerts
    follow_alerts = models.BooleanField(default=True)

    # NEW: live websocket feed for scanner page (hotlist updates, etc.)
    # Decoupled from follow_alerts so you can watch live without getting push spam.
    live_feed_enabled = models.BooleanField(default=True)

    # "Clear feed" marker. Users only see triggers AFTER this timestamp.
    cleared_until = models.DateTimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    # --- Pushover (per-user) ---
    pushover_enabled = models.BooleanField(default=False)
    pushover_user_key = models.CharField(max_length=64, blank=True, default="")
    pushover_device = models.CharField(max_length=64, blank=True, default="")
    pushover_sound = models.CharField(max_length=32, blank=True, default="")
    pushover_priority = models.SmallIntegerField(default=0)

    # --- Trader-grade push gating (per-user) ---
    # If set, only send push if event.score >= notify_min_score.
    notify_min_score = models.FloatField(null=True, blank=True, default=None)

    # If true, only send push if event is a HOD break (broke_hod or reason tag)
    notify_only_hod_break = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.user_id} follow={self.follow_alerts} live={self.live_feed_enabled}"