FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./

RUN npm ci && \
    npm install typescript @types/node ts-node --save-dev

COPY src ./src
COPY env.example ./

RUN npm run build

RUN mkdir -p /app/data

VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV DB_PATH=/app/data/alyabot.db

CMD ["node", "dist/index.js"]

