# core/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.shortcuts import render
from rest_framework_simplejwt.views import (
    TokenObtainPairView, TokenRefreshView, TokenVerifyView,
)

# Import the concrete list of patterns explicitly
from two_factor.urls import urlpatterns as tf_urls

def spa(request):
    return render(request, "index.html")

urlpatterns = [
    path("admin/", admin.site.urls),

    # ✅ Django auth under /account/
    path("account/", include("django.contrib.auth.urls")),

    # Mount 2FA AT ROOT, and pass the tuple directly to include()
    # (it already carries app_name='two_factor')
    path("", include(tf_urls, namespace="two_factor")),

    # JWT
    path("api/auth/jwt/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/jwt/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/jwt/verify/", TokenVerifyView.as_view(), name="token_verify"),

    # Apps
    path("api/auth/", include("accounts.urls")),
    path("api/journal/", include("journal.urls")),

    # SPA fallback
    re_path(r"^(?!admin/|api/|static/|media/).*$", spa, name="spa"),
]
