FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY hltb-scraper/package*.json ./
RUN npm ci --omit=dev

COPY hltb-scraper/src ./src

EXPOSE 8788

CMD ["npm", "run", "start"]
