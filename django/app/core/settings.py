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

    # Local
    'journal',
    'accounts',

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
    ],
    "DEFAULT_THROTTLE_RATES": {
        "user": "2000/day",
        "anon": "200/day",
    },

    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ],
}

# --------------------------------------------------------------------------------------
# CORS / Proxy / CSRF (needed for Traefik TLS)
# --------------------------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = True  # tighten in prod
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# Build from hosts that actually hit Django via HTTPS
CSRF_TRUSTED_ORIGINS = [f"https://{h}" for h in ALLOWED_HOSTS if h != '*']
CSRF_COOKIE_SAMESITE = "Lax"        # or "None" (requires HTTPS)
# When using SameSite=None you must be on HTTPS everywhere

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
