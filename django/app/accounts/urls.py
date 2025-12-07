# accounts/urls.py
from django.urls import path

from .views import (
    RegisterView,
    MeView,
    PasswordChangeView,
    resend_verification,
    verify_email,
    TwoFactorStatusView,
    TwoFactorSetupView,
    TwoFactorConfirmView,
    TwoFactorDisableView,
    TwoFactorVerifyView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("me/", MeView.as_view(), name="me"),
    path("password-change/", PasswordChangeView.as_view(), name="password-change"),

    path("verify-email/", verify_email, name="verify-email"),
    path("resend-verification/", resend_verification, name="resend-verification"),

    # 2FA JSON API
    path("2fa/status/", TwoFactorStatusView.as_view(), name="twofactor-status"),
    path("2fa/setup/", TwoFactorSetupView.as_view(), name="twofactor-setup"),
    path("2fa/confirm/", TwoFactorConfirmView.as_view(), name="twofactor-confirm"),
    path("2fa/disable/", TwoFactorDisableView.as_view(), name="twofactor-disable"),
    path("me/2fa/verify/", TwoFactorVerifyView.as_view(), name="twofactor-verify"),
]