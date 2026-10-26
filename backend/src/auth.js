import jwt from "jsonwebtoken";
import db from "./db.js";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error("SESSION_SECRET must be set to a string with at least 16 characters");
}

export const COOKIE_NAME = "fg_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function signSession(user) {
  return jwt.sign({ sub: user.id, username: user.username, sv: user.session_version ?? 0 }, SECRET, {
    expiresIn: "30d",
  });
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

const sessionStateStmt = db.prepare("SELECT username, blocked_at, session_version FROM users WHERE id = ?");

// JWT valido nao basta: a conta precisa existir, nao estar bloqueada e a versao
// de sessao (sv) precisa bater com a do banco — o painel admin sobe esse numero
// pra derrubar na hora quem ja estava logado. Token antigo, sem sv, conta como 0.
function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return null;
  }
  const row = sessionStateStmt.get(payload.sub);
  if (!row || row.blocked_at !== null || row.session_version !== (payload.sv ?? 0)) return null;
  return { id: payload.sub, username: row.username };
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  const user = userFromToken(token);
  if (!user) {
    return res.status(401).json({ error: "invalid_session" });
  }
  req.user = user;
  next();
}

export function readAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const user = userFromToken(token);
    if (user) req.user = user;
  }
  next();
}
