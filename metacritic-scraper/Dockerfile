FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV TZ=Europe/Zurich

COPY metacritic-scraper/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY metacritic-scraper/src ./src

EXPOSE 8789

CMD ["npm", "run", "start"]
