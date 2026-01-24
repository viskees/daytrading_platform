SHELL := /usr/bin/env bash

DEV_COMPOSE  := docker-compose.dev.yml
PROD_COMPOSE := docker-compose.prod.yml

DEV_ENV  := .env.dev
PROD_ENV := .env.prod

DC_DEV  := docker compose --env-file $(DEV_ENV)  -f $(DEV_COMPOSE)
DC_PROD := docker compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE)

.PHONY: help \
        dev-up dev-down dev-stop dev-restart dev-wipe dev-ps \
        dev-build dev-build-all dev-pull \
        dev-logs dev-logs-django dev-logs-traefik dev-logs-celery dev-logs-beat dev-logs-ingestor \
        django-shell superuser makemigrations migrate \
        dev-ingestor-restart dev-celery-restart \
        frontend-build frontend-clean \
        prod-up prod-down prod-stop prod-restart prod-wipe prod-ps \
        prod-build prod-build-all prod-pull \
        prod-logs prod-logs-django prod-logs-traefik prod-logs-celery prod-logs-beat prod-logs-ingestor \
        prod-migrate prod-shell prod-superuser \
        prod-ingestor-restart prod-celery-restart

help:
	@echo ""
	@echo "Dev:"
	@echo "  make dev-up               # build frontend + build python image + start dev stack"
	@echo "  make dev-down             # stop dev stack (keeps volumes/data)  ✅ safe"
	@echo "  make dev-stop             # stop containers only (fast)"
	@echo "  make dev-restart          # restart dev containers"
	@echo "  make dev-wipe             # DANGER: down -v (wipe dev DB/volumes)"
	@echo "  make dev-ps               # show dev services"
	@echo "  make dev-build            # build python image services (django/celery/ingestor)"
	@echo "  make dev-build-all        # build everything (including frontend image)"
	@echo "  make dev-logs             # follow all logs (dev)"
	@echo "  make dev-logs-django      # follow Django logs"
	@echo "  make dev-logs-celery      # follow celery-worker logs"
	@echo "  make dev-logs-beat        # follow celery-beat logs"
	@echo "  make dev-logs-ingestor    # follow scanner-ingestor logs"
	@echo "  make django-shell         # open Django shell (dev)"
	@echo "  make superuser            # create Django superuser (dev)"
	@echo "  make makemigrations       # run makemigrations (dev)"
	@echo "  make migrate              # run migrate (dev)"
	@echo "  make dev-celery-restart   # restart celery worker + beat (dev)"
	@echo "  make dev-ingestor-restart # restart scanner-ingestor (dev)"
	@echo "  make frontend-build       # build SPA (dev)"
	@echo ""
	@echo "Prod:"
	@echo "  make prod-up              # build & up prod stack"
	@echo "  make prod-down            # stop prod stack (keeps volumes/data)  ✅ safe"
	@echo "  make prod-stop            # stop containers only (fast)"
	@echo "  make prod-restart         # restart prod containers"
	@echo "  make prod-wipe            # DANGER: down -v (wipe prod DB/volumes)"
	@echo "  make prod-ps              # show prod services"
	@echo "  make prod-build           # build python image services (django/celery/ingestor)"
	@echo "  make prod-build-all       # build everything"
	@echo "  make prod-logs            # follow all logs (prod)"
	@echo "  make prod-logs-django     # follow Django logs (prod)"
	@echo "  make prod-logs-celery     # follow celery-worker logs (prod)"
	@echo "  make prod-logs-beat       # follow celery-beat logs (prod)"
	@echo "  make prod-logs-ingestor   # follow scanner-ingestor logs (prod)"
	@echo "  make prod-migrate         # run migrate (prod)"
	@echo "  make prod-shell           # open Django shell (prod)"
	@echo "  make prod-superuser       # create Django superuser (prod)"
	@echo "  make prod-celery-restart  # restart celery worker + beat (prod)"
	@echo "  make prod-ingestor-restart# restart scanner-ingestor (prod)"

# --------------------
# Dev
# --------------------

dev-up: frontend-build dev-build
	$(DC_DEV) up -d

dev-down:
	$(DC_DEV) down

dev-stop:
	$(DC_DEV) stop

dev-restart:
	$(DC_DEV) restart

dev-wipe:
	$(DC_DEV) down -v

dev-ps:
	$(DC_DEV) ps

# Build only the Python-image services that share ./django Dockerfile
dev-build:
	$(DC_DEV) build django celery-worker celery-beat scanner-ingestor

# Build everything (usually not needed unless images changed)
dev-build-all:
	$(DC_DEV) build

dev-pull:
	$(DC_DEV) pull

dev-logs:
	$(DC_DEV) logs -f --tail=200

dev-logs-django:
	$(DC_DEV) logs -f --tail=200 django

dev-logs-traefik:
	$(DC_DEV) logs -f --tail=200 traefik

dev-logs-celery:
	$(DC_DEV) logs -f --tail=200 celery-worker

dev-logs-beat:
	$(DC_DEV) logs -f --tail=200 celery-beat

dev-logs-ingestor:
	$(DC_DEV) logs -f --tail=200 scanner-ingestor

django-shell:
	$(DC_DEV) exec django python /app/app/manage.py shell

superuser:
	$(DC_DEV) exec django python /app/app/manage.py createsuperuser

makemigrations:
	$(DC_DEV) exec django python /app/app/manage.py makemigrations

migrate:
	$(DC_DEV) exec django python /app/app/manage.py migrate

dev-celery-restart:
	$(DC_DEV) restart celery-worker celery-beat

dev-ingestor-restart:
	$(DC_DEV) restart scanner-ingestor

frontend-build:
	$(DC_DEV) run --rm frontend-build

frontend-clean:
	rm -rf django/app/staticfiles/frontend


# --------------------
# Prod
# --------------------

prod-up: prod-build
	$(DC_PROD) up -d

prod-down:
	$(DC_PROD) down

prod-stop:
	$(DC_PROD) stop

prod-restart:
	$(DC_PROD) restart

prod-wipe:
	$(DC_PROD) down -v

prod-ps:
	$(DC_PROD) ps

prod-build:
	$(DC_PROD) build django celery-worker celery-beat scanner-ingestor

prod-build-all:
	$(DC_PROD) build

prod-pull:
	$(DC_PROD) pull

prod-logs:
	$(DC_PROD) logs -f --tail=200

prod-logs-django:
	$(DC_PROD) logs -f --tail=200 django

prod-logs-traefik:
	$(DC_PROD) logs -f --tail=200 traefik

prod-logs-celery:
	$(DC_PROD) logs -f --tail=200 celery-worker

prod-logs-beat:
	$(DC_PROD) logs -f --tail=200 celery-beat

prod-logs-ingestor:
	$(DC_PROD) logs -f --tail=200 scanner-ingestor

prod-migrate:
	$(DC_PROD) exec django python /app/app/manage.py migrate

prod-shell:
	$(DC_PROD) exec django python /app/app/manage.py shell

prod-superuser:
	$(DC_PROD) exec django python /app/app/manage.py createsuperuser

prod-celery-restart:
	$(DC_PROD) restart celery-worker celery-beat

prod-ingestor-restart:
	$(DC_PROD) restart scanner-ingestor