import { Router } from "express";
import { listGames, getGame } from "../gamesLibrary.js";

const router = Router();

router.get("/", (_req, res) => {
  const games = listGames().map((g) => ({
    slug: g.slug,
    title: g.title,
    description: g.description || "",
    category: g.category || "outros",
    tags: Array.isArray(g.tags) ? g.tags : [],
    cover: g.cover ? `/games/${g.slug}/${g.cover}` : null,
    width: g.width,
    height: g.height,
  }));
  res.json({ games });
});

router.get("/:slug", (req, res) => {
  const game = getGame(req.params.slug);
  if (!game) return res.status(404).json({ error: "not_found" });
  res.json({
    game: {
      ...game,
      category: game.category || "outros",
      tags: Array.isArray(game.tags) ? game.tags : [],
      cover: game.cover ? `/games/${game.slug}/${game.cover}` : null,
    },
  });
});

export default router;
