// Configuração do painel, lida do ambiente. Nada aqui vai para o navegador.

const env = (k, d = "") => (process.env[k] ?? d).trim();
const list = (k, d = "") =>
  env(k, d)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const adminConfig = {
  appName: env("APP_NAME", "FlashGames"),
  publicUrl: env("PUBLIC_URL", "http://localhost:8080").replace(/\/$/, ""),
  // quem recebe o código de login do painel
  adminEmails: list("ADMIN_EMAILS"),
  sessionHours: Number(env("ADMIN_SESSION_HOURS", "12")) || 12,
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT", "587")),
    secure: env("SMTP_SECURE") === "true",
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("SMTP_FROM"),
    fromName: env("SMTP_FROM_NAME", "FlashGames"),
  },
};
