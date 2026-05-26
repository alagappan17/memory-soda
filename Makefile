.PHONY: serve-dashboard serve-backend serve-all docker-up docker-down

serve-dashboard:
	nx dev dashboard

serve-backend:
	nx serve api

serve-all:
	npx concurrently "make serve-dashboard" "make serve-backend"

docker-up:
	docker compose up -d

docker-down:
	docker compose down
