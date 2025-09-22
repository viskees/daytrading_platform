from django.contrib import admin
from .models import JournalDay, Trade, StrategyTag, Attachment

@admin.register(StrategyTag)
class StrategyTagAdmin(admin.ModelAdmin):
    search_fields = ["name"]
    list_display = ["id", "name"]

class AttachmentInline(admin.TabularInline):
    model = Attachment
    extra = 0

@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display = ["id", "journal_day", "ticker", "side", "quantity", "entry_price", "exit_price", "realized_pnl", "r_multiple"]
    list_filter = ["side", "journal_day"]
    search_fields = ["ticker", "comment"]
    inlines = [AttachmentInline]

@admin.register(JournalDay)
class JournalDayAdmin(admin.ModelAdmin):
    date_hierarchy = "date"
    list_display = ["date", "day_start_equity", "day_end_equity", "realized_pnl", "max_daily_loss_pct", "breach_daily_loss"]
