from rest_framework import viewsets, mixins, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils.timezone import now
from .models import UserSettings, JournalDay, Trade, StrategyTag, Attachment
from .serializers import UserSettingsSerializer, JournalDaySerializer, TradeSerializer, StrategyTagSerializer, AttachmentSerializer
from django_filters.rest_framework import DjangoFilterBackend


class UserSettingsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        obj, _ = UserSettings.objects.get_or_create(user=request.user)
        return Response(UserSettingsSerializer(obj).data)

    def update(self, request, pk=None):
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

class TradeViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TradeSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    filterset_fields = ["journal_day", "status", "ticker", "side"]
    ordering_fields = ["entry_time", "ticker"]
    search_fields = ["ticker", "notes"]

    def get_queryset(self):
        qs = Trade.objects.filter(user=self.request.user)
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
            return Response({"detail": "Forbidden"}, status=403)
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        day = serializer.validated_data.get("journal_day", serializer.instance.journal_day)
        if day.user_id != self.request.user.id:
            return Response({"detail": "Forbidden"}, status=403)
        serializer.save(user=self.request.user)

class StrategyTagViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StrategyTagSerializer
    def get_queryset(self):
        return StrategyTag.objects.all()

class AttachmentViewSet(mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttachmentSerializer
    def get_queryset(self):
        return Attachment.objects.filter(trade__user=self.request.user)
