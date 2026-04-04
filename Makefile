.PHONY: serve-web serve-backend serve-all docker-up docker-down

serve-web:
	nx dev web

serve-backend:
	nx serve api

serve-all:
	npx concurrently "make serve-web" "make serve-backend"

docker-up:
	docker compose up -d

docker-down:
	docker compose down
