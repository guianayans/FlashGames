import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { RemoteControlStatus } from "../remoteControl/RemoteControlContext";

const STATUS_LABEL: Record<RemoteControlStatus, string> = {
  idle: "",
  connecting: "Gerando código...",
  waiting: "Escaneie o QR code com o celular",
  connected: "Celular conectado — use como controle",
  error: "Não deu pra conectar, tenta de novo",
};

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
  onClose,
  onDisconnect,
}: {
  status: RemoteControlStatus;
  remoteUrl: string | null;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

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
        {qrDataUrl && status !== "connected" && <img src={qrDataUrl} alt="QR code de pareamento" className="remote-pairing-qr" />}
        {status === "connected" && <div className="remote-pairing-connected-icon">🎮</div>}
        <p className="remote-pairing-hint">
          Abra o app no celular e escaneie pra usar a tela como controle.
        </p>
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
