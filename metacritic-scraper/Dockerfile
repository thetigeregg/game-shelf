FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app/metacritic-scraper

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV TZ=Europe/Zurich

COPY metacritic-scraper/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY metacritic-scraper/src ./src
COPY shared /app/shared

EXPOSE 8789

CMD ["npm", "run", "start"]
