FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npx nx run @memory-soda/api:prune

FROM node:22-alpine
WORKDIR /app
# `prune` emits main.js + a package.json/lockfile scoped to this app's deps only.
COPY --from=build /app/apps/api/dist/ ./
RUN npm ci --omit=dev
USER node
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "main.js"]
