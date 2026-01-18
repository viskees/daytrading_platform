from django.utils import timezone
from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle

from .models import ScannerConfig, ScannerUniverseTicker, ScannerTriggerEvent, UserScannerSettings
from .serializers import (
    ScannerConfigSerializer,
    ScannerUniverseTickerSerializer,
    ScannerTriggerEventSerializer,
    UserScannerSettingsSerializer,
)
from .permissions import IsScannerAdminOrReadOnly, is_scanner_admin


class ScannerConfigViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Global singleton config. Readable by all logged-in users.
    Editable only by scanner admin.
    """
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerConfigSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"   # GET fairly often; PATCH occasional

    def get_object(self):
        obj, _ = ScannerConfig.objects.get_or_create(id=1)
        return obj


class ScannerUniverseTickerViewSet(viewsets.ModelViewSet):
    """
    Global ticker universe. Everyone can read; only admin can modify.
    """
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerUniverseTickerSerializer
    queryset = ScannerUniverseTicker.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"   # list is read-heavy; writes are protected by permission


class ScannerTriggerEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Global trigger feed visible to all authenticated users.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ScannerTriggerEventSerializer
    queryset = ScannerTriggerEvent.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_triggers"  # this is the polling endpoint

    def get_queryset(self):
        qs = super().get_queryset()
        symbol = self.request.query_params.get("symbol")
        if symbol:
            qs = qs.filter(symbol__iexact=symbol)
        return qs


class UserScannerSettingsViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Per-user preferences. Each user can only access their own settings.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = UserScannerSettingsSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"

    def get_object(self):
        obj, _ = UserScannerSettings.objects.get_or_create(user=self.request.user)
        return obj


class ScannerAdminViewSet(viewsets.ViewSet):
    """
    Admin-only convenience actions (MVP):
    - trigger a 'test event' to validate UI wiring without running the engine yet.
    """
    permission_classes = [IsAuthenticated]

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_write"  # keep admin actions protected

    def _require_admin(self, request):
        if not is_scanner_admin(request.user):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        return None

    @action(detail=False, methods=["post"])
    def emit_test_event(self, request):
        denied = self._require_admin(request)
        if denied:
            return denied

        symbol = (request.data.get("symbol") or "TEST").upper().strip()
        ev = ScannerTriggerEvent.objects.create(
            symbol=symbol,
            triggered_at=timezone.now(),
            reason_tags=["TEST_EVENT"],
            score=0,
            config_snapshot={"test": True},
        )
        return Response(ScannerTriggerEventSerializer(ev).data, status=201)