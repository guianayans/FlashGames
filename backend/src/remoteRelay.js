import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { Router } from "express";
import { requireAuth } from "./auth.js";

// Controle remoto via QR code: o desktop pede um token curto (pareamento),
// mostra ele como QR, e o celular que escaneia abre /remote/<token> e
// conecta no MESMO token por WebSocket — o relay so' encaminha mensagem
// crua de um lado pro outro, sem entender o conteudo (quem interpreta
// {button, down} e chama nostalgist.pressDown/pressUp e' o DesktopPlayer,
// ver frontend/src/pages/Player.tsx). O token em si e' o unico segredo:
// curto o bastante pra caber num QR pequeno, mas com entropia suficiente
// (9 bytes aleatorios = 72 bits) pra nao ser adivinhavel dentro da janela
// curta em que fica valido pra parear.
const PAIR_TTL_MS = 5 * 60 * 1000; // token expira se ninguem parear em 5 min
const SESSION_TTL_MS = 60 * 60 * 1000; // pareado, a sessao dura ate 1h parada
const pairings = new Map(); // token -> { userId, desktopWs, phoneWs, expiresAt }

function cleanupExpired() {
  const now = Date.now();
  for (const [token, pairing] of pairings) {
    if (now > pairing.expiresAt) {
      pairing.desktopWs?.close();
      pairing.phoneWs?.close();
      pairings.delete(token);
    }
  }
}

export const remoteRouter = Router();

// So' o desktop (logado) gera o token — o celular nunca precisa de conta
// propria, so' do token que aparece no QR (mesmo modelo de pareamento por
// codigo curto que Chromecast/AirPlay usam).
remoteRouter.post("/pair", requireAuth, (req, res) => {
  cleanupExpired();
  const token = crypto.randomBytes(9).toString("base64url");
  pairings.set(token, {
    userId: req.user.id,
    desktopWs: null,
    phoneWs: null,
    expiresAt: Date.now() + PAIR_TTL_MS,
  });
  res.json({ token, path: `/remote/${token}` });
});

// Anexado no MESMO http.Server que o Express usa (ver server.js) — so'
// intercepta upgrades pro path /ws/remote, deixa qualquer outro upgrade
// (nenhum outro existe hoje, mas nao custa) passar batido.
export function attachRemoteWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://internal");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws/remote") return;

    const token = url.searchParams.get("token");
    const role = url.searchParams.get("role");
    const pairing = token ? pairings.get(token) : null;
    if (!pairing || Date.now() > pairing.expiresAt || (role !== "desktop" && role !== "phone")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, { token, role, pairing });
    });
  });

  wss.on("connection", (ws, { token, role, pairing }) => {
    // Conectou de verdade (nao so' pareou o token) — renova a validade,
    // deixa de expirar so' por causa do timer de pareamento inicial.
    pairing.expiresAt = Date.now() + SESSION_TTL_MS;

    // Uma nova conexao do MESMO papel substitui a antiga (reconexao apos
    // queda de wifi, por exemplo) — fecha a que tinha antes.
    if (role === "desktop") {
      pairing.desktopWs?.close();
      pairing.desktopWs = ws;
    } else {
      pairing.phoneWs?.close();
      pairing.phoneWs = ws;
    }

    function peer() {
      return role === "desktop" ? pairing.phoneWs : pairing.desktopWs;
    }

    if (pairing.desktopWs && pairing.phoneWs) {
      const msg = JSON.stringify({ type: "paired" });
      try {
        pairing.desktopWs.send(msg);
        pairing.phoneWs.send(msg);
      } catch {
        // conexao caiu entre o if e o send — o proprio 'close' de baixo cuida da limpeza
      }
    }

    ws.on("message", (data) => {
      const p = peer();
      // data chega como Buffer (a lib "ws" entrega binario por padrao,
      // mesmo pra frames de texto) — repassar o Buffer direto faz o
      // send() do lado do relay mandar como frame BINARIO, e o navegador
      // do outro lado entrega isso como Blob em vez de string, quebrando
      // o JSON.parse(e.data) de quem esta ouvindo. .toString() converte
      // de volta pra texto antes de reencaminhar, preservando o frame
      // como texto de ponta a ponta.
      if (p && p.readyState === p.OPEN) p.send(data.toString());
    });

    ws.on("close", () => {
      if (role === "desktop") pairing.desktopWs = null;
      else pairing.phoneWs = null;
      const p = peer();
      if (p && p.readyState === p.OPEN) {
        try {
          p.send(JSON.stringify({ type: "peer-disconnected" }));
        } catch {
          // nada a fazer, o peer ja esta indo embora tambem
        }
      }
      if (!pairing.desktopWs && !pairing.phoneWs) pairings.delete(token);
    });
  });

  setInterval(cleanupExpired, 60_000).unref();
}
