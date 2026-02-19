FROM node:20-alpine

WORKDIR /app/server
ENV TZ=Europe/Zurich

RUN apk add --no-cache tzdata

COPY server/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY server/src ./src
COPY worker/src ../worker/src

EXPOSE 3000

CMD ["npm", "run", "start"]
