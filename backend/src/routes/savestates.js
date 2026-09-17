import { Router } from "express";
import express from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getGame } from "../gamesLibrary.js";

const router = Router();
router.use(requireAuth);
// Save state de PS1 pode passar de alguns MB — base64 infla ~33% em
// cima disso, entao o limite aqui e' bem maior que o global (2mb em
// server.js), mas so pra ESSE router, nao pro resto da API.
router.use(express.json({ limit: "40mb" }));

export const MAX_SLOTS = 4;

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

const listStmt = db.prepare(
  "SELECT slot, thumbnail, updated_at FROM user_save_states WHERE user_id = ? AND game_slug = ? ORDER BY slot"
);
const getStateStmt = db.prepare(
  "SELECT state FROM user_save_states WHERE user_id = ? AND game_slug = ? AND slot = ?"
);
const upsertStmt = db.prepare(`
  INSERT INTO user_save_states (user_id, game_slug, slot, state, thumbnail, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, game_slug, slot) DO UPDATE SET
    state = excluded.state, thumbnail = excluded.thumbnail, updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare(
  "DELETE FROM user_save_states WHERE user_id = ? AND game_slug = ? AND slot = ?"
);

function validSlug(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug) || !getGame(slug)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return slug;
}

function validSlot(req, res) {
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    res.status(400).json({ error: "invalid_slot" });
    return null;
  }
  return slot;
}

// Lista os slots que TEM save (nao inclui os vazios — o front sabe o
// MAX_SLOTS e preenche o resto como "vazio" sozinho). O thumbnail vai
// como data URI direto no JSON (e' pequeno, poupa uma rota a parte por
// miniatura); o state (podendo ser varios MB) fica de fora daqui —
// so' baixa quando o usuario realmente pede pra carregar aquele slot.
router.get("/:slug", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const rows = listStmt.all(req.user.id, slug);
  res.json({
    slots: rows.map((r) => ({
      slot: r.slot,
      updatedAt: r.updated_at,
      thumbnail: r.thumbnail ? `data:image/png;base64,${r.thumbnail.toString("base64")}` : null,
    })),
  });
});

router.put("/:slug/:slot", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const slot = validSlot(req, res);
  if (!slot) return;

  const { state, thumbnail } = req.body || {};
  if (typeof state !== "string" || state.length === 0) {
    return res.status(400).json({ error: "invalid_state" });
  }
  let stateBuf;
  let thumbBuf = null;
  try {
    stateBuf = Buffer.from(state, "base64");
    if (typeof thumbnail === "string" && thumbnail.length > 0) {
      thumbBuf = Buffer.from(thumbnail, "base64");
    }
  } catch {
    return res.status(400).json({ error: "invalid_base64" });
  }

  upsertStmt.run(req.user.id, slug, slot, stateBuf, thumbBuf);
  res.json({ ok: true });
});

router.get("/:slug/:slot/state", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const slot = validSlot(req, res);
  if (!slot) return;

  const row = getStateStmt.get(req.user.id, slug, slot);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.set("Content-Type", "application/octet-stream");
  res.send(row.state);
});

router.delete("/:slug/:slot", (req, res) => {
  const slug = validSlug(req, res);
  if (!slug) return;
  const slot = validSlot(req, res);
  if (!slot) return;

  deleteStmt.run(req.user.id, slug, slot);
  res.json({ ok: true });
});

export default router;
