import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";

import authRoutes from "./routes/auth.js";
import gamesRoutes from "./routes/games.js";
import savesRoutes from "./routes/saves.js";
import controlsRoutes from "./routes/controls.js";
import { GAMES_DIR } from "./gamesLibrary.js";
import { readAuth } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 4070;
const PUBLIC_DIR = process.env.PUBLIC_DIR || "/app/public";
const RUFFLE_DIR = process.env.RUFFLE_DIR || "/app/public/vendor/ruffle";

app.disable("x-powered-by");
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(readAuth);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/saves", savesRoutes);
app.use("/api/controls", controlsRoutes);

// Arquivos do Ruffle (ruffle.js + wasm), com o mime type correto para .wasm
app.use(
  "/vendor/ruffle",
  express.static(RUFFLE_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".wasm")) {
        res.setHeader("Content-Type", "application/wasm");
      }
    },
  })
);

// Os .swf (e qualquer asset) de cada jogo, servidos diretamente da pasta games
app.use("/games", express.static(GAMES_DIR, { fallthrough: true }));

// Frontend buildado (SPA)
app.use(express.static(PUBLIC_DIR));
app.get(/^(?!\/api|\/games|\/vendor).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`flashgames backend listening on :${PORT}`);
});
