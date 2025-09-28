from rest_framework import serializers
from .models import UserSettings, JournalDay, Trade, StrategyTag, Attachment

class StrategyTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrategyTag
        fields = ["id", "name"]

class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ["id", "image", "caption", "uploaded_at"]

    def validate_image(self, f):
        max_mb = 10
        if f.size > max_mb * 1024 * 1024:
            raise serializers.ValidationError(f"Max file size is {max_mb}MB")
        if not f.content_type.startswith("image/"):
            raise serializers.ValidationError("Only image uploads allowed")
        return f

class TradeSerializer(serializers.ModelSerializer):
    strategy_tags = StrategyTagSerializer(many=True, read_only=True)
    strategy_tag_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=StrategyTag.objects.all(), write_only=True, required=False
    )
    risk_per_share = serializers.FloatField(read_only=True)
    r_multiple = serializers.FloatField(read_only=True)

    class Meta:
        model = Trade
        fields = [
            "id", "journal_day", "ticker", "side", "quantity",
            "entry_price", "stop_price", "exit_price", "entry_time",
            "status", "notes",
            "strategy_tags", "strategy_tag_ids",
            "risk_per_share", "r_multiple",
        ]

    def create(self, validated_data):
        tag_ids = validated_data.pop("strategy_tag_ids", [])
        trade = Trade.objects.create(**validated_data)
        if tag_ids:
            trade.strategy_tags.set(tag_ids)
        return trade

    def update(self, instance, validated_data):
        tag_ids = validated_data.pop("strategy_tag_ids", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if tag_ids is not None:
            instance.strategy_tags.set(tag_ids)
        return instance

class JournalDaySerializer(serializers.ModelSerializer):
    trades = TradeSerializer(many=True, read_only=True)
    realized_pnl = serializers.FloatField(read_only=True)
    breach_daily_loss = serializers.BooleanField(read_only=True)
    max_daily_loss_pct = serializers.FloatField(read_only=True)
    max_trades = serializers.IntegerField(read_only=True)

    class Meta:
        model = JournalDay
        fields = [
            "id", "date", "day_start_equity", "day_end_equity", "notes",
            "trades", "realized_pnl", "breach_daily_loss",
            "max_daily_loss_pct", "max_trades",
        ]

class UserSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSettings
        fields = ["dark_mode", "max_risk_per_trade_pct", "max_daily_loss_pct", "max_trades_per_day"]
