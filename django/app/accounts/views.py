# accounts/views.py
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.urls import reverse

from django_otp import devices_for_user
from django_otp.plugins.otp_totp.models import TOTPDevice

from rest_framework import generics, permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    RegisterSerializer,
    TwoFactorVerifySerializer,
)
from .tokens import make_email_token, read_email_token

User = get_user_model()


# ----------------------------------------------------------------------
# Email verification helpers
# ----------------------------------------------------------------------
def _send_verify_email(user, request):
    token = make_email_token(user.id)
    verify_url = request.build_absolute_uri(reverse("verify-email")) + f"?token={token}"
    send_mail(
        subject="Verify your email",
        message=f"Click to verify: {verify_url}",
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@example.com"),
        recipient_list=[user.email],
        fail_silently=True,
    )


class RegisterView(generics.CreateAPIView):
    """
    POST /api/auth/register/
    Body: { "email": "...", "password": "..." }
    """
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def perform_create(self, serializer):
        user = serializer.save()
        # Optioneel: user pas actief nadat e-mail is bevestigd.
        # Laat dit staan zoals je RegisterSerializer het nu doet.
        try:
            _send_verify_email(user, self.request)
        except Exception:
            # In dev niet crashen als mail niet lukt.
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


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def verify_email(request):
    token = request.GET.get("token")
    if not token:
        return Response({"detail": "missing token"}, status=400)
    try:
        uid = read_email_token(token)
        user = User.objects.get(id=uid)
    except Exception:
        return Response({"detail": "invalid token"}, status=400)

    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])

    return Response({"detail": "verified"}, status=200)


# ----------------------------------------------------------------------
# Me + password change
# ----------------------------------------------------------------------
class MeSerializer(serializers.ModelSerializer):
    """Minimal serializer for the currently logged-in user."""

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "is_staff",
            "is_active",
            "date_joined",
            "last_login",
        )


class MeView(generics.RetrieveAPIView):
    """
    GET /api/auth/me/
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