from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ScannerConfigViewSet,
    ScannerUniverseTickerViewSet,
    ScannerTriggerEventViewSet,
    UserScannerSettingsViewSet,
    ScannerAdminViewSet,
)

router = DefaultRouter()
router.register("config", ScannerConfigViewSet, basename="scanner-config")
router.register("universe", ScannerUniverseTickerViewSet, basename="scanner-universe")
router.register("triggers", ScannerTriggerEventViewSet, basename="scanner-triggers")
router.register("preferences", UserScannerSettingsViewSet, basename="scanner-preferences")
router.register("admin", ScannerAdminViewSet, basename="scanner-admin")

urlpatterns = [
    path("", include(router.urls)),
]