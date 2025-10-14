# journal/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import JournalDayViewSet, TradeViewSet, StrategyTagViewSet, AttachmentViewSet, UserSettingsViewSet, AccountAdjustmentViewSet

router = DefaultRouter()
router.register("settings", UserSettingsViewSet, basename="user-settings")
router.register("days", JournalDayViewSet, basename="journal-day")
router.register("trades", TradeViewSet, basename="trade")
router.register("tags", StrategyTagViewSet, basename="tag")
router.register("attachments", AttachmentViewSet, basename="attachment")
router.register(r"account/adjustments", AccountAdjustmentViewSet, basename="accountadjustment")
 
urlpatterns = [
    path("", include(router.urls)),
]
