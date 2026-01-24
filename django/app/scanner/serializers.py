from django.utils import timezone
from rest_framework import serializers
from .models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings


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
            "o", "h", "l", "c", "v",
            "last_price",
            "vol_1m", "vol_5m",
            "avg_vol_1m_lookback",
            "rvol_1m", "rvol_5m",
            "pct_change_1m", "pct_change_5m",
            "hod", "broke_hod",
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
    class Meta:
        model = UserScannerSettings
        fields = ["follow_alerts", "cleared_until", "updated_at"]
        read_only_fields = ["updated_at"]