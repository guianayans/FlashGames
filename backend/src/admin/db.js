// Banco do painel: o mesmo SQLite da api. O resto do painel só usa all/get/run com "?" e LIKE_CI.

// O FlashGames já abre o flashgames.db com better-sqlite3 (../db.js): o painel usa a mesma conexão
// (um arquivo, uma conexão). A API do better-sqlite3 é a mesma do DatabaseSync para all/get/run.
import appDb from "../db.js";

export const sqlite = appDb;

export const all = async (sql, params = []) => sqlite.prepare(sql).all(...params);
export const get = async (sql, params = []) => sqlite.prepare(sql).get(...params) ?? null;
export const run = async (sql, params = []) => sqlite.prepare(sql).run(...params);
// busca sem diferenciar maiúsculas (no Postgres: ILIKE)
export const LIKE_CI = "LIKE";

export const now = () => Math.floor(Date.now() / 1000);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS admin_codes (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_audit (
    id     INTEGER PRIMARY KEY,
    at     INTEGER NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    ip     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit (target);
`);
