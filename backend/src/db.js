import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "flashgames.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_save_keys (
    game_slug TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    PRIMARY KEY (game_slug, storage_key)
  );

  CREATE TABLE IF NOT EXISTS user_game_saves (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_slug TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_slug)
  );

  -- Remapeamento de teclas do GameScreen.html (botoes X/Y/A/B/FN/SEL/START):
  -- um por JOGO, compartilhado entre TODOS os usuarios (nao por conta) —
  -- pra quem configurar uma vez, todo mundo reaproveita o mesmo mapeamento
  -- pra aquele jogo dali em diante.
  CREATE TABLE IF NOT EXISTS game_keymaps (
    game_slug TEXT PRIMARY KEY,
    keymap TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Layout de posicao dos controles em tela cheia (paisagem) — um por
  -- USUARIO (conta), global (nao por jogo): o jogador arrasta os botoes
  -- pra onde quiser uma vez e essa posicao vale pra qualquer jogo dali em
  -- diante, em qualquer aparelho que ele entrar.
  CREATE TABLE IF NOT EXISTS user_control_layouts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export default db;
