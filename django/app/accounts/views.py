# accounts/views.py
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.urls import reverse

from django_otp import devices_for_user
from django_otp.plugins.otp_totp.models import TOTPDevice

from rest_framework import generics, permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import render

from .serializers import (
    RegisterSerializer,
    MeSerializer,
    TwoFactorVerifySerializer,
)
from .tokens import make_email_token, read_email_token
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.core.mail import send_mail
from django.contrib.auth.password_validation import validate_password
from .throttles import (
    PasswordResetIPThrottle,
    PasswordResetEmailThrottle,
    PasswordResetConfirmIPThrottle,
    PasswordResetConfirmUIDThrottle,
)

from notifications.dispatcher import emit
from notifications import events

User = get_user_model()
token_generator = PasswordResetTokenGenerator()

User = get_user_model()


# ----------------------------------------------------------------------
# Email verification helpers
# ----------------------------------------------------------------------
def _send_verify_email(user, request):
    """
    Send a verification email using an HTML template with a plain-text fallback.
    Used both for initial registration and for resend.
    """
    token = make_email_token(user.id)
    verify_url = request.build_absolute_uri(
        reverse("verify-email")
    ) + f"?token={token}"

    context = {
        "user": user,
        "activation_url": verify_url,
        "site_name": getattr(settings, "SITE_NAME", "Trade Journal"),
    }

    subject = "Verify your Trade Journal account"
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@example.com")

    # Render HTML template
    html_body = render_to_string("email/verify_email.html", context)
    # Plain-text fallback for mail clients that don't support HTML
    text_body = strip_tags(html_body)

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=[user.email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)

def blacklist_all_refresh_tokens_for_user(user):
    """
    Blacklist all outstanding SimpleJWT refresh tokens for a user.
    Safe no-op if blacklist app isn't installed.
    """
    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
    except Exception:
        return

    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)

class RegisterView(generics.CreateAPIView):
    """
    POST /api/auth/register/
    Body: { "email": "...", "password": "..." }
    """
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def perform_create(self, serializer):
        user = serializer.save()
    
        # Notify admin (internal)
        emit(
            events.USER_REGISTERED,
            {
                "user_id": user.id,
                "email": getattr(user, "email", ""),
                "created_at": getattr(user, "date_joined", ""),
            },
            request=self.request,
        )
    
        # Existing behavior: send verify email
        try:
            _send_verify_email(user, self.request)
        except Exception:
            pass


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def resend_verification(request):
    email = request.data.get("email")
    if not email:
        return Response({"detail": "email required"}, status=400)
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        # Niet lekken dat e-mail niet bestaat
        return Response({"detail": "ok"}, status=200)
    _send_verify_email(user, request)
    return Response({"detail": "sent"}, status=200)


# No DRF decorators anymore – this is now a normal Django view
def verify_email(request):
    """
    Email verification endpoint used by the link in the activation mail.

    It still performs the same activation logic, but shows a
    human-friendly HTML page instead of JSON.
    """
    token = request.GET.get("token")
    context = {}

    if not token:
        context["status"] = "missing-token"
        return render(
            request,
            "email/verify_email_result.html",
            context,
            status=400,
        )

    from .tokens import read_email_token  # already imported at top, so you may omit this line
    from django.contrib.auth import get_user_model

    User = get_user_model()

    try:
        uid = read_email_token(token)
        user = User.objects.get(id=uid)
    except Exception:
        context["status"] = "invalid-token"
        return render(
            request,
            "email/verify_email_result.html",
            context,
            status=400,
        )

    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])

    context["status"] = "success"
    context["user_email"] = user.email

    return render(
        request,
        "email/verify_email_result.html",
        context,
        status=200,
    )


# ----------------------------------------------------------------------
# Me + password change
# ----------------------------------------------------------------------


class MeView(generics.RetrieveUpdateAPIView):
     """
     GET  /api/auth/me/
     PATCH /api/auth/me/   (update first_name/last_name)
     """
     serializer_class = MeSerializer
     permission_classes = [IsAuthenticated]
 
     def get_object(self):
         return self.request.user


class PasswordChangeView(generics.GenericAPIView):
    """
    POST /api/auth/password-change/
    Body: { "old_password": "...", "new_password": "..." }
    """
    permission_classes = [IsAuthenticated]

    class InputSerializer(serializers.Serializer):
        old_password = serializers.CharField(write_only=True)
        new_password = serializers.CharField(write_only=True)

    serializer_class = InputSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        old_pw = serializer.validated_data["old_password"]
        new_pw = serializer.validated_data["new_password"]

        if not user.check_password(old_pw):
            return Response(
                {"detail": "Old password is not correct."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_pw)
        user.save(update_fields=["password"])

        return Response({"detail": "Password changed successfully."})


# ----------------------------------------------------------------------
# 2FA / TOTP JSON API for SPA
# ----------------------------------------------------------------------
class TwoFactorStatusView(APIView):
    """
    GET /api/auth/2fa/status/
    -> { "enabled": true/false }
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user
        confirmed_devices = [
            d
            for d in devices_for_user(user)
            if isinstance(d, TOTPDevice) and getattr(d, "confirmed", True)
        ]
        return Response({"enabled": bool(confirmed_devices)})


class TwoFactorSetupView(APIView):
    """
    POST /api/auth/2fa/setup/
    Create (or reuse) an unconfirmed TOTP device and return otpauth:// URL.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        user = request.user

        # Als er al een confirmed device is -> niks nieuws aanmaken.
        confirmed_devices = [
            d
            for d in devices_for_user(user)
            if isinstance(d, TOTPDevice) and getattr(d, "confirmed", True)
        ]
        if confirmed_devices:
            return Response(
                {"detail": "2FA is already enabled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        device, created = TOTPDevice.objects.get_or_create(
            user=user,
            name="default",
            defaults={"confirmed": False},
        )

        import base64
        from urllib.parse import quote

        try:
            secret_b32 = base64.b32encode(device.bin_key).decode("utf-8").rstrip("=")
        except AttributeError:
            secret_b32 = base64.b32encode(device.key).decode("utf-8").rstrip("=")

        issuer = getattr(settings, "TWO_FACTOR_ISSUER", None) or getattr(
            settings, "OTP_TOTP_ISSUER", "Daytrading App"
        )
        label = f"{issuer}:{user.email or user.username}"
        otpauth_url = (
            f"otpauth://totp/{quote(label)}"
            f"?secret={secret_b32}&issuer={quote(issuer)}"
        )

        if hasattr(device, "confirmed") and device.confirmed:
            device.confirmed = False
            device.save(update_fields=["confirmed"])

        return Response(
            {
                "otpauth_url": otpauth_url,
                "issuer": issuer,
                "label": label,
            },
            status=status.HTTP_200_OK,
        )


class TwoFactorConfirmView(APIView):
    """
    POST /api/auth/2fa/confirm/
    Body: { "token": "123456" }
    Markeer device als confirmed als token klopt.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        user = request.user
        token = (request.data.get("token") or "").strip()

        if not token:
            return Response(
                {"detail": "Token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            device = TOTPDevice.objects.filter(user=user).order_by("-id")[0]
        except IndexError:
            return Response(
                {"detail": "No TOTP device found. Start setup first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not device.verify_token(token):
            return Response(
                {"detail": "Invalid token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if hasattr(device, "confirmed"):
            device.confirmed = True
            device.save(update_fields=["confirmed"])

        return Response({"detail": "2FA enabled."}, status=status.HTTP_200_OK)


class TwoFactorDisableView(APIView):
    """
    POST /api/auth/2fa/disable/
    Verwijdert alle TOTP devices voor deze user.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        user = request.user
        TOTPDevice.objects.filter(user=user).delete()
        return Response({"detail": "2FA disabled."}, status=status.HTTP_200_OK)


class TwoFactorVerifyView(APIView):
    """
    POST /api/auth/me/2fa/verify/
    Body: { "token": "123456" }
    Dry-run check; handig voor UX maar niet strikt nodig voor login-flow.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TwoFactorVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data["token"]

        try:
            device = TOTPDevice.objects.filter(user=request.user).latest("id")
        except TOTPDevice.DoesNotExist:
            return Response(
                {"detail": "No TOTP device configured."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not device.verify_token(token):
            return Response(
                {"detail": "Invalid code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({"detail": "Token verified."})

class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetIPThrottle, PasswordResetEmailThrottle]

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response({"detail": "Email is required."}, status=400)

        try:
            user = User.objects.get(email__iexact=email, is_active=True)
        except User.DoesNotExist:
            # IMPORTANT: basic phase still returns generic response
            return Response(
                {"detail": "If the email exists, a reset link has been sent."},
                status=status.HTTP_200_OK,
            )

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = token_generator.make_token(user)

        reset_url = (
            f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}"
        )

        send_mail(
            subject="Reset your password",
            message=f"Reset your password:\n\n{reset_url}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )

        return Response(
            {"detail": "If the email exists, a reset link has been sent."},
            status=status.HTTP_200_OK,
        )
    
    
class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetConfirmIPThrottle, PasswordResetConfirmUIDThrottle]

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password")

        # Same response on any failure
        generic_fail = Response({"detail": "Invalid reset link."}, status=400)

        if not all([uidb64, token, password]):
            return generic_fail

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid, is_active=True)
        except (User.DoesNotExist, ValueError, TypeError):
            return generic_fail

        if not token_generator.check_token(user, token):
            return generic_fail

        try:
            validate_password(password, user)
        except Exception:
            # don’t leak password policy details here
            return generic_fail

        user.set_password(password)
        user.save(update_fields=["password"])

        if getattr(settings, "PASSWORD_RESET_LOGOUT_ALL", True):
            blacklist_all_refresh_tokens_for_user(user)

        return Response({"detail": "Password has been reset successfully."}, status=status.HTTP_200_OK)