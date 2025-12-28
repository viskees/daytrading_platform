from django.contrib import admin
from .models import FeatureRequest, RoadmapItem, BugReport, FeatureVote


@admin.register(FeatureRequest)
class FeatureRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "created_by", "created_at")
    search_fields = ("title", "description", "created_by__username")


@admin.register(FeatureVote)
class FeatureVoteAdmin(admin.ModelAdmin):
    list_display = ("id", "feature", "user", "created_at")
    search_fields = ("feature__title", "user__username")


@admin.register(RoadmapItem)
class RoadmapItemAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "order", "is_public", "created_at")
    list_editable = ("order", "is_public")
    search_fields = ("title", "description")


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "status", "created_by", "created_at")
    list_editable = ("status",)
    search_fields = ("title", "description", "created_by__username")