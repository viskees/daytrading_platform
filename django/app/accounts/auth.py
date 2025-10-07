from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

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
