import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { RemoteControlStatus, RemotePhone } from "../remoteControl/RemoteControlContext";

const STATUS_LABEL: Record<RemoteControlStatus, string> = {
  idle: "",
  connecting: "Gerando código...",
  waiting: "Escaneie o QR code com o celular",
  connected: "Conectado — use como controle",
  error: "Não deu pra conectar, tenta de novo",
};

const MAX_PLAYERS = 4;
const GAMEPAD_STICK_DEAD = 0.5;

// Modal que mostra o QR code de pareamento (ver RemoteControlContext) —
// o QR e' so' a URL /remote/<token> renderizada como imagem (biblioteca
// "qrcode", client-side, sem round-trip nenhum pro servidor alem do que
// o context ja faz). "Fechar" so' esconde o modal (o controle continua
// conectado, ver ControllerIndicators — fica no topbar/header); so'
// "Desconectar" derruba a conexao de verdade — os dois eram a MESMA
// coisa antes, obrigando escolher entre ver o jogo/app ou ficar
// conectado.
export default function RemotePairingModal({
  status,
  remoteUrl,
  phones,
  onClose,
  onDisconnect,
  onKickPhone,
}: {
  status: RemoteControlStatus;
  remoteUrl: string | null;
  phones: RemotePhone[];
  onClose: () => void;
  onDisconnect: () => void;
  onKickPhone: (clientId: string) => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const roomFull = phones.length >= MAX_PLAYERS;

  useEffect(() => {
    if (!remoteUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(remoteUrl, { width: 240, margin: 1, color: { dark: "#0a0a0a", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [remoteUrl]);

  // Navegacao pelo controle FISICO dentro do modal (pedido explicito: o
  // controle nao conseguia nem abrir nem mexer aqui dentro antes) — mesmo
  // padrao independente do SaveStateMenu em Player.tsx (le o gamepad
  // direto, num [data-gp-id] proprio, sem depender do sistema de foco da
  // pagina de tras — que ja fica pausado enquanto esse modal esta' aberto,
  // ver pairingModalOpenRef no poll() de Library.tsx/Player.tsx).
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusedKeyRef = useRef(focusedKey);
  focusedKeyRef.current = focusedKey;
  const [gpActive, setGpActive] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const first = document.querySelector<HTMLElement>(".remote-pairing-card [data-gp-id]");
    if (first?.dataset.gpId) setFocusedKey(first.dataset.gpId);
  }, [phones.length]);

  function moveMenuFocus(dir: "up" | "down" | "left" | "right") {
    const all = Array.from(document.querySelectorAll<HTMLElement>(".remote-pairing-card [data-gp-id]"));
    if (all.length === 0) return;
    const currentKey = focusedKeyRef.current;
    const currentEl = currentKey ? all.find((el) => el.dataset.gpId === currentKey) : null;
    if (!currentEl) {
      const first = all[0]?.dataset.gpId;
      if (first) setFocusedKey(first);
      return;
    }
    const cur = currentEl.getBoundingClientRect();
    const curCx = cur.left + cur.width / 2;
    const curCy = cur.top + cur.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === currentEl) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - curCx;
      const dy = r.top + r.height / 2 - curCy;
      let score: number;
      if (dir === "right") {
        if (dx <= 4) continue;
        score = dx + Math.abs(dy) * 4;
      } else if (dir === "left") {
        if (dx >= -4) continue;
        score = -dx + Math.abs(dy) * 4;
      } else if (dir === "down") {
        if (dy <= 4) continue;
        score = dy + Math.abs(dx) * 1.2;
      } else {
        if (dy >= -4) continue;
        score = -dy + Math.abs(dx) * 1.2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best?.dataset.gpId) setFocusedKey(best.dataset.gpId);
  }

  function confirmMenuFocus() {
    const key = focusedKeyRef.current;
    if (!key) return;
    const el = document.querySelector<HTMLElement>(`.remote-pairing-card [data-gp-id="${CSS.escape(key)}"]`);
    el?.click();
  }

  useEffect(() => {
    let gpIndex: number | null = null;
    let raf = 0;
    const REPEAT_DELAY_MS = 320;
    const REPEAT_RATE_MS = 140;
    const dirState: Record<string, { held: boolean; nextAt: number }> = {
      up: { held: false, nextAt: 0 },
      down: { held: false, nextAt: 0 },
      left: { held: false, nextAt: 0 },
      right: { held: false, nextAt: 0 },
    };
    const btnState: Record<number, boolean> = {};

    function handleDir(dir: "up" | "down" | "left" | "right", pressed: boolean, now: number) {
      const s = dirState[dir];
      if (!pressed) {
        s.held = false;
        return;
      }
      if (!s.held) {
        s.held = true;
        s.nextAt = now + REPEAT_DELAY_MS;
        moveMenuFocus(dir);
      } else if (now >= s.nextAt) {
        s.nextAt = now + REPEAT_RATE_MS;
        moveMenuFocus(dir);
      }
    }

    let seeded = false;
    function poll() {
      const now = performance.now();
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp: Gamepad | null = gpIndex !== null ? pads[gpIndex] : null;
      if (!gp) {
        for (let i = 0; i < pads.length; i++) {
          if (pads[i]) {
            gp = pads[i];
            gpIndex = i;
            break;
          }
        }
      }
      if (gp) {
        setGpActive(true);
        // O confirmar que ABRIU esse modal (botao de baixo num item
        // focado na grade de tras) pode continuar fisicamente segurado
        // no exato frame em que esse poll() novo comeca — sem "semear"
        // o btnState com o estado JA' pressionado, esse mesmo toque
        // "vazava" pra dentro e confirmava o primeiro item focado aqui
        // dentro na hora, fechando o modal sozinho sem o usuario soltar
        // o botao nem uma vez.
        if (!seeded) {
          seeded = true;
          [0, 1, 9].forEach((idx) => {
            btnState[idx] = !!gp?.buttons[idx]?.pressed;
          });
        }
        const [ax, ay] = gp.axes;
        const left = !!gp.buttons[14]?.pressed || (typeof ax === "number" && ax < -GAMEPAD_STICK_DEAD);
        const right = !!gp.buttons[15]?.pressed || (typeof ax === "number" && ax > GAMEPAD_STICK_DEAD);
        const up = !!gp.buttons[12]?.pressed || (typeof ay === "number" && ay < -GAMEPAD_STICK_DEAD);
        const down = !!gp.buttons[13]?.pressed || (typeof ay === "number" && ay > GAMEPAD_STICK_DEAD);
        handleDir("left", left, now);
        handleDir("right", right, now);
        handleDir("up", up, now);
        handleDir("down", down, now);

        if (gp.buttons[0]?.pressed && !btnState[0]) confirmMenuFocus();
        if ((gp.buttons[1]?.pressed && !btnState[1]) || (gp.buttons[9]?.pressed && !btnState[9])) onCloseRef.current();
        [0, 1, 9].forEach((idx) => {
          btnState[idx] = !!gp?.buttons[idx]?.pressed;
        });
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="remote-pairing-card" onClick={(e) => e.stopPropagation()}>
        <h2>Controle remoto</h2>
        <p className="remote-pairing-status">
          <span className={`remote-pairing-dot ${status}`} />
          {STATUS_LABEL[status]}
        </p>
        {phones.length > 0 && (
          <ul className="remote-pairing-players">
            {phones.map((p) => (
              <li key={p.clientId} className={p.connected ? "connected" : "disconnected"}>
                <span>
                  🎮 P{p.player} {p.connected ? "" : "(desconectado)"}
                </span>
                {/* So' faz sentido desconectar quem esta' conectado de
                    verdade agora — uma entrada "(desconectado)" e' so'
                    a fila que reconecta sozinha, nao tem WS pra kickar
                    (pedido explicito: "x" por celular pra desconectar
                    so' um, sem derrubar os outros — ver kickPhone). */}
                {p.connected && (
                  <button
                    type="button"
                    data-gp-id={`kick:${p.clientId}`}
                    className={`remote-pairing-kick${gpActive && focusedKey === `kick:${p.clientId}` ? " bp-focused" : ""}`}
                    onClick={() => onKickPhone(p.clientId)}
                    aria-label={`Desconectar P${p.player}`}
                    title={`Desconectar P${p.player}`}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {qrDataUrl && !roomFull && <img src={qrDataUrl} alt="QR code de pareamento" className="remote-pairing-qr" />}
        {roomFull ? (
          <p className="remote-pairing-hint">Sala cheia — 4 de 4 jogadores conectados.</p>
        ) : (
          <p className="remote-pairing-hint">
            {phones.length > 0
              ? "Outro celular pode escanear o mesmo QR code pra entrar como próximo jogador."
              : "Abra o app no celular e escaneie pra usar a tela como controle."}
          </p>
        )}
        <div className="remote-pairing-actions">
          <button
            type="button"
            data-gp-id="close"
            className={`remote-pairing-close${gpActive && focusedKey === "close" ? " bp-focused" : ""}`}
            onClick={onClose}
          >
            Fechar
          </button>
          <button
            type="button"
            data-gp-id="disconnect"
            className={`remote-pairing-disconnect${gpActive && focusedKey === "disconnect" ? " bp-focused" : ""}`}
            onClick={onDisconnect}
          >
            Desconectar
          </button>
        </div>
      </div>
    </div>
  );
}
