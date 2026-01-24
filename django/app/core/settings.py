# core/settings.py
from pathlib import Path
import os
import environ
from datetime import timedelta

# --------------------------------------------------------------------------------------
# Base
# --------------------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)
# Read .env.dev if present (dev)
env_file = os.path.join(BASE_DIR.parent, '.env.dev')
if os.path.exists(env_file):
    environ.Env.read_env(env_file)

SECRET_KEY = env('DJANGO_SECRET_KEY', default='unsafe-dev-key')
DEBUG = env.bool('DJANGO_DEBUG', default=False)

# IMPORTANT: only hosts that actually hit Django
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=[
    "localhost", "127.0.0.1", "admin.localhost"
])

# Frontend base URL used in emails (password reset, activation, etc.)
# Can be explicitly set via FRONTEND_URL in .env files.
_default_host = next((h for h in ALLOWED_HOSTS if h and h != "*"), "localhost")
_default_scheme = "http" if ("localhost" in _default_host or _default_host.startswith("127.")) else "https"
FRONTEND_URL = env("FRONTEND_URL", default=f"{_default_scheme}://{_default_host}")

# Password reset token expiry (Django uses seconds)
# e.g. 3 hours = 10800
PASSWORD_RESET_TIMEOUT = int(os.getenv("PASSWORD_RESET_TIMEOUT", "10800"))

# --------------------------------------------------------------------------------------
# Apps
# --------------------------------------------------------------------------------------
INSTALLED_APPS = [
    # Django
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'django_filters',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_otp',
    'django_otp.plugins.otp_static',
    'django_otp.plugins.otp_totp',
    'two_factor',
    "django_celery_beat",
    "channels",

    # Local
    'journal',
    'accounts',
    'feedback',
    'notifications.apps.NotificationsConfig',
    'scanner.apps.ScannerAppConfig',

    # DRF
    'rest_framework_simplejwt.token_blacklist',
]


MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django_otp.middleware.OTPMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / "templates"],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.debug',
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

WSGI_APPLICATION = 'core.wsgi.application'
# Optional, used by Uvicorn/Gunicorn worker:
ASGI_APPLICATION = 'core.asgi.application'

from datetime import timedelta
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=10),   # short access
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),     # 1–2 weeks
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "LEEWAY": 120,
}

# --------------------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------------------
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('POSTGRES_DB', default='daytrading'),
        'USER': env('POSTGRES_USER', default='daytrader'),
        'PASSWORD': env('POSTGRES_PASSWORD', default='daytraderpass'),
        'HOST': env('POSTGRES_HOST', default='postgres'),
        'PORT': env('POSTGRES_PORT', default='5432'),
    }
}

# --------------------------------------------------------------------------------------
# Internationalization
# --------------------------------------------------------------------------------------
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------------------
# Static / Media (served by Caddy via Traefik)
# --------------------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

STORAGES = {
    # uploads (FileField/ImageField)
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {
            "location": MEDIA_ROOT,
            "base_url": MEDIA_URL,
        },
    },
    # collectstatic + SPA assets
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.ManifestStaticFilesStorage",
    },
}

# --------------------------------------------------------------------------------------
# DRF
# --------------------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "COERCE_DECIMAL_TO_STRING": False,

    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        # scoped (per-view)
        "scanner_triggers": "240/min",   # 1 request / 0.25s (plenty even with 5s polling)
        "scanner_read": "120/min",
        "scanner_write": "30/min",
        # password reset request
        "password_reset_ip": "5/hour",
        "password_reset_email": "3/hour",
        # password reset confirm (new)
        "password_reset_confirm_ip": "20/hour",
        "password_reset_confirm_uid": "10/hour",

        # login hardening
        "login_ip": "20/hour",
        "login_email": "10/hour",
    },
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ],
}

# --------------------------------------------------------------------------------------
# Cache (important for throttling to be shared across containers)
# --------------------------------------------------------------------------------------
# Use Redis in production if REDIS_URL is set. Safe fallback for dev.
REDIS_URL = env("REDIS_URL", default="redis://redis:6379/1")

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}


# --------------------------------------------------------------------------------------
# CORS / Proxy / CSRF (needed for Traefik TLS)
# --------------------------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    "https://trade-journal.nl",
    "https://admin.trade-journal.nl",
    "https://pgadmin.trade-journal.nl",
]
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# Build from hosts that actually hit Django via HTTPS
CSRF_TRUSTED_ORIGINS = [f"https://{h}" for h in ALLOWED_HOSTS if h != '*']
CSRF_COOKIE_SAMESITE = "Lax"        # or "None" (requires HTTPS)
# When using SameSite=None you must be on HTTPS everywhere

# Email / SMTP
# In dev: override via .env.dev to use Mailpit (SMTP on mailpit:1025).
# In prod: point these to your real SMTP server (Postfix, etc.).
EMAIL_BACKEND = env(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)
DEFAULT_FROM_EMAIL = env(
    "DEFAULT_FROM_EMAIL",
    default="no-reply@trade-journal.local",
)
ADMIN_NOTIFY_EMAIL = env("ADMIN_NOTIFY_EMAIL", default="")

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/admin/"
LOGOUT_REDIRECT_URL = "/"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

PASSWORD_RESET_LOGOUT_ALL = env.bool("PASSWORD_RESET_LOGOUT_ALL", default=True)

SCANNER_ADMIN_EMAIL = env("SCANNER_ADMIN_EMAIL", default="")
# --------------------------------------------------------------------------------------

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL

CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "Europe/Amsterdam"