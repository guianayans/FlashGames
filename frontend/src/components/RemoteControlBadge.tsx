import type { RemoteControlStatus } from "../remoteControl/RemoteControlContext";

const LABEL: Record<Exclude<RemoteControlStatus, "idle">, string> = {
  connecting: "Gerando código...",
  waiting: "Aguardando celular...",
  connected: "🎮 Conectado",
  error: "Erro na conexão",
};

// Indicador PERSISTENTE (nunca some sozinho) de que ha' uma sessao de
// controle remoto ativa — fica por cima do jogo/biblioteca, pequeno e
// fora do caminho, em vez do modal grande do QR (esse so' aparece de
// novo se o usuario tocar aqui, ver RemotePairingModal). Cobre a
// reclamacao original: antes, fechar o modal DESCONECTAVA (nao dava pra
// so' esconder e continuar usando).
export default function RemoteControlBadge({
  status,
  onClick,
}: {
  status: RemoteControlStatus;
  onClick: () => void;
}) {
  if (status === "idle") return null;
  return (
    <button type="button" className={`remote-badge ${status}`} onClick={onClick}>
      <span className="remote-badge-dot" />
      {LABEL[status]}
    </button>
  );
}
