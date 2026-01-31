#!/usr/bin/env bash
set -e

PROJECT_DIR="/app/app"

if [ ! -f "${PROJECT_DIR}/manage.py" ]; then
  echo "ERROR: ${PROJECT_DIR}/manage.py not found."
  ls -la "${PROJECT_DIR}" || true
  exit 1
fi

# Wait for Postgres
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-daytrading}"
POSTGRES_USER="${POSTGRES_USER:-daytrader}"

echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT} ..."
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  sleep 1
done
echo "Postgres is ready."

# Wait for Redis
# NOTE: standard is REDIS_URL. Do NOT require REDIS_PING_URL.
if [ -z "${REDIS_URL:-}" ]; then
  echo "ERROR: REDIS_URL is not set"
  exit 1
fi

echo "Waiting for Redis at ${REDIS_URL} ..."
python - <<'PY'
import os, time
from urllib.parse import urlparse

url = (os.getenv("REDIS_URL") or "").strip()
if not url:
    raise SystemExit("REDIS_URL is empty")

u = urlparse(url)
host = u.hostname or "redis"
port = u.port or 6379
db = int((u.path or "/0").lstrip("/") or "0")

import redis
deadline = time.time() + 30
while True:
    try:
        r = redis.Redis(host=host, port=port, db=db, socket_connect_timeout=1)
        r.ping()
        break
    except Exception:
        if time.time() > deadline:
            raise
        time.sleep(1)
print("Redis is ready.")
PY

MODE="${1:-worker}"

cd "${PROJECT_DIR}"

if [ "${MODE}" = "worker" ]; then
  echo "Starting Celery worker..."
  exec celery -A core worker -l info
elif [ "${MODE}" = "beat" ]; then
  echo "Starting Celery beat..."
  exec celery -A core beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
else
  echo "Unknown mode: ${MODE}"
  exit 1
fi