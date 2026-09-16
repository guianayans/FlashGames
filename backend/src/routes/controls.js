import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getGame } from "../gamesLibrary.js";

const router = Router();

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const MAX_KEYMAP_ENTRIES = 16;
const MAX_KEYMAP_KEY_LEN = 40;
const MAX_LAYOUT_JSON_LEN = 20_000;

const getKeymapStmt = db.prepare("SELECT keymap FROM game_keymaps WHERE game_slug = ?");
const upsertKeymapStmt = db.prepare(`
  INSERT INTO game_keymaps (game_slug, keymap, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(game_slug) DO UPDATE SET keymap = excluded.keymap, updated_at = excluded.updated_at
`);
const getLayoutStmt = db.prepare("SELECT layout FROM user_control_layouts WHERE user_id = ?");
const upsertLayoutStmt = db.prepare(`
  INSERT INTO user_control_layouts (user_id, layout, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at
`);

function validSlug(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug) || !getGame(slug)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return slug;
}

// Remapeamento de teclas por jogo — leitura publica (nenhum jogo/tela
// precisa de login pra saber que teclas usar), escrita exige login (mas
// nao um usuario "dono": qualquer conta pode configurar, valendo pra
// todo mundo — ver comentario no schema em db.js).
router.get("/keymap/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const row = getKeymapStmt.get(slug);
  res.json({ keymap: row ? JSON.parse(row.keymap) : null });
});

router.put("/keymap/:slug", requireAuth, (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;

  const keymap = req.body?.keymap;
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return res.status(400).json({ error: "invalid_keymap" });
  }
  const entries = Object.entries(keymap);
  if (entries.length > MAX_KEYMAP_ENTRIES) {
    return res.status(413).json({ error: "too_many_keys" });
  }
  for (const [btnId, key] of entries) {
    if (typeof btnId !== "string" || btnId.length > MAX_KEYMAP_KEY_LEN) {
      return res.status(400).json({ error: "invalid_button" });
    }
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEYMAP_KEY_LEN) {
      return res.status(400).json({ error: "invalid_key" });
    }
  }

  upsertKeymapStmt.run(slug, JSON.stringify(keymap));
  res.json({ ok: true });
});

// Layout dos controles em tela cheia (paisagem) — por conta de usuario,
// nao por jogo (ver comentario no schema em db.js).
router.get("/layout", requireAuth, (req, res) => {
  const row = getLayoutStmt.get(req.user.id);
  res.json({ layout: row ? JSON.parse(row.layout) : null });
});

router.put("/layout", requireAuth, (req, res) => {
  const layout = req.body?.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return res.status(400).json({ error: "invalid_layout" });
  }
  const json = JSON.stringify(layout);
  if (json.length > MAX_LAYOUT_JSON_LEN) {
    return res.status(413).json({ error: "layout_too_large" });
  }
  for (const [id, pos] of Object.entries(layout)) {
    if (typeof id !== "string" || id.length > MAX_KEYMAP_KEY_LEN) {
      return res.status(400).json({ error: "invalid_control_id" });
    }
    if (!pos || typeof pos !== "object" || typeof pos.x !== "number" || typeof pos.y !== "number") {
      return res.status(400).json({ error: "invalid_position" });
    }
  }

  upsertLayoutStmt.run(req.user.id, json);
  res.json({ ok: true });
});

export default router;
