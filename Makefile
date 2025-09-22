SHELL := /usr/bin/env bash

.PHONY: help dev-up dev-down dev-logs django-shell superuser prod-up prod-down prod-logs dev-restart-django dev-logs-django dev-logs-traefik frontend-build frontend-clean

help:
	@echo "Dev:"
	@echo "  make dev-up         # start dev stack"
	@echo "  make dev-down       # stop dev stack"
	@echo "  make dev-logs       # follow logs"
	@echo "  make django-shell   # open django shell in dev"
	@echo "Prod:"
	@echo "  make prod-up        # start prod stack"
	@echo "  make prod-down      # stop prod stack"
	@echo "Misc:"
	@echo "  make superuser      # create django superuser (dev)"

dev-up:
	make frontend-build
	docker compose --env-file .env.dev -f docker-compose.dev.yml up -d

dev-down:
	docker compose -f docker-compose.dev.yml down -v

dev-logs:
	docker compose -f docker-compose.dev.yml logs -f --tail=200

django-shell:
	docker compose -f docker-compose.dev.yml exec django python /app/app/manage.py shell

superuser:
	docker compose -f docker-compose.dev.yml exec django python /app/app/manage.py createsuperuser

prod-up:
	docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

prod-down:
	docker compose --env-file .env.prod -f docker-compose.prod.yml down -v

prod-logs:
	docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200

dev-restart-django:
	docker compose -f docker-compose.dev.yml up -d --no-deps --build django

dev-logs-django:
	docker compose -f docker-compose.dev.yml logs -f django

dev-logs-traefik:
	docker compose -f docker-compose.dev.yml logs -f traefik

frontend-build:
	docker compose --env-file .env.dev -f docker-compose.dev.yml run --rm frontend-build

frontend-clean:
	rm -rf django/app/staticfiles/frontend
