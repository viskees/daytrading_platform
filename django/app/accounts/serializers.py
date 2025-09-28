from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

User = get_user_model()

def _has_field(model, name: str) -> bool:
    return any(f.name == name for f in model._meta.get_fields())

class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=150)

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

        kwargs = {"email": email}
        if _has_field(User, "username"):
            kwargs["username"] = email  # map email -> username if field exists

        user = User.objects.create_user(password=validated_data["password"], **kwargs)

        # Set first_name if present on the model
        if _has_field(User, "first_name"):
            user.first_name = display
            user.save(update_fields=["first_name"])

        return user

    # Control what the API returns after 201 Created
    def to_representation(self, instance):
        return {"id": instance.pk, "email": instance.email}
