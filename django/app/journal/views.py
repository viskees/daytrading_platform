from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import JournalDay, Trade, StrategyTag, Attachment
from .serializers import JournalDaySerializer, TradeSerializer, StrategyTagSerializer, AttachmentSerializer

class JournalDayViewSet(viewsets.ModelViewSet):
    queryset = JournalDay.objects.all()
    serializer_class = JournalDaySerializer
    lookup_field = "id"

class TradeViewSet(viewsets.ModelViewSet):
    queryset = Trade.objects.select_related("journal_day").prefetch_related("strategy_tags", "attachments")
    serializer_class = TradeSerializer
    lookup_field = "id"

class StrategyTagViewSet(viewsets.ModelViewSet):
    queryset = StrategyTag.objects.all()
    serializer_class = StrategyTagSerializer
    lookup_field = "id"

class AttachmentViewSet(mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    queryset = Attachment.objects.all()
    serializer_class = AttachmentSerializer
    lookup_field = "id"
