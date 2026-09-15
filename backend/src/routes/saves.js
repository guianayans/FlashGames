import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getGame } from "../gamesLibrary.js";

const router = Router();
router.use(requireAuth);

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const MAX_KEYS = 200;
const MAX_KEY_LEN = 300;
const MAX_VALUE_LEN = 200_000; // por chave

const getKeysStmt = db.prepare(
  "SELECT storage_key FROM game_save_keys WHERE game_slug = ?"
);
const insertKeyStmt = db.prepare(
  "INSERT OR IGNORE INTO game_save_keys (game_slug, storage_key) VALUES (?, ?)"
);
const getSaveStmt = db.prepare(
  "SELECT data, updated_at FROM user_game_saves WHERE user_id = ? AND game_slug = ?"
);
const upsertSaveStmt = db.prepare(`
  INSERT INTO user_game_saves (user_id, game_slug, data, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, game_slug) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

function validSlug(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug) || !getGame(slug)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return slug;
}

router.get("/:slug/keys", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const keys = getKeysStmt.all(slug).map((r) => r.storage_key);
  res.json({ keys });
});

router.get("/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const row = getSaveStmt.get(req.user.id, slug);
  if (!row) return res.json({ data: null, updatedAt: null });
  res.json({ data: JSON.parse(row.data), updatedAt: row.updated_at });
});

router.put("/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;

  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "invalid_data" });
  }

  const entries = Object.entries(data);
  if (entries.length > MAX_KEYS) {
    return res.status(413).json({ error: "too_many_keys" });
  }
  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length > MAX_KEY_LEN) {
      return res.status(400).json({ error: "invalid_key" });
    }
    if (typeof value !== "string" || value.length > MAX_VALUE_LEN) {
      return res.status(400).json({ error: "invalid_value" });
    }
  }

  const tx = db.transaction(() => {
    upsertSaveStmt.run(req.user.id, slug, JSON.stringify(data));
    for (const key of Object.keys(data)) {
      insertKeyStmt.run(slug, key);
    }
  });
  tx();

  res.json({ ok: true });
});

export default router;
