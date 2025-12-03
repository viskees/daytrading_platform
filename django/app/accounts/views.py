from django.core.mail import send_mail
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from .tokens import make_email_token, read_email_token
from rest_framework.decorators import api_view, permission_classes
from rest_framework import generics, permissions
from rest_framework import generics, serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from .serializers import RegisterSerializer, PasswordChangeSerializer

User = get_user_model()

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
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def resend_verification(request):
    email = request.data.get("email")
    if not email:
        return Response({"detail": "email required"}, status=400)
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return Response({"detail": "ok"}, status=200)  # don't leak
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
    # Mark verified (if you track it). Here we set is_active=True (optional)
    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])
    return Response({"detail": "verified"}, status=200)

User = get_user_model()


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
    Return data about the currently authenticated user.
    GET /api/auth/me/
    """
    serializer_class = MeSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(generics.GenericAPIView):
    """
    POST /api/auth/change-password/
    Payload: { old_password, new_password }
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