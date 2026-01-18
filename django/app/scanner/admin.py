from django.contrib import admin
from .models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings

@admin.register(ScannerConfig)
class ScannerConfigAdmin(admin.ModelAdmin):
    list_display = ("id", "enabled", "timeframe", "updated_at")

@admin.register(ScannerUniverseTicker)
class ScannerUniverseTickerAdmin(admin.ModelAdmin):
    list_display = ("symbol", "enabled", "created_at")
    list_filter = ("enabled",)
    search_fields = ("symbol",)

@admin.register(ScannerTriggerEvent)
class ScannerTriggerEventAdmin(admin.ModelAdmin):
    list_display = ("triggered_at", "symbol", "score")
    search_fields = ("symbol",)
    list_filter = ("symbol",)

@admin.register(UserScannerSettings)
class UserScannerSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "follow_alerts", "updated_at")