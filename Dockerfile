# syntax=docker/dockerfile:1

ARG RUFFLE_VERSION=0.6.0

FROM debian:bookworm-slim AS ruffle
ARG RUFFLE_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /ruffle
RUN curl -fsSL -o ruffle.zip \
      "https://github.com/ruffle-rs/ruffle/releases/download/v${RUFFLE_VERSION}/ruffle-${RUFFLE_VERSION}-web-selfhosted.zip" \
    && unzip -q ruffle.zip -d dist \
    && rm ruffle.zip

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4070
ENV DATA_DIR=/app/data
ENV GAMES_DIR=/app/games
ENV PUBLIC_DIR=/app/public
ENV RUFFLE_DIR=/app/public/vendor/ruffle

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY --from=frontend-build /app/frontend/dist ./public
COPY --from=ruffle /ruffle/dist ./public/vendor/ruffle

RUN mkdir -p /app/data /app/games

EXPOSE 4070

CMD ["node", "src/server.js"]
