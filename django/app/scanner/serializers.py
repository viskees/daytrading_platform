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
        ]


class UserScannerSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserScannerSettings
        fields = ["follow_alerts", "cleared_until", "updated_at"]
        read_only_fields = ["updated_at"]