import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error("SESSION_SECRET must be set to a string with at least 16 characters");
}

export const COOKIE_NAME = "fg_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export function signSession(user) {
  return jwt.sign({ sub: user.id, username: user.username }, SECRET, {
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

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_session" });
  }
}

export function readAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      req.user = { id: payload.sub, username: payload.username };
    } catch {
      // ignore invalid/expired token
    }
  }
  next();
}
