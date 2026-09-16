import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();

const MAX_KEYMAP_ENTRIES = 16;
const MAX_KEYMAP_KEY_LEN = 40;
const MAX_LAYOUT_JSON_LEN = 20_000;

const getKeymapStmt = db.prepare("SELECT keymap FROM control_keymap WHERE id = 1");
const upsertKeymapStmt = db.prepare(`
  INSERT INTO control_keymap (id, keymap, updated_at)
  VALUES (1, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET keymap = excluded.keymap, updated_at = excluded.updated_at
`);
const getLayoutStmt = db.prepare("SELECT layout FROM user_control_layouts WHERE user_id = ?");
const upsertLayoutStmt = db.prepare(`
  INSERT INTO user_control_layouts (user_id, layout, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at
`);

// Remapeamento de teclas do controle fisico (botoes X/Y/A/B/L/R/FN/SEL/
// START) — agora um unico mapeamento global (o controle e sempre o mesmo
// gamepad de console, nao muda por jogo). Leitura publica, escrita exige
// login (mas nao um usuario "dono": qualquer conta pode configurar, valendo
// pra todo mundo).
router.get("/keymap", (_req, res) => {
  const row = getKeymapStmt.get();
  res.json({ keymap: row ? JSON.parse(row.keymap) : null });
});

router.put("/keymap", requireAuth, (req, res) => {
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

  upsertKeymapStmt.run(JSON.stringify(keymap));
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
