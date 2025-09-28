# accounts/urls.py
from django.urls import path
from .views import RegisterView, verify_email, resend_verification

urlpatterns = [
    path("register", RegisterView.as_view(), name="register"),
    path("register/", RegisterView.as_view(), name="register"),
    path("verify-email", verify_email, name="verify-email"),
    path("verify-email/", verify_email, name="verify-email"),
    path("resend-verification", resend_verification, name="resend-verification"),
    path("resend-verification/", resend_verification, name="resend-verification"),
]

