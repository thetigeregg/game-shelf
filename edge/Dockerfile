FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY angular.json ngsw-config.json tsconfig.json tsconfig.app.json tsconfig.spec.json ionic.config.json capacitor.config.ts ./
COPY config ./config
COPY scripts ./scripts
COPY metacritic-scraper/src ./metacritic-scraper/src
COPY src ./src
RUN npm run build

FROM caddy:2.10-alpine

ENV TZ=Europe/Zurich
RUN apk add --no-cache tzdata

COPY edge/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/www/browser /srv

EXPOSE 8080
