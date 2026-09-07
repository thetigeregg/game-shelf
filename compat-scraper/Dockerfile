FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app/compat-scraper

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV TZ=Europe/Zurich

COPY compat-scraper/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY compat-scraper/src ./src
COPY shared /app/shared
COPY config /app/config

EXPOSE 8791

CMD ["npm", "run", "start"]
