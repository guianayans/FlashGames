import { Router } from "express";
import path from "node:path";
import db from "../db.js";
import { listGames, getGame, listBiosFiles, ROMS_DIR } from "../gamesLibrary.js";
import { TOP_GAME_SLUGS } from "../topGames.js";

const router = Router();

const favoriteSlugsStmt = db.prepare("SELECT game_slug FROM user_favorites WHERE user_id = ?");

function toPublicUrl(prefix, absolutePath) {
  if (!absolutePath) return null;
  const rel = path.relative(ROMS_DIR, absolutePath).split(path.sep).join("/");
  return `/${prefix}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

// "top" e' a lista curada (TOP_GAME_SLUGS) UNIDA com os favoritos do
// proprio usuario logado — favoritar um jogo automaticamente o torna
// "top" pra ESSE usuario tambem (dinamico, por pessoa: o que e' top pra
// um nao muda o que e' top pro outro). Sem sessao (readAuth nao achou
// cookie valido), so a lista curada conta.
function toSummary(g, userTopSlugs) {
  return {
    slug: g.slug,
    title: g.title,
    description: g.description || "",
    category: g.category || "outros",
    tags: Array.isArray(g.tags) ? g.tags : [],
    system: g.system,
    cover: toPublicUrl("roms", g.cover),
    top: userTopSlugs.has(g.slug),
  };
}

router.get("/", (req, res) => {
  const userTopSlugs = req.user
    ? new Set([...TOP_GAME_SLUGS, ...favoriteSlugsStmt.all(req.user.id).map((r) => r.game_slug)])
    : TOP_GAME_SLUGS;
  res.json({ games: listGames().map((g) => toSummary(g, userTopSlugs)) });
});

// Lista os arquivos de BIOS disponiveis (ver listBiosFiles) como URLs
// prontas pra passar direto pro Nostalgist — precisa vir ANTES de
// "/:slug" na ordem das rotas, senao o Express le "system" como slug.
router.get("/system/bios", (_req, res) => {
  res.json({ files: listBiosFiles().map((name) => `/roms/BIOS/${encodeURIComponent(name)}`) });
});

router.get("/:slug", (req, res) => {
  const game = getGame(req.params.slug);
  if (!game) return res.status(404).json({ error: "not_found" });
  const userTopSlugs = req.user
    ? new Set([...TOP_GAME_SLUGS, ...favoriteSlugsStmt.all(req.user.id).map((r) => r.game_slug)])
    : TOP_GAME_SLUGS;
  res.json({
    game: {
      ...toSummary(game, userTopSlugs),
      launcher: game.launcher,
      rom: toPublicUrl("roms", game.rom),
      // So PS1 tem isso preenchido: faixas/arquivos que o .cue (ou .m3u/
      // .ccd) do jogo referencia e que tambem precisam ir pro emulador
      // junto com o "rom" principal (ver getPs1RomExtras).
      romExtras: (game.romExtras || []).map((p) => toPublicUrl("roms", p)),
    },
  });
});

export default router;
