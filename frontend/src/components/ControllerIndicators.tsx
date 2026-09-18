// Indicador UNIFICADO de quem esta conectado (controle fisico E celular
// remoto). Dois visuais, ver "variant":
//   - "pills" (Biblioteca): pontinho colorido + icone (🎮/📱) + Pn, cada
//     um num pill separado — usado FLUTUANTE (position:fixed), mesmo
//     lugar/comportamento que o RemoteControlBadge antigo tinha (pedido
//     explicito: so' o Player deveria ter mudado de posicao, a Biblioteca
//     era pra ter ficado como estava).
//   - "dots" (Player/"gamescreen"): SO' o pontinho luminoso colorido, sem
//     icone, sem texto, sem borda/fundo nenhum (pedido explicito) — fica
//     ao lado do titulo do jogo.
import type { RemoteControlStatus } from "../remoteControl/RemoteControlContext";

const PLAYER_COLORS = ["#00e5ff", "#ff2e9a", "#39ff8f", "#ffb020"]; // P1..P4

export interface ControllerSlot {
  player: number;
  kind: "gamepad" | "phone";
}

// Rotulo pro pill "pendente" (so' no variant "pills" — ver pendingLabel
// abaixo) — os 3 status que fazem sentido mostrar ANTES de um celular
// conectar de verdade; "idle"/"connected" nao usam isso ("idle" nem
// mostra o indicador, "connected" ja tem pills/pontos de verdade).
export const REMOTE_PENDING_LABEL: Partial<Record<RemoteControlStatus, string>> = {
  connecting: "Gerando código...",
  waiting: "Aguardando celular...",
  error: "Erro na conexão",
};

// pendingLabel/pending cobrem o intervalo entre gerar o QR e o celular de
// fato escanear — sem pills/pontos nenhum pra mostrar ainda
// (remoteControl.phones so' ganha entrada quando um celular CONECTA de
// verdade), mas o indicador precisa continuar visivel/clicavel mesmo
// assim, senao fechar o modal do QR nessa janela tira o unico jeito de
// reabri-lo.
export default function ControllerIndicators({
  slots,
  variant = "pills",
  floating = false,
  pendingLabel,
  onClick,
  dataBpId,
  focused = false,
}: {
  slots: ControllerSlot[];
  variant?: "pills" | "dots";
  floating?: boolean;
  pendingLabel?: string;
  onClick: () => void;
  // So' a Biblioteca usa (ver Library.tsx) — deixa o badge navegavel pelo
  // controle junto com o resto do [data-bp-id] (pedido explicito: o
  // controle nao conseguia chegar nele antes). O Player/"gamescreen" nao
  // tem esse sistema de navegacao espacial, entao fica opcional.
  dataBpId?: string;
  focused?: boolean;
}) {
  const pending = slots.length === 0 && !!pendingLabel;
  if (slots.length === 0 && !pending) return null;
  const sorted = [...slots].sort((a, b) => a.player - b.player);

  if (variant === "dots") {
    return (
      <button
        type="button"
        data-bp-id={dataBpId}
        className={`controller-dots${floating ? " controller-indicators-floating" : ""}${focused ? " bp-focused" : ""}`}
        onClick={onClick}
        aria-label="Controles conectados"
      >
        {sorted.map((s) => (
          <span
            key={`${s.kind}-${s.player}`}
            className="controller-dot"
            style={{ ["--pill-color" as string]: PLAYER_COLORS[s.player - 1] ?? "#fff" }}
          />
        ))}
        {pending && <span className="controller-dot controller-dot-pending" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-bp-id={dataBpId}
      className={`controller-indicators${floating ? " controller-indicators-floating" : ""}${focused ? " bp-focused" : ""}`}
      onClick={onClick}
      aria-label="Controles conectados"
    >
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
      {pending && <span className="controller-pill controller-pill-pending">{pendingLabel}</span>}
    </button>
  );
}
