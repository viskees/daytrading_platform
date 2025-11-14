from django.core.mail import send_mail
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from .tokens import make_email_token, read_email_token
from rest_framework.decorators import api_view, permission_classes
from rest_framework import generics, permissions
from rest_framework.views import APIView
from .serializers import RegisterSerializer

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
