import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import http from "node:http";

import authRoutes from "./routes/auth.js";
import gamesRoutes from "./routes/games.js";
import savesRoutes from "./routes/saves.js";
import savestatesRoutes from "./routes/savestates.js";
import controlsRoutes from "./routes/controls.js";
import favoritesRoutes from "./routes/favorites.js";
import playsRoutes from "./routes/plays.js";
import preferencesRoutes from "./routes/preferences.js";
import { ROMS_DIR } from "./gamesLibrary.js";
import { readAuth } from "./auth.js";
import { remoteRouter, attachRemoteWebSocket } from "./remoteRelay.js";

const app = express();
const PORT = process.env.PORT || 4070;
const PUBLIC_DIR = process.env.PUBLIC_DIR || "/app/public";

app.disable("x-powered-by");
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(readAuth);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Save states montado ANTES do express.json() global de baixo: ele tem
// o proprio parser com limite bem maior (state de PS1 passa de alguns MB
// facil), e um body-parser so consegue ler o corpo da requisicao uma vez
// — se o global (2mb) rodasse primeiro, o limite maior do router nunca
// seria alcancado.
app.use("/api/savestates", savestatesRoutes);

app.use(express.json({ limit: "2mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/saves", savesRoutes);
app.use("/api/controls", controlsRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/plays", playsRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/remote", remoteRouter);

// As ROMs (e capas) de cada sistema, servidas diretamente das pastas
// SNES/NES/GENESIS/GBA
app.use("/roms", express.static(ROMS_DIR, { fallthrough: true }));

// Frontend buildado (SPA)
app.use(express.static(PUBLIC_DIR));

// Celular pareado por QR code (ver remoteRelay.js) — tela standalone
// separada do SPA React, mesmo criterio do /GameScreen.html (HTML/JS
// puro, sem depender de rota do React Router). O token em si (parte
// depois de /remote/) e' lido no proprio HTML via location.pathname, nao
// precisa de nada aqui alem de sempre servir o mesmo arquivo.
app.get("/remote/*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "RemoteController.html"));
});

app.get(/^(?!\/api|\/roms).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = http.createServer(app);
attachRemoteWebSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`flashgames backend listening on :${PORT}`);
});
