FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY hltb-scraper/package*.json ./
RUN npm install --omit=dev

COPY hltb-scraper/src ./src

EXPOSE 8788

CMD ["npm", "run", "start"]
