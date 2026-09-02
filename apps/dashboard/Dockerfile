FROM node:22-alpine AS build
WORKDIR /app
# Vite inlines VITE_* at build time, so the API URL is a build arg, not runtime.
# Unset -> the app's own localhost:3004 fallback applies; no domain baked in.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN npm ci && npx nx build @memory-soda/dashboard

# Unprivileged variant: non-root, no chown/USER dance for platforms that reject
# root containers (Cloud Run, OpenShift, K8s PSS).
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/apps/dashboard/dist/ /usr/share/nginx/html/
COPY apps/dashboard/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=8080
EXPOSE 8080
