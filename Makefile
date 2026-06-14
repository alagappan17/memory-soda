.PHONY: serve-dashboard serve-backend serve-all docker-up docker-down

serve-dashboard:
	npx nx dev dashboard

serve-backend:
	npx nx serve api

serve-all:
	npx concurrently "make serve-dashboard" "make serve-backend"

docker-up:
	docker compose up -d

docker-down:
	docker compose down
