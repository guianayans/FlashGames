import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { Router } from "express";
import { requireAuth } from "./auth.js";

// Controle remoto via QR code: o desktop pede um token curto (pareamento),
// mostra ele como QR, e ate' 4 celulares que escaneiam o MESMO codigo (nao
// tem QR por celular — um so' codigo, cada scan vira um jogador novo, igual
// jogo de festa tipo Jackbox) abrem /remote/<token> e conectam no mesmo
// token por WebSocket. O relay so' faz roteamento — quem decide QUAL numero
// de jogador (P1..P4) cada celular recebe, coordenando com os controles
// FISICOS que so' o desktop enxerga (Gamepad API), e' o proprio desktop
// (ver RemoteControlContext.tsx) — aqui e' so' transporte.
//
// Cada celular manda um "clientId" proprio (gerado uma vez, guardado no
// localStorage do celular) — e' o que deixa ele RECONECTAR (queda de wifi,
// refresh) mantendo a MESMA identidade, sem o desktop precisar reatribuir
// um numero de jogador novo pra ele.
const PAIR_TTL_MS = 5 * 60 * 1000; // token expira se ninguem parear em 5 min
const SESSION_TTL_MS = 60 * 60 * 1000; // pareado, a sessao dura ate 1h parada
const MAX_PHONES = 4; // teto tecnico do relay — a regra "4 no total contando controle fisico" quem aplica e' o desktop (ver roomFull)
const pairings = new Map(); // token -> { userId, desktopWs, phones: Map<clientId, ws>, expiresAt }

function cleanupExpired() {
  const now = Date.now();
  for (const [token, pairing] of pairings) {
    if (now > pairing.expiresAt) {
      pairing.desktopWs?.close();
      for (const ws of pairing.phones.values()) ws.close();
      pairings.delete(token);
    }
  }
}

export const remoteRouter = Router();

// So' o desktop (logado) gera o token — os celulares nunca precisam de
// conta propria, so' do token que aparece no QR (mesmo modelo de
// pareamento por codigo curto que Chromecast/AirPlay usam).
remoteRouter.post("/pair", requireAuth, (req, res) => {
  cleanupExpired();
  const token = crypto.randomBytes(9).toString("base64url");
  pairings.set(token, {
    userId: req.user.id,
    desktopWs: null,
    phones: new Map(),
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
    const clientId = url.searchParams.get("clientId") || null;
    const pairing = token ? pairings.get(token) : null;
    if (!pairing || Date.now() > pairing.expiresAt || (role !== "desktop" && role !== "phone")) {
      socket.destroy();
      return;
    }
    if (role === "phone" && !clientId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, { token, role, clientId, pairing });
    });
  });

  wss.on("connection", (ws, { token, role, clientId, pairing }) => {
    // Conectou de verdade (nao so' pareou o token) — renova a validade,
    // deixa de expirar so' por causa do timer de pareamento inicial. Isso
    // tambem e' o que faz a sessao sobreviver a queda de wifi/refresh: o
    // token so' morre se TODO MUNDO (desktop e celulares) ficar ausente
    // por SESSION_TTL_MS inteiro (ver cleanupExpired).
    pairing.expiresAt = Date.now() + SESSION_TTL_MS;

    function sendTo(target, msg) {
      if (target && target.readyState === target.OPEN) {
        try {
          target.send(JSON.stringify(msg));
        } catch {
          // conexao caiu entre o check e o send — o proprio 'close' de baixo cuida da limpeza
        }
      }
    }
    function notifyDesktop(msg) {
      sendTo(pairing.desktopWs, msg);
    }
    function notifyPhone(id, msg) {
      sendTo(pairing.phones.get(id), msg);
    }
    function notifyAllPhones(msg) {
      for (const p of pairing.phones.values()) sendTo(p, msg);
    }

    if (role === "desktop") {
      // Uma nova conexao desktop substitui a antiga (reconexao apos
      // queda de wifi ou refresh de pagina) — fecha a que tinha antes.
      pairing.desktopWs?.close();
      pairing.desktopWs = ws;
      // Manda a lista de celulares JA conectados de uma vez so' — e' o
      // que deixa o desktop reconstruir os P1..P4 depois de um refresh
      // sem esperar cada celular reconectar (eles nem cairam, so' o
      // desktop que recarregou a pagina).
      notifyDesktop({ type: "phone-list", clientIds: Array.from(pairing.phones.keys()) });
      notifyAllPhones({ type: "paired" });
    } else {
      const isReconnect = pairing.phones.has(clientId);
      // Teto tecnico generoso (nao e' a regra de negocio "4 no total
      // contando controle fisico", essa quem aplica e' o desktop mandando
      // roomFull pra um clientId NOVO que ele nao tem slot livre pra dar —
      // isso aqui so' evita um token virando ponto de conexao ilimitada).
      // Verificado DEPOIS do handshake completar (nao no upgrade, que so'
      // consegue derrubar a conexao sem enviar mensagem nenhuma) pra' o
      // celular rejeitado receber um "roomFull" de verdade em vez de ficar
      // preso num loop de reconexao silencioso pra sempre.
      if (!isReconnect && pairing.phones.size >= MAX_PHONES) {
        sendTo(ws, { type: "roomFull" });
        ws.close();
        return;
      }
      const prevSameId = pairing.phones.get(clientId);
      prevSameId?.close();
      pairing.phones.set(clientId, ws);
      notifyDesktop({ type: "phone-joined", clientId });
      if (pairing.desktopWs) sendTo(ws, { type: "paired" });
    }

    ws.on("message", (data) => {
      // data chega como Buffer (a lib "ws" entrega binario por padrao,
      // mesmo pra frames de texto) — precisa fazer o parse aqui de
      // qualquer forma (pra marcar/rotear por clientId), entao o relay
      // deixou de ser um passthrough cru — mas o JSON.stringify no send
      // de volta ja' garante frame de TEXTO do outro lado (ver bug
      // historico do Buffer virando Blob no navegador).
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (role === "desktop") {
        // Mensagem enderecada a UM celular especifico (ex.: assignSlot,
        // roomFull) — "to" e' o clientId de destino; sem "to", manda pra
        // TODOS os celulares conectados (nenhum uso disso hoje, mas fica
        // pronto pro dia que precisar de um broadcast).
        if (typeof parsed.to === "string") {
          notifyPhone(parsed.to, parsed);
        } else {
          notifyAllPhones(parsed);
        }
      } else {
        notifyDesktop({ ...parsed, clientId });
      }
    });

    ws.on("close", () => {
      if (role === "desktop") {
        if (pairing.desktopWs === ws) pairing.desktopWs = null;
        notifyAllPhones({ type: "peer-disconnected" });
      } else {
        if (pairing.phones.get(clientId) === ws) pairing.phones.delete(clientId);
        notifyDesktop({ type: "phone-left", clientId });
      }
      if (!pairing.desktopWs && pairing.phones.size === 0) pairings.delete(token);
    });
  });

  setInterval(cleanupExpired, 60_000).unref();
}
