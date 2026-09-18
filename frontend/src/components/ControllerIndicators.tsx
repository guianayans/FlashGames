// Indicador UNIFICADO de quem esta conectado (controle fisico E celular
// remoto) — pedido explicito pra substituir dois problemas: (a) o nome
// completo/verboso de cada controle fisico (ex. "Xbox Wireless
// Controller") que aparecia do lado do titulo, e (b) o badge do celular
// remoto (RemoteControlBadge) que ficava plantado sozinho num canto fixo
// da tela, desgrudado do resto — "num lugar errado" (nem perto do
// titulo, nem junto com o indicador do controle fisico). Agora e' tudo
// junto, do lado do titulo: um pontinho colorido (cor por jogador, mesma
// paleta do #player-badge em RemoteController.html) + icone (🎮 fisico,
// 📱 celular) + Pn, um PILL SEPARADO por dispositivo (nao um texto so'
// tipo "P1+P2").
import type { RemoteControlStatus } from "../remoteControl/RemoteControlContext";

const PLAYER_COLORS = ["#00e5ff", "#ff2e9a", "#39ff8f", "#ffb020"]; // P1..P4

export interface ControllerSlot {
  player: number;
  kind: "gamepad" | "phone";
}

// Rotulo pro pill "pendente" (ver pendingLabel abaixo) — so' os 3 status
// que fazem sentido mostrar ANTES de um celular conectar de verdade;
// "idle"/"connected" nao usam isso ("idle" nem mostra o indicador,
// "connected" ja tem pills de verdade pros celulares).
export const REMOTE_PENDING_LABEL: Partial<Record<RemoteControlStatus, string>> = {
  connecting: "Gerando código...",
  waiting: "Aguardando celular...",
  error: "Erro na conexão",
};

// "pendingLabel" cobre o intervalo entre gerar o QR e o celular de fato
// escanear (status "connecting"/"waiting"/"error" no RemoteControlContext)
// — sem pills nenhum pra mostrar ainda (remoteControl.phones so' ganha
// entrada quando um celular CONECTA de verdade), mas o indicador precisa
// continuar visivel/clicavel mesmo assim, senao fechar o modal do QR
// nessa janela tira o unico jeito de reabri-lo.
export default function ControllerIndicators({
  slots,
  pendingLabel,
  onClick,
}: {
  slots: ControllerSlot[];
  pendingLabel?: string;
  onClick: () => void;
}) {
  if (slots.length === 0 && !pendingLabel) return null;
  const sorted = [...slots].sort((a, b) => a.player - b.player);
  return (
    <button type="button" className="controller-indicators" onClick={onClick} aria-label="Controles conectados">
      {sorted.map((s) => (
        <span
          key={`${s.kind}-${s.player}`}
          className="controller-pill"
          style={{ ["--pill-color" as string]: PLAYER_COLORS[s.player - 1] ?? "#fff" }}
        >
          <span className="controller-pill-dot" />
          <span className="controller-pill-icon">{s.kind === "gamepad" ? "🎮" : "📱"}</span>
          {`P${s.player}`}
        </span>
      ))}
      {slots.length === 0 && pendingLabel && <span className="controller-pill controller-pill-pending">{pendingLabel}</span>}
    </button>
  );
}
