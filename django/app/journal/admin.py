from django.contrib import admin
from .models import Trade, JournalDay, StrategyTag, Attachment, UserSettings

@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display = (
        "id", "ticker", "side", "quantity",
        "entry_price", "exit_price",
        "risk_ps", "r_mult",
        "status", "journal_day", "entry_time",
    )
    list_filter = ("status", "side")
    search_fields = ("ticker", "notes")

    @admin.display(description="Risk/Share")
    def risk_ps(self, obj):
        return obj.risk_per_share

    @admin.display(description="R Multiple")
    def r_mult(self, obj):
        return obj.r_multiple

@admin.register(JournalDay)
class JournalDayAdmin(admin.ModelAdmin):
    list_display = ("date", "user", "day_start_equity", "day_end_equity", "realized_pnl", "breach_daily_loss")
    list_filter = ("date",)
    search_fields = ("notes",)

@admin.register(StrategyTag)
class StrategyTagAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)

@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("trade", "caption", "uploaded_at")

@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "dark_mode", "max_risk_per_trade_pct", "max_daily_loss_pct", "max_trades_per_day")
