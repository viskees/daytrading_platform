from rest_framework import viewsets, mixins, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.utils.timezone import now
from .models import UserSettings, JournalDay, Trade, StrategyTag, Attachment
from .serializers import UserSettingsSerializer, JournalDaySerializer, TradeSerializer, StrategyTagSerializer, AttachmentSerializer
from django_filters.rest_framework import DjangoFilterBackend
from django.db import IntegrityError
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser

class UserSettingsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        return Response(UserSettingsSerializer(obj).data)

    @action(detail=False, methods=["patch"])
    def me(self, request):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def update(self, request, pk=None):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

     # PATCH /api/journal/settings/{id}/
    def partial_update(self, request, pk=None):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        ser = UserSettingsSerializer(instance=obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

class JournalDayViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = JournalDaySerializer

    def get_queryset(self):
        qs = JournalDay.objects.filter(user=self.request.user)
        date = self.request.query_params.get("date")
        if date:
            qs = qs.filter(date=date)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        date = serializer.validated_data["date"]
        obj, created = JournalDay.objects.get_or_create(
            user=request.user,
            date=date,
            defaults={
                "day_start_equity": serializer.validated_data.get("day_start_equity", 0),
                "notes": serializer.validated_data.get("notes", ""),
            },
        )
        out = self.get_serializer(obj)
        return Response(out.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

class TradeViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TradeSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    # richer filters so the Journal tab can do date ranges, ticker search, etc.
    filterset_fields = {
        "status": ["exact"],
        "journal_day": ["exact"],
        "journal_day__date": ["exact", "gte", "lte"],
        "ticker": ["iexact", "icontains"],
        "side": ["exact"],
    }
    ordering_fields = ["entry_time", "exit_time", "ticker", "id"]
    # default when no ?ordering=… is provided
    ordering = ["-entry_time"]
    search_fields = ["ticker", "notes"]

    def get_queryset(self):
        qs = (
            Trade.objects
            .filter(user=self.request.user)
            .prefetch_related("strategy_tags")   # important for returning names
        )
        day_id = self.request.query_params.get("journal_day")
        status_f = self.request.query_params.get("status")
        if day_id:
            qs = qs.filter(journal_day_id=day_id)
        if status_f:
            qs = qs.filter(status=status_f)
        return qs

    def perform_create(self, serializer):
        day = serializer.validated_data.get("journal_day")
        if day.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
        serializer.save(user=self.request.user, entry_time=timezone.now())

    def perform_update(self, serializer):
        day = serializer.validated_data.get("journal_day", serializer.instance.journal_day)
        if day.user_id != self.request.user.id:
            raise PermissionDenied("Forbidden")
        inst = serializer.save(user=self.request.user)
        if inst.status == "CLOSED" and inst.exit_time is None:
           inst.exit_time = timezone.now()
           inst.save(update_fields=["exit_time"])

class StrategyTagViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StrategyTagSerializer
    def get_queryset(self):
        return StrategyTag.objects.all()

class AttachmentViewSet(mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]  # <-- add this line

    def get_queryset(self):
        return Attachment.objects.filter(trade__user=self.request.user)

    def perform_create(self, serializer):
        trade = serializer.validated_data.get('trade')
        if trade.user_id != self.request.user.id:
            raise PermissionDenied('Forbidden')
        serializer.save()
