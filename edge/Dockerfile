FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY angular.json ngsw-config.json tsconfig.json tsconfig.app.json tsconfig.spec.json ionic.config.json capacitor.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM caddy:2.8-alpine

COPY edge/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/www/browser /srv

EXPOSE 8080
