FROM node:20-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm install

COPY server/src ./src
COPY worker/src ../worker/src

EXPOSE 3000

CMD ["npm", "run", "start"]
