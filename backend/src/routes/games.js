import { Router } from "express";
import path from "node:path";
import { listGames, getGame, ROMS_DIR } from "../gamesLibrary.js";

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
  };
}

router.get("/", (_req, res) => {
  res.json({ games: listGames().map(toSummary) });
});

router.get("/:slug", (req, res) => {
  const game = getGame(req.params.slug);
  if (!game) return res.status(404).json({ error: "not_found" });
  res.json({
    game: {
      ...toSummary(game),
      launcher: game.launcher,
      rom: toPublicUrl("roms", game.rom),
    },
  });
});

export default router;
