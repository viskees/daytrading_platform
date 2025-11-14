from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
import datetime
from django.conf import settings
from django.utils import timezone
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

User = get_user_model()

class EmailOnlyTokenSerializer(TokenObtainPairSerializer):
    """
    Accepts { "email": "...", "password": "..." }.
    We add an 'email' field and remove the requirement for 'username'.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # add email field; make username optional (or drop it)
        self.fields['email'] = serializers.EmailField(required=True, write_only=True)
        # Make 'username' not required so DRF stops complaining if present
        if 'username' in self.fields:
            self.fields['username'].required = False

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip()
        password = attrs.get("password") or ""
        if not email or not password:
            raise serializers.ValidationError({"detail": "Email and password are required."})

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            raise serializers.ValidationError({"detail": "No active account found with the given credentials"})

        # SimpleJWT expects a 'username' internally; map it from the user we found
        username_field = getattr(User, "USERNAME_FIELD", "username")
        attrs["username"] = getattr(user, username_field)
        # Keep password as-is
        attrs["password"] = password
        return super().validate(attrs)

class EmailOnlyTokenView(TokenObtainPairView):
    serializer_class = EmailOnlyTokenSerializer


class CookieTokenObtainPairView(EmailOnlyTokenView):
    """
    On success:
      - Set refresh token as HttpOnly cookie
      - Return only { "access": "<...>" } in body
    """
    def post(self, request, *args, **kwargs):
        resp = super().post(request, *args, **kwargs)
        if resp.status_code != status.HTTP_200_OK:
            return resp

        data = resp.data
        access = data.get("access")
        refresh = data.get("refresh")
        if not (access and refresh):
            return resp

        # replace body: only access
        resp.data = {"access": access}

        # set cookie
        max_age = int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())
        secure = True
        samesite = "Lax"   # or "None" with HTTPS only
        resp.set_cookie(
            "refresh",
            refresh,
            max_age=max_age,
            path="/api/auth/jwt/",
            httponly=True,
            secure=secure,
            samesite=samesite,
        )
        return resp


class CookieTokenRefreshView(TokenRefreshView):
    """
    Read refresh token from HttpOnly cookie, issue new access, rotate cookie.
    Body returns only { "access": "<...>" }.
    """
    def post(self, request, *args, **kwargs):
        refresh_cookie = request.COOKIES.get("refresh")
        if not refresh_cookie:
            return Response({"detail": "No refresh cookie"}, status=status.HTTP_401_UNAUTHORIZED)

        # Build the serializer *explicitly* with cookie-backed refresh
        serializer = self.get_serializer(data={"refresh": refresh_cookie})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as e:
            raise InvalidToken(e.args[0])

        # validated_data may include "access" and (if rotating) "refresh"
        data = serializer.validated_data
        access = data.get("access")
        new_refresh = data.get("refresh")

        resp = Response({"access": access}, status=status.HTTP_200_OK)

        # If rotation produced a new refresh token, overwrite the cookie
        if new_refresh:
            max_age = int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())
            resp.set_cookie(
                "refresh",
                new_refresh,
                max_age=max_age,
                path="/api/auth/jwt/",
                httponly=True,
                secure=True,      # dev: OK on https://localhost even if cert is self-signed
                samesite="Lax",   # or "None" if cross-site + HTTPS
            )
        return resp

class LogoutView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        # blacklist all outstanding tokens for this user (server-side logout)
        tokens = OutstandingToken.objects.filter(user=request.user)
        for t in tokens:
            BlacklistedToken.objects.get_or_create(token=t)
        resp = Response({"detail": "Logged out"})
        resp.delete_cookie("refresh", path="/api/auth/jwt/")
        return resp
