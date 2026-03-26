FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app/psprices-scraper

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV TZ=Europe/Zurich

COPY psprices-scraper/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY psprices-scraper/src ./src
COPY shared ../../app/shared

EXPOSE 8790

CMD ["npm", "run", "start"]
