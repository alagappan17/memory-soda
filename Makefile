.PHONY: serve-dashboard serve-backend serve-all

serve-dashboard:
	npx nx dev dashboard

serve-backend:
	npx nx serve api

serve-all:
	npx concurrently "make serve-dashboard" "make serve-backend"
