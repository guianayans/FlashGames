import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getGame } from "../gamesLibrary.js";

const router = Router();
router.use(requireAuth);

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const listStmt = db.prepare("SELECT game_slug FROM user_favorites WHERE user_id = ?");
const addStmt = db.prepare(
  "INSERT OR IGNORE INTO user_favorites (user_id, game_slug) VALUES (?, ?)"
);
const removeStmt = db.prepare("DELETE FROM user_favorites WHERE user_id = ? AND game_slug = ?");

function validSlug(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug) || !getGame(slug)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return slug;
}

router.get("/", (req, res) => {
  const slugs = listStmt.all(req.user.id).map((r) => r.game_slug);
  res.json({ slugs });
});

router.put("/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  addStmt.run(req.user.id, slug);
  res.json({ ok: true });
});

router.delete("/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  removeStmt.run(req.user.id, slug);
  res.json({ ok: true });
});

export default router;
