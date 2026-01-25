from django.utils import timezone
from rest_framework import serializers

from .models import (
    ScannerConfig,
    ScannerUniverseTicker,
    ScannerTriggerEvent,
    UserScannerSettings,
)


class ScannerConfigSerializer(serializers.ModelSerializer):
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = ScannerConfig
        fields = [
            "id",
            "enabled",
            "timeframe",
            "min_vol_1m",
            "rvol_lookback_minutes",
            "rvol_1m_threshold",
            "rvol_5m_threshold",
            "min_pct_change_1m",
            "min_pct_change_5m",
            "require_green_candle",
            "require_hod_break",
            "cooldown_minutes",
            "realert_on_new_hod",
            "updated_at",
            "can_edit",
        ]
        read_only_fields = ["id", "updated_at", "can_edit"]

    def get_can_edit(self, obj):
        req = self.context.get("request")
        if not req:
            return False
        from .permissions import is_scanner_admin
        return is_scanner_admin(req.user)


class ScannerUniverseTickerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScannerUniverseTicker
        fields = ["id", "symbol", "enabled", "created_at"]
        read_only_fields = ["id", "created_at"]


class ScannerTriggerEventSerializer(serializers.ModelSerializer):
    # --- Computed fields (daytrader-useful) ---
    candle_color = serializers.SerializerMethodField()
    candle_pct = serializers.SerializerMethodField()
    hod_distance_pct = serializers.SerializerMethodField()
    trigger_age_seconds = serializers.SerializerMethodField()

    class Meta:
        model = ScannerTriggerEvent
        fields = [
            "id",
            "symbol",
            "triggered_at",
            "reason_tags",
            "o",
            "h",
            "l",
            "c",
            "v",
            "last_price",
            "vol_1m",
            "vol_5m",
            "avg_vol_1m_lookback",
            "rvol_1m",
            "rvol_5m",
            "pct_change_1m",
            "pct_change_5m",
            "hod",
            "broke_hod",
            "score",
            "config_snapshot",
            # computed
            "candle_color",
            "candle_pct",
            "hod_distance_pct",
            "trigger_age_seconds",
        ]

    def _to_float(self, x):
        try:
            if x is None:
                return None
            return float(x)
        except Exception:
            return None

    def get_candle_color(self, obj: ScannerTriggerEvent):
        """
        GREEN if close >= open, RED if close < open.
        DOJI if open/close nearly equal (tiny epsilon).
        """
        o = self._to_float(getattr(obj, "o", None))
        c = self._to_float(getattr(obj, "c", None))
        if o is None or c is None:
            return None
        eps = max(abs(o) * 0.0001, 1e-8)  # ~1bp relative
        if abs(c - o) <= eps:
            return "DOJI"
        return "GREEN" if c > o else "RED"

    def get_candle_pct(self, obj: ScannerTriggerEvent):
        """
        Percent move of the trigger candle: (c - o) / o * 100
        """
        o = self._to_float(getattr(obj, "o", None))
        c = self._to_float(getattr(obj, "c", None))
        if o is None or c is None:
            return None
        if abs(o) < 1e-9:
            return None
        return (c - o) / o * 100.0

    def get_hod_distance_pct(self, obj: ScannerTriggerEvent):
        """
        Distance from current/last price to HOD in percent.
        Positive means price is below HOD.
        """
        hod = self._to_float(getattr(obj, "hod", None))
        last_price = self._to_float(getattr(obj, "last_price", None))
        if last_price is None:
            # fallback to candle close
            last_price = self._to_float(getattr(obj, "c", None))
        if hod is None or last_price is None:
            return None
        if abs(last_price) < 1e-9:
            return None
        return (hod - last_price) / last_price * 100.0

    def get_trigger_age_seconds(self, obj: ScannerTriggerEvent):
        """
        Seconds since trigger time (server time).
        """
        ts = getattr(obj, "triggered_at", None)
        if not ts:
            return None
        now = timezone.now()
        try:
            return max(0, int((now - ts).total_seconds()))
        except Exception:
            return None


class UserScannerSettingsSerializer(serializers.ModelSerializer):
    """
    Per-user scanner settings / notification routing.
    IMPORTANT:
    - Pushover *App token* stays server-side only (env/settings).
    - Users only provide their Pushover *User Key* (and optional device/sound).
    """

    class Meta:
        model = UserScannerSettings
        fields = [
            "follow_alerts",
            "cleared_until",

            # Pushover user-configurable fields (per user)
            "pushover_enabled",
            "pushover_user_key",
            "pushover_device",
            "pushover_sound",
            "pushover_priority",

            # Trader-grade notification gating (per user)
            "notify_min_score",
            "notify_only_hod_break",

            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def validate_pushover_user_key(self, value: str):
        """
        Pushover User Key is typically a 30-char alphanumeric string.
        We'll do light validation (avoid blocking legit keys if format changes).
        """
        v = (value or "").strip()
        if v == "":
            return v

        if len(v) < 20 or len(v) > 40:
            raise serializers.ValidationError("Pushover User Key looks invalid (unexpected length).")

        # Be conservative: allow only [A-Za-z0-9]
        if not v.isalnum():
            raise serializers.ValidationError("Pushover User Key must be alphanumeric.")
        return v

    def validate_pushover_device(self, value: str):
        v = (value or "").strip()
        if v and len(v) > 64:
            raise serializers.ValidationError("Device name too long (max 64 chars).")
        return v

    def validate_pushover_sound(self, value: str):
        v = (value or "").strip()
        if v and len(v) > 32:
            raise serializers.ValidationError("Sound name too long (max 32 chars).")
        return v

    def validate_pushover_priority(self, value):
        """
        Pushover priority range: -2..2 (official).
        """
        if value is None:
            return value
        try:
            iv = int(value)
        except Exception:
            raise serializers.ValidationError("Priority must be an integer.")
        if iv < -2 or iv > 2:
            raise serializers.ValidationError("Priority must be between -2 and 2.")
        return iv

    def validate_notify_min_score(self, value):
        """
        Optional. If set, score must be within a sane range.
        (We keep wide range so you can evolve scoring later.)
        """
        if value is None or value == "":
            return None
        try:
            fv = float(value)
        except Exception:
            raise serializers.ValidationError("notify_min_score must be a number.")
        if fv < 0 or fv > 1000:
            raise serializers.ValidationError("notify_min_score out of range.")
        return fv

    def validate(self, attrs):
        """
        If pushover is enabled, require a user key.
        """
        enabled = attrs.get("pushover_enabled", getattr(self.instance, "pushover_enabled", False))
        user_key = attrs.get("pushover_user_key", getattr(self.instance, "pushover_user_key", ""))

        if enabled and not (user_key or "").strip():
            raise serializers.ValidationError(
                {"pushover_user_key": "Pushover is enabled, but no User Key is set."}
            )
        return attrs