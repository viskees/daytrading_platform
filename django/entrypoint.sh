#!/usr/bin/env bash
set -e

# Bootstrap a minimal project on first run
if [ ! -f "/app/app/manage.py" ]; then
  echo "No Django project detected. Creating skeleton 'core'..."
  django-admin startproject core app

  cat >> /app/app/core/settings.py <<'PY'
import os
from pathlib import Path
import environ
env = environ.Env(DEBUG=(bool, False))
BASE_DIR = Path(__file__).resolve().parent.parent
# Read .env if present (dev)
env_file = os.path.join(Path(__file__).resolve().parent.parent.parent, '.env.dev')
if os.path.exists(env_file):
    environ.Env.read_env(env_file)

SECRET_KEY = env('DJANGO_SECRET_KEY', default='unsafe-dev-key')
DEBUG = env('DJANGO_DEBUG', default=False)
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=["*"])


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
WSGI_APPLICATION = 'core.wsgi.application'   # kept for compatibility
ASGI_APPLICATION = 'core.asgi.application'   # enable ASGI

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

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.ManifestStaticFilesStorage"
    }
}

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
CSRF_TRUSTED_ORIGINS = [f"https://{h}" for h in ALLOWED_HOSTS if h not in ['*']]
PY

  mkdir -p /app/app/templates
  printf '%s\n' "<h1>Daytrading App — Hello from Django (ASGI)</h1>" > /app/app/templates/index.html
  cat > /app/app/core/urls.py <<'PY'
from django.contrib import admin
from django.urls import path
from django.shortcuts import render
def home(request): return render(request, "index.html")
urlpatterns = [path('admin/', admin.site.urls), path('', home, name='home')]
PY
fi

# Wait for Postgres
echo "Waiting for Postgres at ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432} ..."
if command -v pg_isready >/dev/null 2>&1; then
  until pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" \
    -U "${POSTGRES_USER:-daytrader}" -d "${POSTGRES_DB:-daytrading}" >/dev/null 2>&1; do
    sleep 1
  done
else
  python - <<'PY'
import os, time, psycopg2
while True:
    try:
        psycopg2.connect(
            host=os.getenv("POSTGRES_HOST","postgres"),
            port=os.getenv("POSTGRES_PORT","5432"),
            dbname=os.getenv("POSTGRES_DB","daytrading"),
            user=os.getenv("POSTGRES_USER","daytrader"),
            password=os.getenv("POSTGRES_PASSWORD","daytraderpass"),
        ).close()
        break
    except Exception:
        time.sleep(1)
PY
fi
echo "Postgres is ready."

# Migrate (retry a couple times just in case)
for i in 1 2 3; do
  python /app/app/manage.py migrate --noinput && break
  echo "Migrate failed (attempt $i), retrying in 2s..." && sleep 2
done

# Check static files directory permissions
echo "Checking static root..."
mkdir -p /app/app/staticfiles
if [ ! -w /app/app/staticfiles ]; then
  echo "Static root not writable. Current uid:gid is $(id -u):$(id -g)"
  ls -ld /app/app/staticfiles
  exit 1
fi

# Collect static files - served by caddy
echo "Collecting static..."
python /app/app/manage.py collectstatic --noinput

# Run ASGI app
if [ "${DJANGO_DEBUG}" = "1" ]; then
  echo "Starting Django (dev) with Uvicorn (ASGI + reload) ..."
  exec uvicorn core.asgi:application \
  --host 0.0.0.0 --port 8000 --reload \
  --app-dir /app/app

else
  echo "Starting Django (prod) with Gunicorn+UvicornWorker ..."
  python /app/app/manage.py collectstatic --noinput
  exec gunicorn core.asgi:application -k uvicorn.workers.UvicornWorker \
     --chdir /app/app --bind 0.0.0.0:8000 --workers 3 --timeout 60

fi
