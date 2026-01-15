SHELL := /usr/bin/env bash

DEV_COMPOSE  := docker-compose.dev.yml
PROD_COMPOSE := docker-compose.prod.yml

DEV_ENV  := .env.dev
PROD_ENV := .env.prod

# Compose command wrappers (so we always use the correct env + compose file)
DC_DEV  := docker compose --env-file $(DEV_ENV)  -f $(DEV_COMPOSE)
DC_PROD := docker compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE)

.PHONY: help \
        dev-up dev-down dev-stop dev-restart dev-wipe dev-ps \
        dev-logs dev-logs-django dev-logs-traefik \
        django-shell superuser makemigrations migrate ma \
        frontend-build frontend-clean \
        prod-up prod-down prod-stop prod-restart prod-wipe prod-ps \
        prod-frontend-build prod-logs prod-logs-django prod-logs-traefik \
        prod-migrate prod-shell prod-superuser

help:
	@echo ""
	@echo "Dev:"
	@echo "  make dev-up             # build frontend + (re)build django + start dev stack"
	@echo "  make dev-down           # stop dev stack (keeps volumes/data)"
	@echo "  make dev-stop           # stop containers only (fast, keeps everything)"
	@echo "  make dev-restart        # restart dev stack"
	@echo "  make dev-wipe           # DANGER: stop dev stack AND remove volumes (wipe dev DB)"
	@echo "  make dev-ps             # show dev services"
	@echo "  make dev-logs           # follow logs (dev)"
	@echo "  make dev-logs-django    # follow Django logs (dev)"
	@echo "  make dev-logs-traefik   # follow Traefik logs (dev)"
	@echo "  make django-shell       # open Django shell in dev"
	@echo "  make superuser          # create Django superuser (dev)"
	@echo "  make makemigrations     # run makemigrations (dev)"
	@echo "  make migrate            # run migrate (dev)"
	@echo "  make ma                 # rebuild Django service image (dev only)"
	@echo "  make frontend-build     # build SPA (dev)"
	@echo "  make frontend-clean     # remove built frontend assets"
	@echo ""
	@echo "Prod:"
	@echo "  make prod-up            # start prod stack (build & up)"
	@echo "  make prod-down          # stop prod stack (keeps volumes/data)  ✅ safe"
	@echo "  make prod-stop          # stop containers only (fast, keeps everything)"
	@echo "  make prod-restart       # restart prod stack"
	@echo "  make prod-wipe          # DANGER: stop prod stack AND remove volumes (wipe prod DB)"
	@echo "  make prod-ps            # show prod services"
	@echo "  make prod-frontend-build# build SPA (prod frontend compose)"
	@echo "  make prod-logs          # follow logs (prod)"
	@echo "  make prod-logs-django   # follow Django logs (prod)"
	@echo "  make prod-logs-traefik  # follow Traefik logs (prod)"
	@echo "  make prod-migrate       # run migrate (prod)"
	@echo "  make prod-shell         # open Django shell in prod"
	@echo "  make prod-superuser     # create Django superuser (prod)"

# --------------------
# Dev
# --------------------

dev-up: frontend-build ma
	$(DC_DEV) up -d

# SAFE: stops containers + networks, keeps volumes (DB persists)
dev-down:
	$(DC_DEV) down

# FAST: stops containers only (keeps networks + containers)
dev-stop:
	$(DC_DEV) stop

dev-restart:
	$(DC_DEV) restart

# DANGER: removes named volumes (DB wipe)
dev-wipe:
	$(DC_DEV) down -v

dev-ps:
	$(DC_DEV) ps

dev-logs:
	$(DC_DEV) logs -f --tail=200

dev-logs-django:
	$(DC_DEV) logs -f django

dev-logs-traefik:
	$(DC_DEV) logs -f traefik

django-shell:
	$(DC_DEV) exec django python /app/app/manage.py shell

superuser:
	$(DC_DEV) exec django python /app/app/manage.py createsuperuser

makemigrations:
	$(DC_DEV) exec django python /app/app/manage.py makemigrations

migrate:
	$(DC_DEV) exec django python /app/app/manage.py migrate

# Rebuild Django image only (quick dev iteration)
ma:
	$(DC_DEV) up -d --no-deps --build django

frontend-build:
	$(DC_DEV) run --rm frontend-build

frontend-clean:
	rm -rf django/app/staticfiles/frontend


# --------------------
# Prod
# --------------------

prod-up:
	$(DC_PROD) up -d --build

# SAFE: stops containers + networks, keeps volumes (DB persists)
prod-down:
	$(DC_PROD) down

# FAST: stops containers only
prod-stop:
	$(DC_PROD) stop

prod-restart:
	$(DC_PROD) restart

# DANGER: removes volumes (DB wipe)
prod-wipe:
	$(DC_PROD) down -v

prod-ps:
	$(DC_PROD) ps

prod-frontend-build:
	docker compose -f docker-compose.frontend.yml run --rm frontend-build

prod-logs:
	$(DC_PROD) logs -f --tail=200

prod-logs-django:
	$(DC_PROD) logs -f django

prod-logs-traefik:
	$(DC_PROD) logs -f traefik

prod-migrate:
	$(DC_PROD) exec django python /app/app/manage.py migrate

prod-shell:
	$(DC_PROD) exec django python /app/app/manage.py shell

prod-superuser:
	$(DC_PROD) exec django python /app/app/manage.py createsuperuser