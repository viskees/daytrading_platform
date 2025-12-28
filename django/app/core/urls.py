# core/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.shortcuts import render

from django.conf import settings
from django.conf.urls.static import static

from rest_framework_simplejwt.views import TokenVerifyView

from django.views.decorators.csrf import ensure_csrf_cookie

from accounts.auth import (
    CookieTokenObtainPairView,
    CookieTokenRefreshView,
    LogoutView,
)

# Import the concrete list of patterns explicitly
from two_factor.urls import urlpatterns as tf_urls

@ensure_csrf_cookie
def spa(request):
    return render(request, "index.html")


urlpatterns = [
    path("admin/", admin.site.urls),

    # ✅ Django auth under /accounts/
    path("accounts/", include("django.contrib.auth.urls")),

    # 2FA at root (already carries app_name='two_factor')
    path("", include(tf_urls, namespace="two_factor")),

    # --- JWT auth endpoints used by the SPA ---
    path(
        "api/auth/jwt/token/",
        CookieTokenObtainPairView.as_view(),
        name="token_obtain_pair",
    ),
    path(
        "api/auth/jwt/refresh/",
        CookieTokenRefreshView.as_view(),
        name="token_refresh",
    ),
    path(
        "api/auth/jwt/verify/",
        TokenVerifyView.as_view(),
        name="token_verify",
    ),
    path(
        "api/auth/logout/",
        LogoutView.as_view(),
        name="logout",
    ),

    # --- App APIs ---
    path("api/auth/", include("accounts.urls")),   # register / verify-email / resend
    path("api/journal/", include("journal.urls")),
    path("api/feedback/", include("feedback.urls")),

    # SPA fallback
    # Do not swallow admin, api, static/media, or pgadmin with the SPA fallback
    re_path(
        r"^(?!admin/|accounts/login/|api/|pgadmin/|static/|media/).*$",
        spa,
        name="spa",
    ),
]

# Serve uploaded files (images) in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)