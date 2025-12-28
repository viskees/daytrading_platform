from rest_framework.routers import DefaultRouter
from .views import FeatureRequestViewSet, RoadmapItemViewSet, BugReportViewSet

router = DefaultRouter()
router.register(r"features", FeatureRequestViewSet, basename="feature")
router.register(r"roadmap", RoadmapItemViewSet, basename="roadmap")
router.register(r"bugs", BugReportViewSet, basename="bug")

urlpatterns = router.urls