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

  -- Remapeamento de teclas do GameScreen.html (botoes X/Y/A/B/L/R/FN/SEL/
  -- START): agora um UNICO mapeamento global (nao mais por jogo, ja que
  -- botao fisico -> botao de console e sempre o mesmo em qualquer jogo de
  -- qualquer sistema), compartilhado entre TODOS os usuarios.
  CREATE TABLE IF NOT EXISTS control_keymap (
    id INTEGER PRIMARY KEY CHECK (id = 1),
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

  -- Jogos favoritados, por USUARIO (conta) — so guarda o slug, os dados do
  -- jogo em si continuam vindo do scan da pasta de ROMs (gamesLibrary.js).
  CREATE TABLE IF NOT EXISTS user_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_slug TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_slug)
  );

  -- Preferencias de exibicao da biblioteca, por USUARIO (conta) — hoje so
  -- o toggle de capa em tamanho original (sem cortar pra caber num box
  -- fixo), ver routes/preferences.js e Library.tsx.
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    original_covers INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Save states de verdade (snapshot completo da memoria do emulador via
  -- nostalgist.saveState()/loadState() — bem diferente de user_game_saves
  -- ali em cima, que e' um resto da era do Flash/Ruffle e nao e' mais
  -- usado). Por USUARIO + JOGO + SLOT (varios slots por jogo, ver
  -- routes/savestates.js pro numero maximo). "state" e' o blob binario
  -- que o core gera; "thumbnail" e' o preview (PNG) que o proprio
  -- Nostalgist devolve junto, pra mostrar na lista de slots sem precisar
  -- carregar o state inteiro so pra ver a miniatura.
  CREATE TABLE IF NOT EXISTS user_save_states (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_slug TEXT NOT NULL,
    slot INTEGER NOT NULL,
    state BLOB NOT NULL,
    thumbnail BLOB,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_slug, slot)
  );

  -- Historico de jogadas, por USUARIO (conta) — pra alimentar o filtro
  -- "Recentes" da Library (ver routes/plays.js): "Mais recentes" ordena
  -- por last_played_at, "Mais jogados" por play_count. Uma linha por
  -- jogo (nao uma por sessao) — cada abertura so incrementa o contador e
  -- atualiza o timestamp da MESMA linha, ver upsertStmt em plays.js.
  CREATE TABLE IF NOT EXISTS user_play_history (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_slug TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 1,
    last_played_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_slug)
  );
`);

// Colunas do painel admin (/admin) em users, adicionadas depois: blocked_at (epoch,
// NULL = ativa) barra o login, e session_version invalida os JWT ja emitidos — o
// token carrega a versao (sv) e auth.js recusa quando ela nao bate mais (bloquear,
// trocar senha ou "encerrar sessoes" sobem o numero).
const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
if (!userColumns.has("blocked_at")) db.exec("ALTER TABLE users ADD COLUMN blocked_at INTEGER");
if (!userColumns.has("session_version")) {
  db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
}

// Views so de leitura pras abas do painel: datas em epoch (o painel formata epoch;
// o "2026-09-18 12:00:00" do datetime('now') e' UTC sem fuso e sairia com hora
// errada) e os totais de cada conta. Recriadas a cada boot, pra mudanca aqui valer
// no proximo deploy. Edicao/acoes do painel escrevem nas tabelas reais.
db.exec(`
  DROP VIEW IF EXISTS admin_users;
  CREATE VIEW admin_users AS
  SELECT
    u.id,
    u.username,
    CAST(strftime('%s', u.created_at) AS INTEGER) AS created_at,
    u.blocked_at,
    CASE WHEN u.blocked_at IS NULL THEN 'active' ELSE 'blocked' END AS status,
    (SELECT COUNT(*) FROM user_play_history p WHERE p.user_id = u.id) AS games_played,
    (SELECT COALESCE(SUM(play_count), 0) FROM user_play_history p WHERE p.user_id = u.id) AS plays,
    (SELECT CAST(strftime('%s', MAX(last_played_at)) AS INTEGER) FROM user_play_history p WHERE p.user_id = u.id) AS last_played_at,
    (SELECT COUNT(*) FROM user_favorites f WHERE f.user_id = u.id) AS favorites,
    (SELECT COUNT(*) FROM user_save_states s WHERE s.user_id = u.id) AS save_states,
    (SELECT COALESCE(SUM(length(state)), 0) FROM user_save_states s WHERE s.user_id = u.id) AS save_bytes
  FROM users u;

  DROP VIEW IF EXISTS admin_games;
  CREATE VIEW admin_games AS
  SELECT
    game_slug,
    COUNT(*) AS players,
    SUM(play_count) AS plays,
    CAST(strftime('%s', MAX(last_played_at)) AS INTEGER) AS last_played_at,
    (SELECT COUNT(*) FROM user_favorites f WHERE f.game_slug = p.game_slug) AS favorites
  FROM user_play_history p
  GROUP BY game_slug;
`);

export default db;
