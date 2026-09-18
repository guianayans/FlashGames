import { useEffect, useState } from "react";
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

// Modal que mostra o QR code de pareamento (ver RemoteControlContext) —
// o QR e' so' a URL /remote/<token> renderizada como imagem (biblioteca
// "qrcode", client-side, sem round-trip nenhum pro servidor alem do que
// o context ja faz). "Fechar" so' esconde o modal (o controle continua
// conectado, ver RemoteControlBadge — fica por cima da tela); so'
// "Desconectar" derruba a conexao de verdade — os dois eram a MESMA
// coisa antes, obrigando escolher entre ver o jogo/app ou ficar
// conectado.
export default function RemotePairingModal({
  status,
  remoteUrl,
  phones,
  onClose,
  onDisconnect,
}: {
  status: RemoteControlStatus;
  remoteUrl: string | null;
  phones: RemotePhone[];
  onClose: () => void;
  onDisconnect: () => void;
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
                🎮 P{p.player} {p.connected ? "" : "(desconectado)"}
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
          <button type="button" className="remote-pairing-close" onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="remote-pairing-disconnect" onClick={onDisconnect}>
            Desconectar
          </button>
        </div>
      </div>
    </div>
  );
}
