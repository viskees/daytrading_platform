# journal/serializers.py
from rest_framework import serializers
from .models import (
    JournalDay,
    Trade,
    TradeFill,
    StrategyTag,
    Attachment,
    UserSettings,
    AccountAdjustment,
    Emotion,
)

from decimal import Decimal
from django.utils import timezone

from .services import get_or_create_journal_day_with_carry

class StrategyTagSerializer(serializers.ModelSerializer):
    """
    Safe serializer for StrategyTag:
    - Always returns id, name
    - Optionally returns an 'image' URL *if* the model has a compatible attribute
      (image/icon/thumbnail/thumb/logo). Otherwise null.
    """
    image = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = StrategyTag
        fields = ("id", "name", "image")

    def get_image(self, obj):
        # Gracefully support different possible attribute names or absence.
        candidate = None
        for attr in ("image", "icon", "thumbnail", "thumb", "logo"):
            if hasattr(obj, attr):
                candidate = getattr(obj, attr)
                break
        if not candidate:
            return None
        try:
            url = candidate.url if hasattr(candidate, "url") else str(candidate)
            request = self.context.get("request")
            if request and isinstance(url, str) and url.startswith("/"):
                return request.build_absolute_uri(url)
            return url
        except Exception:
            return None


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

    # absolute URLs in responses (helpful for reverse proxies/CDNs).
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        img = data.get("image")
        if request and isinstance(img, str) and img.startswith("/"):
            data["image"] = request.build_absolute_uri(img)
        return data

class TradeFillSerializer(serializers.ModelSerializer):
    class Meta:
        model = TradeFill
        fields = [
            "id",
            "trade",
            "timestamp",
            "action",
            "quantity",
            "price",
            "commission",
            "note",
        ]
        read_only_fields = ["id", "trade", "timestamp", "action", "quantity", "price", "commission", "note"]


class TradeScaleSerializer(serializers.Serializer):
    """
    Input serializer for POST /trades/{id}/scale/
    """
    DIRECTION_IN = "IN"
    DIRECTION_OUT = "OUT"
    DIRECTION_CHOICES = (
        (DIRECTION_IN, "Scale in"),
        (DIRECTION_OUT, "Scale out"),
    )

    direction = serializers.ChoiceField(choices=DIRECTION_CHOICES)
    quantity = serializers.IntegerField(min_value=1)
    price = serializers.DecimalField(max_digits=10, decimal_places=4)
    timestamp = serializers.DateTimeField(required=False, allow_null=True)
    commission = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_price(self, val):
        try:
            if Decimal(str(val)) <= 0:
                raise serializers.ValidationError("Must be greater than zero.")
        except Exception:
            raise serializers.ValidationError("Invalid price.")
        return val




class TradeSerializer(serializers.ModelSerializer):
    # READ: tags as [{id,name}]
    strategy_tags = StrategyTagSerializer(many=True, read_only=True)
    # WRITE: ids map onto the same m2m
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
    # expose realized P/L computed property from model
    realized_pnl = serializers.FloatField(read_only=True)
    # scaling-derived fields (computed properties)
    position_qty = serializers.IntegerField(read_only=True)
    avg_entry_price = serializers.FloatField(read_only=True)
    vwap_entry = serializers.FloatField(read_only=True)
    vwap_exit = serializers.FloatField(read_only=True)
    total_entry_qty = serializers.IntegerField(read_only=True)
    total_exit_qty = serializers.IntegerField(read_only=True)
    max_position_qty = serializers.IntegerField(read_only=True)
    commission_total = serializers.FloatField(read_only=True)
    commission_entry_total = serializers.FloatField(read_only=True)
    commission_exit_total = serializers.FloatField(read_only=True)
    realized_gross = serializers.FloatField(read_only=True)
    risk_dollars = serializers.FloatField(read_only=True)
    r_multiple_gross_dollars = serializers.FloatField(read_only=True)
    r_multiple_net_dollars = serializers.FloatField(read_only=True)
    commission_entry = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    commission_exit = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    # allow client to set explicit exit_time when closing (server may also set default)
    exit_time = serializers.DateTimeField(required=False, allow_null=True)

    # --- Emotions (explicit for API clarity) ---
    entry_emotion = serializers.ChoiceField(choices=Emotion.choices, required=False)
    entry_emotion_note = serializers.CharField(required=False, allow_blank=True, default="")
    exit_emotion = serializers.ChoiceField(choices=Emotion.choices, required=False, allow_null=True)
    exit_emotion_note = serializers.CharField(required=False, allow_blank=True, default="")

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
            "exit_time",
            "entry_time",
            "status",
            "notes",
            "entry_emotion",
            "entry_emotion_note",
            "exit_emotion",
            "exit_emotion_note",
            "strategy_tags",
            "strategy_tag_ids",
            "attachments",
            "risk_per_share",
            "r_multiple",
            "realized_pnl",
            "position_qty",
            "avg_entry_price",
            "vwap_entry",
            "vwap_exit",
            "total_entry_qty",
            "total_exit_qty",
            "max_position_qty",
            "commission_total",
            "commission_entry_total",
            "commission_exit_total",
            "realized_gross",
            "risk_dollars",
            "r_multiple_gross_dollars",
            "r_multiple_net_dollars",
            "commission_entry",
            "commission_exit",
        ]
        read_only_fields = [
            "entry_time",
            "risk_per_share",
            "r_multiple",
            "realized_pnl",
            "attachments",
            "strategy_tags",
            "position_qty",
            "avg_entry_price",
            "vwap_entry",
            "vwap_exit",
            "total_entry_qty",
            "total_exit_qty",
            "max_position_qty",
            "commission_total",
            "commission_entry_total",
            "commission_exit_total",
            "realized_gross",
            "risk_dollars",
            "r_multiple_gross_dollars",
            "r_multiple_net_dollars",
            "commission_entry",
            "commission_exit",
        ]

    def _get_user_settings(self, user) -> UserSettings:
        try:
            obj, _ = UserSettings.objects.get_or_create(user=user)
            return obj
        except Exception:
            # last-resort fallback (should not happen)
            return UserSettings(user=user)

    def _calc_entry_commission(self, *, user, entry_price, quantity) -> Decimal:
        try:
            if entry_price is None or quantity in (None, 0):
                return Decimal("0.00")
            policy = self._get_user_settings(user)
            return policy.commission_for_side(
                price=Decimal(str(entry_price)),
                quantity=int(quantity),
            )
        except Exception:
            return Decimal("0.00")

    def _calc_exit_commission(self, *, user, exit_price, quantity) -> Decimal:
        try:
            if exit_price is None or quantity in (None, 0):
                return Decimal("0.00")
            policy = self._get_user_settings(user)
            return policy.commission_for_side(
                price=Decimal(str(exit_price)),
                quantity=int(quantity),
            )
        except Exception:
            return Decimal("0.00")


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
        # Accept tags via strategy_tag_ids (mapped into 'strategy_tags' by source=)
        # Only set tags if the field was present (even an empty list means "clear all")
        sentinel = object()
        tags = validated_data.pop("strategy_tags", sentinel)
        trade = Trade.objects.create(**validated_data)

        # Commission: store entry-side commission at creation time
        try:
            request = self.context.get("request")
            user = getattr(request, "user", None) or trade.user
            trade.commission_entry = self._calc_entry_commission(
                user=user,
                entry_price=trade.entry_price,
                quantity=trade.quantity,
            )
            trade.save(update_fields=["commission_entry"])
        except Exception:
            pass

        if tags is not sentinel:
            trade.strategy_tags.set(tags)
        return trade

    def update(self, instance, validated_data):
        """Update trade + enforce overnight-close semantics.

        Key rule: if a trade becomes CLOSED, it must be attached to the JournalDay
        of the (local) exit date so the Journal, calendar tiles, session stats and
        account summary all reflect the close day.
        """
        # Detect whether client sent tags (even an empty list) to allow clearing
        sentinel = object()
        tags = validated_data.pop("strategy_tags", sentinel)
        
        # ---- Overnight close enforcement (server-side safety net) ----
        new_status = validated_data.get("status", instance.status)
        if new_status == "CLOSED":
            # Ensure exit_time exists
            exit_time = validated_data.get("exit_time", instance.exit_time)
            if exit_time is None:
                exit_time = timezone.now()
                validated_data["exit_time"] = exit_time

            # Attach to the JournalDay of the local exit date
            request = self.context.get("request")
            user = getattr(request, "user", None) or instance.user
            exit_date = timezone.localdate(exit_time)
            jd, _ = get_or_create_journal_day_with_carry(user, exit_date)
            validated_data["journal_day"] = jd
            
            # Commission: set exit-side fee when closing (or when exit_price is provided/changed)
            exit_price = validated_data.get("exit_price", instance.exit_price)
            qty = validated_data.get("quantity", instance.quantity)
            validated_data["commission_exit"] = self._calc_exit_commission(
                user=user,
                exit_price=exit_price,
                quantity=qty,
            )

        # If entry_price/quantity changed while trade is OPEN, recompute entry commission
        # (Keeps commission consistent with current entry notional)
        if new_status != "CLOSED":
            if "entry_price" in validated_data or "quantity" in validated_data:
                request = self.context.get("request")
                user = getattr(request, "user", None) or instance.user
                ep = validated_data.get("entry_price", instance.entry_price)
                qty = validated_data.get("quantity", instance.quantity)
                validated_data["commission_entry"] = self._calc_entry_commission(
                    user=user,
                    entry_price=ep,
                    quantity=qty,
                )

        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if tags is not sentinel:
            instance.strategy_tags.set(tags)
        return instance


class JournalDaySerializer(serializers.ModelSerializer):
    trades = TradeSerializer(many=True, read_only=True)
    realized_pnl = serializers.FloatField(read_only=True)
    breach_daily_loss = serializers.BooleanField(read_only=True)
    max_daily_loss_pct = serializers.FloatField(read_only=True)
    max_trades = serializers.IntegerField(read_only=True)

    effective_equity = serializers.SerializerMethodField()
    adjustments_total = serializers.SerializerMethodField()

    class Meta:
        model = JournalDay
        fields = "__all__"
        read_only_fields = ("user",)

    def get_effective_equity(self, obj):
        return float(obj.effective_equity)

    def get_adjustments_total(self, obj):
        return float(obj.adjustments_total)


class UserSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSettings
        fields = [
            "id",
            "dark_mode",
            "max_risk_per_trade_pct",
            "max_daily_loss_pct",
            "max_trades_per_day",
            "commission_mode",
            "commission_value",
            "commission_per_share",
            "commission_min_per_side",
            "commission_cap_pct_of_notional",
        ]


class AccountAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountAdjustment
        fields = (
            "id",
            "journal_day",
            "amount",
            "reason",
            "note",
            "at_time",
            "created_at",
        )
        read_only_fields = ("id", "created_at")

    
    def validate(self, attrs):
        """
        Normalize amount sign by reason to prevent mistakes:
        - DEPOSIT  -> positive
        - WITHDRAWAL / FEE -> negative
        - CORRECTION -> as provided (can be +/-)
        """
        from .models import AccountAdjustment as AA
        amt = attrs.get("amount")
        reason = attrs.get("reason")
        try:
            amt_f = float(amt)
        except Exception:
            raise serializers.ValidationError({"amount": "Invalid amount."})

        if reason in (AA.REASON_WITHDRAWAL, AA.REASON_FEE):
            amt_f = -abs(amt_f)
        elif reason == AA.REASON_DEPOSIT:
            amt_f = abs(amt_f)
        # CORRECTION: leave as-is

        attrs["amount"] = amt_f
        return attrs