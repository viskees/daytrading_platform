from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

User = get_user_model()


def _has_field(model, name: str) -> bool:
    return any(f.name == name for f in model._meta.get_fields())


class RegisterSerializer(serializers.Serializer):
    """
    Public registration serializer used by:
        POST /api/auth/register/

    Creates a new user with:
      - email (unique, case-insensitive)
      - password (validated via Django's password validators)
      - optional display_name (mapped to first_name if present)

    IMPORTANT:
      - We explicitly set is_active = False for newly registered users.
      - The /api/auth/verify-email/ endpoint will flip is_active to True
        after the user clicks the verification link.

    This ensures that users CANNOT log in until they confirm their email.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    display_name = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=150,
    )

    def validate_email(self, value):
        email = value.lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Email already registered.")
        return email

    def validate_password(self, value):
        validate_password(value)
        return value

    @transaction.atomic
    def create(self, validated_data):
        email = validated_data["email"].lower()
        display = validated_data.get("display_name") or email.split("@")[0]

        # Base kwargs for user creation
        kwargs = {"email": email}
        # Map email -> username if the model has a username field
        if _has_field(User, "username"):
            kwargs["username"] = email

        # Create the user using the standard helper
        user = User.objects.create_user(
            password=validated_data["password"],
            **kwargs,
        )

        # Set first_name if present on the model
        # (we do this before saving is_active, so we can use one save call)
        if _has_field(User, "first_name"):
            user.first_name = display

        # NEW: Make freshly registered users INACTIVE until they verify
        # via the email link. This works with both the default User model
        # and any custom one that still has an is_active field.
        update_fields = []

        if _has_field(User, "first_name"):
            update_fields.append("first_name")

        if _has_field(User, "is_active"):
            user.is_active = False
            update_fields.append("is_active")

        if update_fields:
            user.save(update_fields=update_fields)

        return user

    # Control what the API returns after 201 Created
    def to_representation(self, instance):
        return {"id": instance.pk, "email": instance.email}


class MeSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for the /api/auth/me/ endpoint.
    """

    class Meta:
        model = User
        fields = ("id", "email", "last_login")


class PasswordChangeSerializer(serializers.Serializer):
    """
    Serializer for changing password for the currently authenticated user.
    Used by POST /api/auth/password-change/
    """

    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Old password is not correct.")
        return value

    def validate_new_password(self, value):
        user = self.context["request"].user
        # reuse Django's password validators
        validate_password(value, user)
        return value

    def save(self, **kwargs):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class TwoFactorVerifySerializer(serializers.Serializer):
    """
    Simple serializer for verifying a TOTP token.
    Used by 2FA-related endpoints.
    """

    token = serializers.CharField(max_length=20)