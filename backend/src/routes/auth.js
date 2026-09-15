import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../db.js";
import { signSession, setSessionCookie, clearSessionCookie, requireAuth } from "../auth.js";

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

const findUserByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password_hash) VALUES (?, ?)"
);

// Login se o usuario ja existe (senha precisa bater), ou cria a conta na hora
// se for a primeira vez que esse nome de usuario aparece.
router.post("/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: "invalid_username",
      message: "Usuario deve ter 3-20 caracteres: letras, numeros, - ou _.",
    });
  }
  if (password.length < 4 || password.length > 72) {
    return res.status(400).json({
      error: "invalid_password",
      message: "Senha deve ter entre 4 e 72 caracteres.",
    });
  }

  const existing = findUserByUsername.get(username);

  if (existing) {
    const ok = bcrypt.compareSync(password, existing.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "wrong_password", message: "Senha incorreta." });
    }
    const token = signSession(existing);
    setSessionCookie(res, token);
    return res.json({ user: { id: existing.id, username: existing.username } });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = insertUser.run(username, passwordHash);
  const user = { id: info.lastInsertRowid, username };
  const token = signSession(user);
  setSessionCookie(res, token);
  return res.status(201).json({ user, created: true });
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
