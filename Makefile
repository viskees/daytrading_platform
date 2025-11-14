SHELL := /usr/bin/env bash

DEV_COMPOSE := docker-compose.dev.yml
PROD_COMPOSE := docker-compose.prod.yml

.PHONY: help \
        dev-up dev-down dev-logs dev-logs-django dev-logs-traefik \
        django-shell superuser makemigrations migrate \
        prod-up prod-down prod-logs \
        ma frontend-build frontend-clean

help:
	@echo "Dev:"
	@echo "  make dev-up           # build frontend + start dev stack"
	@echo "  make dev-down         # stop dev stack (and remove volumes)"
	@echo "  make dev-logs         # follow logs (dev)"
	@echo "  make dev-logs-django  # follow Django logs (dev)"
	@echo "  make dev-logs-traefik # follow Traefik logs (dev)"
	@echo "  make django-shell     # open Django shell in dev"
	@echo "  make superuser        # create Django superuser (dev)"
	@echo "  make makemigrations   # run makemigrations (dev)"
	@echo "  make migrate          # run migrate (dev)"
	@echo "  make ma               # rebuild Django service image (dev only)"
	@echo "  make frontend-build   # build SPA (dev)"
	@echo "  make frontend-clean   # remove built frontend assets"
	@echo ""
	@echo "Prod:"
	@echo "  make prod-up          # start prod stack (build & up)"
	@echo "  make prod-down        # stop prod stack (and remove volumes)"
	@echo "  make prod-logs        # follow logs (prod)"

# --------------------
# Dev
# --------------------

dev-up:
	make frontend-build
	make ma
	docker compose --env-file .env.dev -f $(DEV_COMPOSE) up -d

dev-down:
	docker compose -f $(DEV_COMPOSE) down -v

dev-logs:
	docker compose -f $(DEV_COMPOSE) logs -f --tail=200

dev-logs-django:
	docker compose -f $(DEV_COMPOSE) logs -f django

dev-logs-traefik:
	docker compose -f $(DEV_COMPOSE) logs -f traefik

django-shell:
	docker compose -f $(DEV_COMPOSE) exec django python /app/app/manage.py shell

superuser:
	docker compose -f $(DEV_COMPOSE) exec django python /app/app/manage.py createsuperuser

makemigrations:
	docker compose -f $(DEV_COMPOSE) exec django python /app/app/manage.py makemigrations

migrate:
	docker compose -f $(DEV_COMPOSE) exec django python /app/app/manage.py migrate

# Rebuild Django image only (quick dev iteration)
ma:
	docker compose --env-file .env.dev -f $(DEV_COMPOSE) up -d --no-deps --build django

frontend-build:
	docker compose --env-file .env.dev -f $(DEV_COMPOSE) run --rm frontend-build

frontend-clean:
	rm -rf django/app/staticfiles/frontend

# --------------------
# Prod
# --------------------

prod-up:
	docker compose --env-file .env.prod -f $(PROD_COMPOSE) up -d --build

prod-down:
	docker compose --env-file .env.prod -f $(PROD_COMPOSE) down -v

prod-logs:
	docker compose --env-file .env.prod -f $(PROD_COMPOSE) logs -f --tail=200