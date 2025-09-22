from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import JournalDayViewSet, TradeViewSet, StrategyTagViewSet, AttachmentViewSet

router = DefaultRouter()
router.register("days", JournalDayViewSet, basename="journal-day")
router.register("trades", TradeViewSet, basename="trade")
router.register("tags", StrategyTagViewSet, basename="tag")
router.register("attachments", AttachmentViewSet, basename="attachment")

urlpatterns = [
    path("", include(router.urls)),
]
