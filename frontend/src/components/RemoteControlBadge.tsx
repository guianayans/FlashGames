import type { RemoteControlStatus, RemotePhone } from "../remoteControl/RemoteControlContext";

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
// so' esconder e continuar usando). Com mais de 1 celular conectado
// (multiplayer, ver RemoteControlContext), mostra "P1+P2" em vez do
// texto generico de "conectado".
export default function RemoteControlBadge({
  status,
  phones,
  onClick,
}: {
  status: RemoteControlStatus;
  phones: RemotePhone[];
  onClick: () => void;
}) {
  if (status === "idle") return null;
  const connectedPhones = phones.filter((p) => p.connected);
  const label =
    status === "connected" && connectedPhones.length > 0
      ? `🎮 ${connectedPhones.map((p) => `P${p.player}`).join("+")}`
      : LABEL[status];
  return (
    <button type="button" className={`remote-badge ${status}`} onClick={onClick}>
      <span className="remote-badge-dot" />
      {label}
    </button>
  );
}
