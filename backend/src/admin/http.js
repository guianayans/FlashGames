// Utilitários HTTP do painel (Node puro, sem framework). Independentes do resto da api.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};

export function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(json);
}

/** Responde um erro (HttpError vira o status dele; o resto vira 500 sem detalhes). */
export function sendError(res, err) {
  if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
  console.error("admin.erro", err);
  if (!res.headersSent) send(res, 500, { error: "erro_interno", message: "Erro interno." });
}

export async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "corpo_grande", "Requisição grande demais.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    fail(400, "json_invalido", "JSON inválido.");
  }
}

// atrás de nginx/Traefik o IP real vem no X-Real-IP (o nginx do painel sobrescreve o valor do cliente)
export const clientIp = (req) => req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

// Limite simples em memória: N requisições por chave a cada janela
const hits = new Map();

export function rateLimit(req, bucket, max = 30, windowSec = 600, id = clientIp(req)) {
  const key = `${bucket}:${id}`;
  const t = Date.now() / 1000;
  const entry = hits.get(key);
  if (!entry || entry.reset <= t) {
    hits.set(key, { count: 1, reset: t + windowSec });
    return;
  }
  if (++entry.count > max) fail(429, "muitas_tentativas", "Muitas tentativas. Tente de novo mais tarde.");
}

setInterval(() => {
  const t = Date.now() / 1000;
  for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
}, 60_000).unref();

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {}
    }
  }
  return out;
}
