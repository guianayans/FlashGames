import { Router } from "express";
import path from "node:path";
import { listGames, getGame, listBiosFiles, ROMS_DIR } from "../gamesLibrary.js";
import { TOP_GAME_SLUGS } from "../topGames.js";

const router = Router();

function toPublicUrl(prefix, absolutePath) {
  if (!absolutePath) return null;
  const rel = path.relative(ROMS_DIR, absolutePath).split(path.sep).join("/");
  return `/${prefix}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function toSummary(g) {
  return {
    slug: g.slug,
    title: g.title,
    description: g.description || "",
    category: g.category || "outros",
    tags: Array.isArray(g.tags) ? g.tags : [],
    system: g.system,
    cover: toPublicUrl("roms", g.cover),
    top: TOP_GAME_SLUGS.has(g.slug),
  };
}

router.get("/", (_req, res) => {
  res.json({ games: listGames().map(toSummary) });
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
  res.json({
    game: {
      ...toSummary(game),
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
