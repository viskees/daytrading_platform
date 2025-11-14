#!/usr/bin/env bash
set -e

PROJECT_DIR="/app/app"

# No project bootstrap here. We rely on the repo's Django project exclusively.
if [ ! -f "${PROJECT_DIR}/manage.py" ]; then
  echo "ERROR: ${PROJECT_DIR}/manage.py not found. Did you mount the django app volume correctly?"
  ls -la "${PROJECT_DIR}"
  exit 1
fi

# Wait for Postgres
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-daytrading}"
POSTGRES_USER="${POSTGRES_USER:-daytrader}"

echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT} ..."
if command -v pg_isready >/dev/null 2>&1; then
  until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
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
  python "${PROJECT_DIR}/manage.py" migrate --noinput && break
  echo "Migrate failed (attempt $i), retrying in 2s..." && sleep 2
done

# Check static files directory permissions
echo "Checking static root..."
mkdir -p "${PROJECT_DIR}/staticfiles"
if [ ! -w "${PROJECT_DIR}/staticfiles" ]; then
  echo "Static root not writable. Current uid:gid is $(id -u):$(id -g)"
  ls -ld "${PROJECT_DIR}/staticfiles"
  exit 1
fi

# Check media directory permissions (uploads)
echo "Checking media root..."
mkdir -p "${PROJECT_DIR}/media" "${PROJECT_DIR}/media/journal_attachments"
if ! touch "${PROJECT_DIR}/media/.rwtest" 2>/dev/null; then
  echo "Media root not writable by uid:gid $(id -u):$(id -g)"
  ls -ld "${PROJECT_DIR}/media" || true
  # Helpful hint for bind mount
  echo "If you're on Linux/WSL: chown the host folder:  sudo chown -R \$USER:\$USER django/app/media"
  exit 1
else
  rm -f "${PROJECT_DIR}/media/.rwtest"
fi

# Collect static files - served by caddy
echo "Collecting static..."
python "${PROJECT_DIR}/manage.py" collectstatic --noinput

# Seed strategy tags
echo "Seeding strategy tags..."
python "${PROJECT_DIR}/manage.py" seed_strategy_tags

# Run ASGI app
if [ "${DJANGO_DEBUG}" = "1" ]; then
  echo "Starting Django (dev) with Uvicorn (ASGI + reload) ..."
  exec uvicorn core.asgi:application \
    --host 0.0.0.0 --port 8000 --reload \
    --app-dir "${PROJECT_DIR}"
else
  echo "Starting Django (prod) with Gunicorn+UvicornWorker ..."
  exec gunicorn core.asgi:application \
    -k uvicorn.workers.UvicornWorker \
    --chdir "${PROJECT_DIR}" \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --timeout 60
fi