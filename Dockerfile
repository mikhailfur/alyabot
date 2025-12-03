FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./

RUN npm ci && \
    npm install typescript @types/node ts-node --save-dev

COPY src ./src
COPY env.example ./

WORKDIR /app/web-app
COPY web-app/package.json web-app/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY web-app/ ./

RUN npm run build

WORKDIR /app

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web-app/dist ./web-app/dist
COPY env.example ./

RUN mkdir -p /app/data

VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV DB_PATH=/app/data/alyabot.db

EXPOSE 3000

CMD ["node", "dist/index.js"]

