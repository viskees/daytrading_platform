
from rest_framework import serializers
from .models import UserSettings, JournalDay, Trade, StrategyTag, Attachment
from rest_framework import serializers
from .models import Trade, StrategyTag

class StrategyTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrategyTag
        fields = ("id", "name")

class TradeSerializer(serializers.ModelSerializer):
    # READ: return tags as [{id,name}, …]
    strategy_tags = StrategyTagSerializer(many=True, read_only=True)
    # WRITE: accept ids; maps onto the same m2m via source='strategy_tags'
    strategy_tag_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=StrategyTag.objects.all(),
        write_only=True,
        required=False,
        source="strategy_tags",
    )

    class Meta:
        model = Trade
        fields = [
            "id", "journal_day", "ticker", "side", "quantity",
            "entry_price", "stop_price", "target_price", "exit_price",
            "status", "notes", "entry_time",
            "strategy_tags",        # read-only names
            "strategy_tag_ids",     # write-only ids
        ]

    # Ensure empty list clears the relation on PATCH/PUT
    def create(self, validated_data):
        tags = validated_data.pop("strategy_tags", [])
        trade = super().create(validated_data)
        if tags is not None:
            trade.strategy_tags.set(tags)
        return trade

    def update(self, instance, validated_data):
        sentinel = object()
        tags = validated_data.pop("strategy_tags", sentinel)
        trade = super().update(instance, validated_data)
        if tags is not sentinel:          # present in payload (even empty)
            trade.strategy_tags.set(tags)
        return trade

class StrategyTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrategyTag
        fields = ["id", "name"]


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ["id", "trade", "image", "caption", "uploaded_at"]
        read_only_fields = ["uploaded_at"]

    def validate_image(self, f):
        max_mb = 10
        if f.size > max_mb * 1024 * 1024:
            raise serializers.ValidationError(f"Max file size is {max_mb}MB")
        ct = getattr(f, "content_type", None)
        if ct and not ct.startswith("image/"):
            raise serializers.ValidationError("Only image uploads allowed")
        return f


class TradeSerializer(serializers.ModelSerializer):
    strategy_tags = StrategyTagSerializer(many=True, read_only=True)
    strategy_tag_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=StrategyTag.objects.all(),
        write_only=True,
        required=False,
        source="strategy_tags",
    )
    attachments = AttachmentSerializer(many=True, read_only=True)
    risk_per_share = serializers.FloatField(read_only=True)
    r_multiple = serializers.FloatField(read_only=True)

    class Meta:
        model = Trade
        fields = [
            "id",
            "journal_day",
            "ticker",
            "side",
            "quantity",
            "entry_price",
            "stop_price",
            "exit_price",
            "target_price",
            "entry_time",
            "status",
            "notes",
            "strategy_tags",
            "strategy_tag_ids",
            "attachments",
            "risk_per_share",
            "r_multiple",
        ]
        read_only_fields = ["entry_time", "risk_per_share", "r_multiple", "attachments", "strategy_tags"]

    def validate(self, attrs):
        qty = attrs.get("quantity")
        if qty is not None and qty <= 0:
            raise serializers.ValidationError({"quantity": "Must be greater than zero"})
        for price_field in ("entry_price", "stop_price", "exit_price", "target_price"):
            val = attrs.get(price_field)
            if val is not None and float(val) < 0:
                raise serializers.ValidationError({price_field: "Must be non-negative"})
        side = attrs.get("side")
        if side and side not in ("LONG", "SHORT"):
            raise serializers.ValidationError({"side": "Must be LONG or SHORT"})
        return attrs

    def create(self, validated_data):
        tags = validated_data.pop("strategy_tags", [])
        trade = Trade.objects.create(**validated_data)
        if tags:
            trade.strategy_tags.set(tags)
        return trade

    def update(self, instance, validated_data):
        tags = validated_data.pop("strategy_tags", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if tags is not None:
            instance.strategy_tags.set(tags)
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
            "id",
            "date",
            "day_start_equity",
            "day_end_equity",
            "notes",
            "trades",
            "realized_pnl",
            "breach_daily_loss",
            "max_daily_loss_pct",
            "max_trades",
        ]


class UserSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSettings
        fields = ["id", "dark_mode", "max_risk_per_trade_pct", "max_daily_loss_pct", "max_trades_per_day"]
