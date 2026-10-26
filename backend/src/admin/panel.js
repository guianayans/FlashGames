// O que é do FlashGames no painel: os números da Visão geral e as abas Contas e Jogos.
// Tudo é código: tabelas, colunas e trechos SQL daqui nunca vêm da requisição.
//
// As abas leem as views admin_users e admin_games (criadas em ../db.js, com datas em epoch e
// os totais de cada conta). Edição, ações e exclusão escrevem sempre na tabela users de verdade.
//
// Tipos de coluna: text, email, number, money, date, datetime, bool, badge ({ map: { valor: ["Rótulo", "ok|warn|bad|admin"] } })
// Tipos de campo:  text, email, number, select ({ options: [[valor, "Rótulo"]] }), bool, date, textarea

import bcrypt from "bcryptjs";

import { getGame } from "../gamesLibrary.js";
import { HttpError } from "./http.js";

const DAY = 86400;

// o painel mostra a mensagem do HttpError no aviso
const httpError = (message) => new HttpError(400, "invalido", message);

// mesmas regras do login do app (routes/auth.js)
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const checkUsername = (u) => {
  if (!USERNAME_RE.test(u)) throw httpError("Usuário deve ter 3-20 caracteres: letras, números, - ou _.");
};
const checkPassword = (p) => {
  if (typeof p !== "string" || p.length < 4 || p.length > 72) throw httpError("Senha deve ter entre 4 e 72 caracteres.");
};
const gameTitle = (slug) => getGame(slug)?.title ?? slug;
const fmtWhen = (sqlDate) => (sqlDate ? new Date(`${sqlDate.replace(" ", "T")}Z`).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const fmtSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

// derruba todos os logins já feitos da conta (o JWT carrega session_version, ver ../auth.js)
const bumpSessions = (run, id) => run("UPDATE users SET session_version = session_version + 1 WHERE id = ?", [id]);

export const panel = {
  links: [{ label: "Abrir FlashGames ↗", href: "/" }],

  async stats({ get }) {
    const n = async (sql, params = []) => Number((await get(sql, params))?.n ?? 0);
    const saves = await get("SELECT COUNT(*) AS n, COALESCE(SUM(length(state)), 0) AS bytes FROM user_save_states");
    return [
      { label: "Contas", value: await n("SELECT COUNT(*) AS n FROM users") },
      { label: "Novas (7 dias)", value: await n("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-7 days')") },
      {
        label: "Jogaram (7 dias)",
        value: await n("SELECT COUNT(DISTINCT user_id) AS n FROM user_play_history WHERE last_played_at > datetime('now', '-7 days')"),
        sub: "contas que abriram algum jogo",
      },
      { label: "Jogadas", value: await n("SELECT COALESCE(SUM(play_count), 0) AS n FROM user_play_history"), sub: "total de partidas abertas" },
      { label: "Jogos diferentes", value: await n("SELECT COUNT(DISTINCT game_slug) AS n FROM user_play_history") },
      { label: "Save states", value: Number(saves?.n ?? 0), sub: fmtSize(saves?.bytes) },
      { label: "Favoritos", value: await n("SELECT COUNT(*) AS n FROM user_favorites") },
      { label: "Bloqueadas", value: await n("SELECT COUNT(*) AS n FROM users WHERE blocked_at IS NOT NULL") },
    ];
  },

  auditLabels: {},

  resources: {
    users: {
      label: "Contas",
      singular: "conta",
      feminine: true,
      table: "admin_users",
      key: "id",
      title: "username",
      copy: "id",
      search: ["username"],
      searchLabel: "usuário",
      order: "created_at DESC",
      filters: [
        { value: "active", label: "Ativas", where: "status = 'active'" },
        { value: "blocked", label: "Bloqueadas", where: "status = 'blocked'" },
        { value: "new", label: "Novas (7 dias)", where: (t) => `created_at > ${t - 7 * DAY}` },
        { value: "playing", label: "Jogaram (7 dias)", where: (t) => `last_played_at > ${t - 7 * DAY}` },
        { value: "never", label: "Nunca jogaram", where: "plays = 0" },
      ],
      columns: [
        { field: "username", label: "Usuário" },
        { field: "status", label: "Status", type: "badge", map: { active: ["Ativa", "ok"], blocked: ["Bloqueada", "bad"] } },
        { field: "plays", label: "Jogadas", type: "number", sub: "games_played" },
        { field: "last_played_at", label: "Último jogo", type: "datetime" },
        { field: "save_states", label: "Saves", type: "number" },
        { field: "created_at", label: "Criada", type: "date" },
      ],
      badges: (u) => [
        u.status === "blocked" ? ["Bloqueada", "bad"] : ["Ativa", "ok"],
        [`${u.plays} jogada${u.plays === 1 ? "" : "s"} em ${u.games_played} jogo${u.games_played === 1 ? "" : "s"}`, ""],
        [`${u.favorites} favorito${u.favorites === 1 ? "" : "s"}`, ""],
        [`${u.save_states} save${u.save_states === 1 ? "" : "s"} (${fmtSize(u.save_bytes)})`, ""],
        [`desde ${new Date(u.created_at * 1000).toLocaleDateString("pt-BR")}`, ""],
      ],
      fields: [{ field: "username", label: "Usuário", required: true, maxLength: 20 }],
      // a view não é editável: renomear vai direto em users (o login compara sem diferenciar maiúsculas)
      update: async ({ row, changes, get, run }) => {
        if (changes.username === undefined) return;
        checkUsername(changes.username);
        const taken = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?", [changes.username, row.id]);
        if (taken) throw new HttpError(409, "duplicado", "Já existe uma conta com esse usuário.");
        await run("UPDATE users SET username = ? WHERE id = ?", [changes.username, row.id]);
      },
      create: {
        fields: [
          { field: "username", label: "Usuário", required: true, maxLength: 20 },
          { field: "password", label: "Senha (4-72 caracteres)", required: true, maxLength: 72 },
        ],
        run: async ({ values, get, run }) => {
          checkUsername(values.username);
          checkPassword(values.password);
          const taken = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [values.username]);
          if (taken) throw new HttpError(409, "duplicado", "Já existe uma conta com esse usuário.");
          const info = await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [values.username, bcrypt.hashSync(values.password, 10)]);
          return Number(info.lastInsertRowid);
        },
      },
      actions: [
        {
          name: "reset_password",
          label: "Trocar senha",
          input: "Nova senha (4 a 72 caracteres). A conta sai de todos os aparelhos.",
          audit: "Conta: senha trocada",
          run: async ({ row, body, run }) => {
            const password = String(body.value ?? "");
            checkPassword(password);
            await run("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?", [
              bcrypt.hashSync(password, 10),
              row.id,
            ]);
            return { message: "Senha trocada. Os logins abertos foram encerrados." };
          },
        },
        {
          name: "logout_all",
          label: "Encerrar sessões",
          confirm: "Desconectar esta conta de todos os aparelhos? Ela continua podendo entrar de novo.",
          audit: "Conta: sessões encerradas",
          show: (u) => u.status !== "blocked",
          run: async ({ row, run }) => {
            await bumpSessions(run, row.id);
            return { message: "Sessões encerradas." };
          },
        },
        {
          name: "block",
          label: "Bloquear",
          tone: "danger",
          confirm: "Bloquear esta conta? Ela sai de todos os aparelhos na hora e não consegue mais entrar.",
          audit: "Conta bloqueada",
          show: (u) => u.status !== "blocked",
          run: async ({ row, run, now }) => {
            await run("UPDATE users SET blocked_at = ?, session_version = session_version + 1 WHERE id = ?", [now(), row.id]);
            return { message: "Conta bloqueada." };
          },
        },
        {
          name: "unblock",
          label: "Desbloquear",
          audit: "Conta desbloqueada",
          show: (u) => u.status === "blocked",
          run: async ({ row, run }) => {
            await run("UPDATE users SET blocked_at = NULL WHERE id = ?", [row.id]);
            return { message: "Conta desbloqueada." };
          },
        },
        {
          // usada pelo botão de cada item da lista "Save states" (value = "<jogo>|<slot>")
          name: "delete_savestate",
          label: "Excluir save state",
          hidden: true,
          run: async ({ row, body, run }) => {
            const [slug, slot] = String(body.value ?? "").split("|");
            const info = await run("DELETE FROM user_save_states WHERE user_id = ? AND game_slug = ? AND slot = ?", [row.id, slug, Number(slot)]);
            if (!info.changes) throw new HttpError(404, "nao_encontrado", "Save state não encontrado.");
            return { message: "Save state excluído.", audit: { jogo: slug, slot: Number(slot) } };
          },
        },
      ],
      related: [
        {
          label: "Jogos recentes",
          empty: "Ainda não jogou nada.",
          load: async ({ row, all }) =>
            (
              await all(
                "SELECT game_slug, play_count, last_played_at FROM user_play_history WHERE user_id = ? ORDER BY last_played_at DESC LIMIT 30",
                [row.id],
              )
            ).map((p) => ({
              primary: gameTitle(p.game_slug),
              secondary: `${p.play_count} jogada${p.play_count === 1 ? "" : "s"}`,
              meta: fmtWhen(p.last_played_at),
            })),
        },
        {
          label: "Save states",
          empty: "Nenhum save state.",
          load: async ({ row, all }) =>
            (
              await all(
                "SELECT game_slug, slot, length(state) AS size, updated_at FROM user_save_states WHERE user_id = ? ORDER BY updated_at DESC",
                [row.id],
              )
            ).map((s) => ({
              primary: gameTitle(s.game_slug),
              secondary: `slot ${s.slot} · ${fmtSize(s.size)}`,
              meta: fmtWhen(s.updated_at),
              action: {
                name: "delete_savestate",
                label: "Excluir",
                value: `${s.game_slug}|${s.slot}`,
                confirm: `Excluir o save state do slot ${s.slot} de ${gameTitle(s.game_slug)}? Não dá para desfazer.`,
              },
            })),
        },
        {
          label: "Favoritos",
          empty: "Nenhum favorito.",
          load: async ({ row, all }) =>
            (await all("SELECT game_slug, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC", [row.id])).map((f) => ({
              primary: gameTitle(f.game_slug),
              meta: fmtWhen(f.created_at),
            })),
        },
      ],
      // saves, favoritos, histórico, layout e preferências caem junto (ON DELETE CASCADE)
      remove: {
        confirm: "username",
        run: async ({ row, run }) => {
          await run("DELETE FROM users WHERE id = ?", [row.id]);
        },
      },
    },

    games: {
      label: "Jogos",
      singular: "jogo",
      table: "admin_games",
      key: "game_slug",
      title: "game_slug",
      copy: "game_slug",
      search: ["game_slug"],
      searchLabel: "nome do jogo",
      order: "plays DESC",
      filters: [{ value: "week", label: "Jogados (7 dias)", where: (t) => `last_played_at > ${t - 7 * DAY}` }],
      columns: [
        { field: "game_slug", label: "Jogo" },
        { field: "plays", label: "Jogadas", type: "number" },
        { field: "players", label: "Contas", type: "number" },
        { field: "favorites", label: "Favoritos", type: "number" },
        { field: "last_played_at", label: "Último jogo", type: "datetime" },
      ],
      badges: (g) => [
        [gameTitle(g.game_slug), "admin"],
        [`${g.plays} jogada${g.plays === 1 ? "" : "s"}`, ""],
        [`${g.players} conta${g.players === 1 ? "" : "s"}`, ""],
      ],
      related: [
        {
          label: "Quem mais jogou",
          empty: "Ninguém.",
          load: async ({ row, all }) =>
            (
              await all(
                `SELECT u.username, p.play_count, p.last_played_at FROM user_play_history p JOIN users u ON u.id = p.user_id
                 WHERE p.game_slug = ? ORDER BY p.play_count DESC LIMIT 30`,
                [row.game_slug],
              )
            ).map((p) => ({ primary: p.username, secondary: `${p.play_count} jogada${p.play_count === 1 ? "" : "s"}`, meta: fmtWhen(p.last_played_at) })),
        },
      ],
      create: false,
      remove: false,
    },
  },
};
