FROM node:24.14.0-alpine AS build

WORKDIR /app
COPY package*.json ./
ENV HUSKY=0
RUN npm ci --no-audit --no-fund

COPY angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json ionic.config.json capacitor.config.ts ./
COPY config ./config
COPY scripts ./scripts
COPY metacritic-scraper/src ./metacritic-scraper/src
COPY src ./src
RUN npm run build

ARG BUILD_IOS_LIVE_UPDATE=false
ARG IOS_OTA_NATIVE_BUILD_NUMBER
ARG FEATURE_TAS=false

RUN --mount=type=secret,id=IOS_LIVE_UPDATE_PRIVATE_KEY,required=false \
    --mount=type=secret,id=IOS_BACKEND_ORIGIN_PROD,required=false \
  if [ "$BUILD_IOS_LIVE_UPDATE" = "true" ]; then \
    if [ -z "$IOS_OTA_NATIVE_BUILD_NUMBER" ]; then \
      echo "IOS_OTA_NATIVE_BUILD_NUMBER is required when BUILD_IOS_LIVE_UPDATE=true" >&2; \
      exit 1; \
    fi; \
    if [ ! -s /run/secrets/IOS_LIVE_UPDATE_PRIVATE_KEY ]; then \
      echo "IOS_LIVE_UPDATE_PRIVATE_KEY secret must be a non-empty file when BUILD_IOS_LIVE_UPDATE=true" >&2; \
      exit 1; \
    fi; \
    if [ ! -s /run/secrets/IOS_BACKEND_ORIGIN_PROD ]; then \
      echo "IOS_BACKEND_ORIGIN_PROD secret must be a non-empty file when BUILD_IOS_LIVE_UPDATE=true" >&2; \
      exit 1; \
    fi; \
    apk add --no-cache zip; \
    export IOS_BACKEND_ORIGIN_PROD="$(tr -d '\r\n' < /run/secrets/IOS_BACKEND_ORIGIN_PROD)"; \
    export IOS_OTA_NATIVE_BUILD_NUMBER="$IOS_OTA_NATIVE_BUILD_NUMBER"; \
    export IOS_LIVE_UPDATE_PRIVATE_KEY_PATH="/run/secrets/IOS_LIVE_UPDATE_PRIVATE_KEY"; \
    export FEATURE_TAS="$FEATURE_TAS"; \
    node scripts/build-ios-live-update-artifacts.mjs; \
  else \
    mkdir -p ota/ios; \
  fi

FROM caddy:2.11-alpine

ENV TZ=Europe/Zurich
RUN apk add --no-cache tzdata

COPY edge/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/www/browser /srv
COPY --from=build /app/ota /ota

EXPOSE 8080
