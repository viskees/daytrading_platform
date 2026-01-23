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
from .services.realtime import publish_trigger_event_to_users


class ScannerConfigViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerConfigSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"

    def get_object(self):
        obj, _ = ScannerConfig.objects.get_or_create(id=1)
        return obj


class ScannerUniverseTickerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsScannerAdminOrReadOnly]
    serializer_class = ScannerUniverseTickerSerializer
    queryset = ScannerUniverseTicker.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"


class ScannerTriggerEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Global trigger feed visible to all authenticated users,
    but filtered per-user by their cleared_until timestamp.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ScannerTriggerEventSerializer
    queryset = ScannerTriggerEvent.objects.all()

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_triggers"

    def get_queryset(self):
        qs = super().get_queryset()

        # Per-user "clear feed" filter
        settings_obj, _ = UserScannerSettings.objects.get_or_create(user=self.request.user)
        if settings_obj.cleared_until:
            qs = qs.filter(triggered_at__gt=settings_obj.cleared_until)

        symbol = self.request.query_params.get("symbol")
        if symbol:
            qs = qs.filter(symbol__iexact=symbol)

        return qs

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """
        Clear the trigger list for the current user (does NOT delete global events).
        Sets UserScannerSettings.cleared_until = now.
        """
        settings_obj, _ = UserScannerSettings.objects.get_or_create(user=request.user)
        settings_obj.cleared_until = timezone.now()
        settings_obj.save(update_fields=["cleared_until", "updated_at"])
        return Response(
            {"detail": "cleared", "cleared_until": settings_obj.cleared_until},
            status=status.HTTP_200_OK,
        )


class UserScannerSettingsViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = UserScannerSettingsSerializer

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_read"

    def get_object(self):
        obj, _ = UserScannerSettings.objects.get_or_create(user=self.request.user)
        return obj


class ScannerAdminViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "scanner_write"

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

        payload = ScannerTriggerEventSerializer(ev).data

        follower_ids = list(
            UserScannerSettings.objects.filter(follow_alerts=True).values_list("user_id", flat=True)
        )
        publish_trigger_event_to_users(follower_ids, payload)

        return Response(payload, status=201)