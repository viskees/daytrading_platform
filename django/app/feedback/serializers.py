from rest_framework import serializers
from .models import FeatureRequest, RoadmapItem, BugReport


class FeatureRequestSerializer(serializers.ModelSerializer):
    votes = serializers.IntegerField(source="votes.count", read_only=True)

    class Meta:
        model = FeatureRequest
        fields = ["id", "title", "description", "created_by", "created_at", "votes"]
        read_only_fields = ["created_by", "created_at", "votes"]


class RoadmapItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoadmapItem
        fields = ["id", "title", "description", "order", "is_public", "created_at", "updated_at"]


class BugReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = BugReport
        fields = ["id", "title", "description", "status", "created_by", "created_at", "updated_at"]
        read_only_fields = ["created_by", "created_at", "updated_at"]