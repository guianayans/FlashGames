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
// nao por jogo (ver comentario no schema em db.js). Formato:
// { positions: { <id>: {x,y,w,h} }, hidden: { <id>: true }, fcGap: number }
// — positions e' centro (x,y) + tamanho (w,h) em fracao da viewport
// (mesmo criterio de sempre); hidden marca quais controles o usuario
// escondeu (visibilidade fica escondida na conta, nao so' no aparelho);
// fcGap e' o espalhamento do cluster ABXY (0-100, ver applyFcLayout no
// GameScreen.html). Formato ANTIGO (antes de existir hidden/fcGap) era
// so' o mapa de posicoes direto — nao migrado, um layout salvo antes
// desta mudanca simplesmente reresseta pro padrao (app pessoal, poucas
// contas, nao vale a complexidade de migrar um formato tao antigo).
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

  const { positions, hidden, fcGap } = layout;
  if (positions !== undefined) {
    if (typeof positions !== "object" || Array.isArray(positions)) {
      return res.status(400).json({ error: "invalid_positions" });
    }
    for (const [id, pos] of Object.entries(positions)) {
      if (typeof id !== "string" || id.length > MAX_KEYMAP_KEY_LEN) {
        return res.status(400).json({ error: "invalid_control_id" });
      }
      if (!pos || typeof pos !== "object" || typeof pos.x !== "number" || typeof pos.y !== "number") {
        return res.status(400).json({ error: "invalid_position" });
      }
      if (pos.w !== undefined && typeof pos.w !== "number") {
        return res.status(400).json({ error: "invalid_position" });
      }
      if (pos.h !== undefined && typeof pos.h !== "number") {
        return res.status(400).json({ error: "invalid_position" });
      }
    }
  }
  if (hidden !== undefined) {
    if (typeof hidden !== "object" || Array.isArray(hidden)) {
      return res.status(400).json({ error: "invalid_hidden" });
    }
    for (const [id, val] of Object.entries(hidden)) {
      if (typeof id !== "string" || id.length > MAX_KEYMAP_KEY_LEN || typeof val !== "boolean") {
        return res.status(400).json({ error: "invalid_hidden" });
      }
    }
  }
  if (fcGap !== undefined && typeof fcGap !== "number") {
    return res.status(400).json({ error: "invalid_fc_gap" });
  }

  upsertLayoutStmt.run(req.user.id, json);
  res.json({ ok: true });
});

export default router;
