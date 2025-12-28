from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import FeatureRequest, FeatureVote, RoadmapItem, BugReport
from .serializers import FeatureRequestSerializer, RoadmapItemSerializer, BugReportSerializer
from .permissions import IsOwnerOrAdmin


class FeatureRequestViewSet(viewsets.ModelViewSet):
    serializer_class = FeatureRequestSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_queryset(self):
        return FeatureRequest.objects.all().order_by("-created_at", "-id")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post", "delete"])
    def vote(self, request, pk=None):
        feature = self.get_object()

        if request.method == "POST":
            FeatureVote.objects.get_or_create(feature=feature, user=request.user)
            return Response({"status": "voted"}, status=status.HTTP_200_OK)

        FeatureVote.objects.filter(feature=feature, user=request.user).delete()
        return Response({"status": "unvoted"}, status=status.HTTP_200_OK)


class RoadmapItemViewSet(viewsets.ModelViewSet):
    serializer_class = RoadmapItemSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = RoadmapItem.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(is_public=True)
        return qs

    def get_permissions(self):
        # Non-admin users: read-only
        if not self.request.user.is_staff and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [permissions.IsAdminUser()]
        return super().get_permissions()


class BugReportViewSet(viewsets.ModelViewSet):
    serializer_class = BugReportSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_queryset(self):
        return BugReport.objects.all()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)