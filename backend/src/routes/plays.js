import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getGame } from "../gamesLibrary.js";

const router = Router();
router.use(requireAuth);

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const listStmt = db.prepare(
  "SELECT game_slug, play_count, last_played_at FROM user_play_history WHERE user_id = ?"
);
// upsert: primeira vez cria a linha com play_count=1, dai em diante so
// incrementa e atualiza o timestamp da MESMA linha (ver comentario na
// tabela, db.js) — uma linha por jogo, nao uma por sessao.
const upsertStmt = db.prepare(`
  INSERT INTO user_play_history (user_id, game_slug, play_count, last_played_at)
  VALUES (?, ?, 1, datetime('now'))
  ON CONFLICT (user_id, game_slug)
  DO UPDATE SET play_count = play_count + 1, last_played_at = datetime('now')
`);

router.get("/", (req, res) => {
  const rows = listStmt.all(req.user.id);
  res.json({
    plays: rows.map((r) => ({
      slug: r.game_slug,
      playCount: r.play_count,
      lastPlayedAt: r.last_played_at,
    })),
  });
});

router.post("/:slug", (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug) || !getGame(slug)) return res.status(404).json({ error: "not_found" });
  upsertStmt.run(req.user.id, slug);
  res.json({ ok: true });
});

export default router;
