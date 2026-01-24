from django.conf import settings
from rest_framework.permissions import BasePermission, SAFE_METHODS


def is_scanner_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    # Strongest: explicit email match if configured
    admin_email = getattr(settings, "SCANNER_ADMIN_EMAIL", "") or ""
    if admin_email and getattr(user, "email", "").lower() == admin_email.lower():
        return True
    # Fallbacks
    return bool(user.is_superuser or user.is_staff)


class IsScannerAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return is_scanner_admin(request.user)