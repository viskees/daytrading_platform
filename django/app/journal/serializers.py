from rest_framework import serializers
from .models import JournalDay, Trade, StrategyTag, Attachment

class StrategyTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = StrategyTag
        fields = ["id", "name"]

class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ["id", "image", "caption", "uploaded_at"]

class TradeSerializer(serializers.ModelSerializer):
    strategy_tags = StrategyTagSerializer(many=True, read_only=True)
    strategy_tag_ids = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, source="strategy_tags", queryset=StrategyTag.objects.all(), required=False
    )
    attachments = AttachmentSerializer(many=True, read_only=True)
    realized_pnl = serializers.FloatField(read_only=True)
    r_multiple = serializers.FloatField(read_only=True)

    class Meta:
        model = Trade
        fields = [
            "id", "journal_day", "ticker", "side", "entry_time", "exit_time",
            "entry_price", "exit_price", "quantity", "fees", "risk_per_share",
            "strategy_tags", "strategy_tag_ids", "comment",
            "attachments", "realized_pnl", "r_multiple"
        ]

class JournalDaySerializer(serializers.ModelSerializer):
    trades = TradeSerializer(many=True, read_only=True)
    realized_pnl = serializers.FloatField(read_only=True)
    breach_daily_loss = serializers.BooleanField(read_only=True)

    class Meta:
        model = JournalDay
        fields = [
            "id", "date", "day_start_equity", "day_end_equity",
            "max_daily_loss_pct", "max_trades", "notes",
            "trades", "realized_pnl", "breach_daily_loss"
        ]
