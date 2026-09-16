# syntax=docker/dockerfile:1

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
ENV ROMS_DIR=/app/roms
ENV PUBLIC_DIR=/app/public

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /app/data /app/roms/SNES /app/roms/NES /app/roms/GENESIS /app/roms/GBA

EXPOSE 4070

CMD ["node", "src/server.js"]
