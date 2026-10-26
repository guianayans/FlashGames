// Painel admin (modelo Notchly): login por código no e-mail, sessão em cookie e auditoria.
// O FlashGames é só web e não recebe webhooks: as abas Webhooks e Releases do modelo foram tiradas.
// Ligação na api:  if (await adminRoute(req, res, url)) return;   (antes das rotas do app)

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { adminConfig as config } from "./config.js";
import { all, get, now, run } from "./db.js";
import { HttpError, clientIp, fail, parseCookies, rateLimit, readJson, send, sendError } from "./http.js";
import { sendAdminCode } from "./mail.js";
import { panel } from "./panel.js";
import { makeResources } from "./resources.js";

const COOKIE = "flashgames_admin";
const CSRF_HEADER = "x-flashgames-admin";
const CODE_TTL = 10 * 60;
const CODE_MAX_ATTEMPTS = 5;
const allowedOrigin = new URL(config.publicUrl).origin;

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Registra uma ação no histórico do painel (use também nas rotas do app que mexem em dados de cliente). */
export async function audit(req, actor, action, targetRef = null, detail = null) {
  await run("INSERT INTO admin_audit (at, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)", [
    now(),
    actor,
    action,
    targetRef === null ? null : String(targetRef),
    detail ? JSON.stringify(detail) : null,
    req ? clientIp(req) : null,
  ]);
}

const resources = makeResources(panel, audit);

setInterval(() => {
  run("DELETE FROM admin_sessions WHERE expires_at <= ?", [now()]).catch(() => {});
  run("DELETE FROM admin_codes WHERE expires_at <= ?", [now()]).catch(() => {});
}, 10 * 60_000).unref();

if (!config.adminEmails.length) console.warn("ADMIN_EMAILS vazio: ninguém consegue entrar no painel /admin");

// ---------- Autenticação ----------

function sessionCookie(value, maxAge) {
  return [`${COOKIE}=${value}`, "Path=/api/admin", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`, config.cookieSecure ? "Secure" : null]
    .filter(Boolean)
    .join("; ");
}

async function authenticate(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const session = await get("SELECT email FROM admin_sessions WHERE token_hash = ? AND expires_at > ?", [sha256(token), now()]);
    if (session && config.adminEmails.includes(session.email)) {
      // CSRF: além do SameSite=Strict, toda escrita exige um cabeçalho próprio (força preflight, que não liberamos)
      if (req.method !== "GET") {
        if (req.headers[CSRF_HEADER] !== "1") fail(403, "csrf", "Requisição recusada.");
        const origin = req.headers.origin;
        if (origin && origin !== allowedOrigin) fail(403, "origem_invalida", "Origem não permitida.");
      }
      return session.email;
    }
  }
  fail(401, "nao_autorizado", "Faça login para continuar.");
}

// O e-mail nunca trafega: a tela pede só o código, e o servidor manda para ADMIN_EMAILS.
async function login(req, res) {
  rateLimit(req, "admin-login", 5, 900);
  // qualquer um pode pedir: o limite global segura força bruta distribuída por vários IPs
  rateLimit(req, "admin-login-global", 3, 600, "todos");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const t = now();
  for (const email of config.adminEmails) {
    await run(
      `INSERT INTO admin_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
      [email, sha256(`${email}:${code}`), t + CODE_TTL, t],
    );
    await audit(req, email, "codigo_enviado");
    sendAdminCode(email, code, clientIp(req)).catch((err) => console.error("admin.mail_falhou", String(err)));
  }
  send(res, 200, { ok: true });
}

async function verify(req, res) {
  rateLimit(req, "admin-verify", 10, 900);
  const code = String((await readJson(req)).code ?? "").replace(/\D/g, "");
  const invalid = () => fail(401, "codigo_invalido", "Código inválido ou expirado.");
  if (code.length !== 6) invalid();

  const marks = config.adminEmails.map(() => "?").join(", ") || "NULL";
  const pending = await all(`SELECT * FROM admin_codes WHERE email IN (${marks}) AND expires_at > ? AND attempts < ?`, [
    ...config.adminEmails,
    now(),
    CODE_MAX_ATTEMPTS,
  ]);
  const match = pending.find((row) => safeEqual(row.code_hash, sha256(`${row.email}:${code}`)));
  if (!match) {
    // a tentativa errada conta para todos os códigos em aberto
    for (const row of pending) {
      await run("UPDATE admin_codes SET attempts = attempts + 1 WHERE email = ?", [row.email]);
      await audit(req, row.email, "codigo_errado");
    }
    invalid();
  }

  await run(`DELETE FROM admin_codes WHERE email IN (${marks})`, config.adminEmails);
  const token = randomBytes(32).toString("base64url");
  const maxAge = config.sessionHours * 3600;
  await run("INSERT INTO admin_sessions (token_hash, email, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", [
    sha256(token),
    match.email,
    clientIp(req),
    String(req.headers["user-agent"] ?? "").slice(0, 200),
    now(),
    now() + maxAge,
  ]);
  await audit(req, match.email, "login");
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token, maxAge) });
}

async function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await run("DELETE FROM admin_sessions WHERE token_hash = ?", [sha256(token)]);
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
}

// ---------- Roteamento de /api/admin/* ----------

async function handleAdmin(req, res, url) {
  const path = url.pathname.slice("/api/admin".length) || "/";
  const route = `${req.method} ${path}`;

  // públicas (o login em si)
  if (route === "POST /auth/login") return login(req, res);
  if (route === "POST /auth/verify") return verify(req, res);
  if (route === "POST /auth/logout") return logout(req, res);

  const actor = await authenticate(req);

  if (route === "GET /me") return send(res, 200, { ok: true, email: actor });
  if (route === "GET /schema") {
    return send(res, 200, {
      app: config.appName,
      links: panel.links ?? [],
      resources: resources.schema(),
      actions: { ...resources.actionLabels(), ...(panel.auditLabels ?? {}) },
    });
  }
  if (route === "GET /stats") return send(res, 200, { tiles: panel.stats ? await panel.stats({ all, get, now }) : [] });
  if (route === "GET /audit") return send(res, 200, { entries: await all("SELECT * FROM admin_audit ORDER BY id DESC LIMIT 200") });

  // abas de dados (panel.js): /r/<aba>, /r/<aba>/<id>, /r/<aba>/<id>/<ação>
  let m = path.match(/^\/r\/([a-z0-9_]+)$/);
  if (m) {
    if (req.method === "GET") return send(res, 200, await resources.list(m[1], url));
    if (req.method === "POST") return send(res, 201, await resources.create(req, actor, m[1], await readJson(req)));
  }
  m = path.match(/^\/r\/([a-z0-9_]+)\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[2]);
    if (req.method === "GET") return send(res, 200, await resources.detail(m[1], id));
    if (req.method === "PATCH") return send(res, 200, await resources.update(req, actor, m[1], id, await readJson(req)));
    if (req.method === "DELETE") return send(res, 200, await resources.remove(req, actor, m[1], id));
  }
  m = path.match(/^\/r\/([a-z0-9_]+)\/([^/]+)\/([a-z0-9_]+)$/);
  if (m && req.method === "POST") {
    return send(res, 200, await resources.action(req, actor, m[1], decodeURIComponent(m[2]), m[3], await readJson(req)));
  }

  throw new HttpError(404, "nao_encontrado", "Rota não encontrada.");
}

/** Trata /api/admin/*. Devolve true quando respondeu. */
export async function adminRoute(req, res, url) {
  try {
    if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) {
      await handleAdmin(req, res, url);
      return true;
    }
    return false;
  } catch (err) {
    sendError(res, err);
    return true;
  }
}
