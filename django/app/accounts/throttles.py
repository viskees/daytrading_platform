from rest_framework.throttling import SimpleRateThrottle


class PasswordResetIPThrottle(SimpleRateThrottle):
    scope = "password_reset_ip"

    def get_cache_key(self, request, view):
        # DRF helper for IP; respects X-Forwarded-For if configured properly
        ip = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ip}
    
class PasswordResetConfirmIPThrottle(SimpleRateThrottle):
    scope = "password_reset_confirm_ip"

    def get_cache_key(self, request, view):
        ip = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ip}


class PasswordResetConfirmUIDThrottle(SimpleRateThrottle):
    """
    Throttle confirm attempts by uidb64 (not email, since confirm payload has uid/token/password).
    This helps limit brute-force attempts per reset link.
    """
    scope = "password_reset_confirm_uid"

    def get_cache_key(self, request, view):
        uid = (request.data.get("uid") or "").strip()
        if not uid:
            return None
        return self.cache_format % {"scope": self.scope, "ident": uid}


class PasswordResetEmailThrottle(SimpleRateThrottle):
    scope = "password_reset_email"

    def get_cache_key(self, request, view):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return None
        return self.cache_format % {"scope": self.scope, "ident": email}


class LoginIPThrottle(SimpleRateThrottle):
    scope = "login_ip"

    def get_cache_key(self, request, view):
        ip = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ip}


class LoginEmailThrottle(SimpleRateThrottle):
    scope = "login_email"

    def get_cache_key(self, request, view):
        # adjust if your login uses "username" instead of "email"
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return None
        return self.cache_format % {"scope": self.scope, "ident": email}