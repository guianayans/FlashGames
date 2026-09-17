import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();

const getStmt = db.prepare("SELECT original_covers FROM user_preferences WHERE user_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO user_preferences (user_id, original_covers, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET original_covers = excluded.original_covers, updated_at = excluded.updated_at
`);

router.get("/", requireAuth, (req, res) => {
  const row = getStmt.get(req.user.id);
  res.json({ originalCovers: row ? !!row.original_covers : false });
});

router.put("/", requireAuth, (req, res) => {
  const { originalCovers } = req.body || {};
  if (typeof originalCovers !== "boolean") {
    return res.status(400).json({ error: "invalid_original_covers" });
  }
  upsertStmt.run(req.user.id, originalCovers ? 1 : 0);
  res.json({ ok: true });
});

export default router;
