import { useEffect, useRef, useState } from "react";

const GAMEPAD_STICK_DEAD = 0.5;

// Overlay generico de confirmacao (Sim/Nao) — usado tanto pro dialogo
// "Sair do jogo?" (Player.tsx) quanto pra confirmar desfavoritar
// (Library.tsx). Le o gamepad direto (independente de qualquer loop de
// input do jogo/pagina por tras, que deve ficar pausado enquanto isso
// esta aberto): D-pad/analogico esquerdo trocam o foco entre as duas
// opcoes, botao de baixo confirma a escolha atual, B ou Start cancelam.
// Comeca focado em "Nao" de proposito — a acao destrutiva/irreversivel
// e' a excecao, nao o padrao.
export default function ConfirmDialog({
  message,
  confirmLabel = "Sim",
  cancelLabel = "Não",
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [focus, setFocus] = useState<"yes" | "no">("no");
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const [gpActive, setGpActive] = useState(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let raf = 0;
    let gpIndex: number | null = null;
    let dirHeld: "left" | "right" | null = null;
    const btnState: Record<number, boolean> = {};
    // O botao que abriu esse dialogo (ex.: Bola pra desfavoritar, X pra
    // confirmar um slot de save) quase sempre AINDA esta fisicamente
    // pressionado no primeiro frame daqui — sem isso, btnState comecando
    // vazio faria esse mesmo botao (que aqui pode significar "Cancelar"
    // ou "Confirmar") disparar IMEDIATAMENTE de novo, fechando o dialogo
    // sozinho meio segundo depois de abrir. Primeiro frame so' registra o
    // que ja esta pressionado, sem agir; a deteccao de borda (like antes)
    // comeca so' a partir do segundo frame.
    let armed = false;

    function poll() {
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

        if (!armed) {
          armed = true;
          [0, 1, 9].forEach((idx) => {
            btnState[idx] = !!gp?.buttons[idx]?.pressed;
          });
          raf = requestAnimationFrame(poll);
          return;
        }

        const [ax] = gp.axes;
        const left = !!gp.buttons[14]?.pressed || (typeof ax === "number" && ax < -GAMEPAD_STICK_DEAD);
        const right = !!gp.buttons[15]?.pressed || (typeof ax === "number" && ax > GAMEPAD_STICK_DEAD);
        const dirNow = left ? "left" : right ? "right" : null;
        if (dirNow && dirNow !== dirHeld) setFocus((f) => (f === "yes" ? "no" : "yes"));
        dirHeld = dirNow;

        if (gp.buttons[0]?.pressed && !btnState[0]) {
          if (focusRef.current === "yes") onConfirmRef.current();
          else onCancelRef.current();
        }
        if ((gp.buttons[1]?.pressed && !btnState[1]) || (gp.buttons[9]?.pressed && !btnState[9])) onCancelRef.current();
        [0, 1, 9].forEach((idx) => {
          btnState[idx] = !!gp?.buttons[idx]?.pressed;
        });
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-text">{message}</p>
        <div className="confirm-actions">
          <button type="button" className={`confirm-btn${gpActive && focus === "no" ? " bp-focused" : ""}`} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`confirm-btn${gpActive && focus === "yes" ? " bp-focused" : ""}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
