import { useCallback, useEffect, useRef } from "react";
import type { ControlsConfig, DpadConfig } from "../types";

interface Props {
  controls: ControlsConfig;
  /** ref pro elemento <ruffle-player> (nao o wrapper) — é nele que o Ruffle escuta teclado/pointer */
  targetRef: React.RefObject<HTMLElement>;
  /** "shell": botoes quase invisiveis sobre a imagem do portatil (retrato). "fullscreen": mesmos botoes, reposicionados pros cantos da tela cheia (paisagem) */
  placement: "shell" | "fullscreen";
}

const CODE_MAP: Record<string, string> = {
  w: "KeyW",
  a: "KeyA",
  s: "KeyS",
  d: "KeyD",
  r: "KeyR",
  x: "KeyX",
  z: "KeyZ",
  " ": "Space",
  Enter: "Enter",
  Escape: "Escape",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  1: "Digit1",
  2: "Digit2",
  3: "Digit3",
  4: "Digit4",
  5: "Digit5",
  6: "Digit6",
};

function codeFor(key: string): string {
  return CODE_MAP[key] || (key.length === 1 ? `Key${key.toUpperCase()}` : key);
}

// O core do Ruffle so processa teclado quando a instancia tem "foco" (focusin/focusout
// no elemento <ruffle-player>, que ele proprio marca com tabindex=-1). Sem isso, todo
// keydown/keyup sintetico e silenciosamente ignorado.
function focusPlayer(target: HTMLElement | null) {
  if (!target) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

function dispatchKey(type: "keydown" | "keyup", key: string) {
  const ev = new KeyboardEvent(type, {
    key,
    code: codeFor(key),
    bubbles: true,
    cancelable: true,
  });
  // O Ruffle registra o listener de teclado em `window`.
  window.dispatchEvent(ev);
}

function getCanvas(playerEl: HTMLElement | null): HTMLElement | null {
  if (!playerEl) return null;
  // O <ruffle-player> renderiza o <canvas> dentro de uma shadow root propria
  // (aberta) — querySelector normal nao atravessa isso.
  return playerEl.querySelector("canvas") ?? playerEl.shadowRoot?.querySelector("canvas") ?? null;
}

// O Ruffle escuta pointerdown/pointermove/pointerup (PointerEvent) diretamente no
// <canvas> — nao mousedown/mousemove/mouseup. Precisa ser um PointerEvent de verdade
// (com pointerId) pra `offsetX`/`offsetY` e `setPointerCapture` funcionarem.
function dispatchPointer(canvas: HTMLElement, type: string, clientX: number, clientY: number, pressed: boolean) {
  const ev = new PointerEvent(type, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: pressed ? 1 : 0,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  canvas.dispatchEvent(ev);
}

// React marca onTouchStart/onTouchEnd como listeners passivos por padrao (pra
// nao atrapalhar o scroll da pagina), o que faz e.preventDefault() dentro do
// handler JSX falhar silenciosamente (so um aviso no console — o dispatch em
// si ainda roda, mas o navegador pode tratar o toque como scroll/zoom junto).
// Por isso os botoes anexam o listener manualmente com passive:false.
function usePressZone(onStart: () => void, onEnd: () => void) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  onStartRef.current = onStart;
  onEndRef.current = onEnd;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const start = (e: TouchEvent) => {
      e.preventDefault();
      el.classList.add("pressed");
      onStartRef.current();
    };
    const end = (e: TouchEvent) => {
      e.preventDefault();
      el.classList.remove("pressed");
      onEndRef.current();
    };

    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  return elRef;
}

function useDpad(targetRef: React.RefObject<HTMLElement>) {
  const activeDirs = useRef<Set<string>>(new Set());

  const press = useCallback(
    (dir: string, key?: string) => {
      if (!key) return;
      if (activeDirs.current.has(dir)) return;
      activeDirs.current.add(dir);
      focusPlayer(targetRef.current);
      dispatchKey("keydown", key);
    },
    [targetRef]
  );

  const release = useCallback((dir: string, key?: string) => {
    if (!key) return;
    if (!activeDirs.current.has(dir)) return;
    activeDirs.current.delete(dir);
    dispatchKey("keyup", key);
  }, []);

  return { press, release };
}

function DpadButton({
  name,
  keyValue,
  extraClass,
  press,
  release,
}: {
  name: string;
  keyValue: string | undefined;
  extraClass: string;
  press: (dir: string, key?: string) => void;
  release: (dir: string, key?: string) => void;
}) {
  const ref = usePressZone(
    () => press(name, keyValue),
    () => release(name, keyValue)
  );
  return <div ref={ref} className={`dp ${extraClass}`} />;
}

function Dpad({
  config,
  className,
  targetRef,
}: {
  config: DpadConfig;
  className: string;
  targetRef: React.RefObject<HTMLElement>;
}) {
  const { press, release } = useDpad(targetRef);

  return (
    <div className={className}>
      <DpadButton name="up" keyValue={config.up} extraClass="dp-up" press={press} release={release} />
      <DpadButton name="left" keyValue={config.left} extraClass="dp-left" press={press} release={release} />
      <DpadButton name="right" keyValue={config.right} extraClass="dp-right" press={press} release={release} />
      <DpadButton name="down" keyValue={config.down} extraClass="dp-down" press={press} release={release} />
    </div>
  );
}

function ActionButton({
  id,
  keyValue,
  position,
  targetRef,
}: {
  id: string;
  keyValue: string;
  position: string;
  targetRef: React.RefObject<HTMLElement>;
}) {
  const ref = usePressZone(
    () => {
      focusPlayer(targetRef.current);
      dispatchKey("keydown", keyValue);
    },
    () => dispatchKey("keyup", keyValue)
  );
  return <div key={id} ref={ref} className={`ctl-btn slot-${position}`} />;
}

export default function TouchControls({ controls, targetRef, placement }: Props) {
  const stickBase = useRef<HTMLDivElement | null>(null);
  const stickPointerId = useRef<number | null>(null);

  const updateStick = useCallback(
    (clientX: number, clientY: number, fireOnHold: boolean, isStart: boolean) => {
      const base = stickBase.current;
      const canvas = getCanvas(targetRef.current);
      if (!base || !canvas) return;

      const baseRect = base.getBoundingClientRect();
      const centerX = baseRect.left + baseRect.width / 2;
      const centerY = baseRect.top + baseRect.height / 2;
      const uiRadius = baseRect.width / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);
      const intensity = Math.min(dist / uiRadius, 1);
      if (dist > uiRadius) {
        dx = (dx / dist) * uiRadius;
        dy = (dy / dist) * uiRadius;
      }

      const canvasRect = canvas.getBoundingClientRect();
      const gameCenterX = canvasRect.left + canvasRect.width / 2;
      const gameCenterY = canvasRect.top + canvasRect.height / 2;
      const aimX = gameCenterX + (dx / uiRadius) * (canvasRect.width / 2) * Math.max(intensity, 0.35);
      const aimY = gameCenterY + (dy / uiRadius) * (canvasRect.height / 2) * Math.max(intensity, 0.35);

      dispatchPointer(canvas, "pointermove", aimX, aimY, true);
      if (isStart && fireOnHold) {
        dispatchPointer(canvas, "pointerdown", aimX, aimY, true);
      }
    },
    [targetRef]
  );

  const resetStick = useCallback(
    (fireOnHold: boolean) => {
      const canvas = getCanvas(targetRef.current);
      if (canvas && fireOnHold) {
        const r = canvas.getBoundingClientRect();
        dispatchPointer(canvas, "pointerup", r.left + r.width / 2, r.top + r.height / 2, false);
      }
    },
    [targetRef]
  );

  const dpad = controls.dpad;
  const dpad2 = controls.dpad2;
  const stick = controls.aimJoystick;
  const buttons = controls.buttons || [];

  return (
    <div className={`touch-controls placement-${placement}`}>
      {dpad && <Dpad config={dpad} className="ctl-dpad" targetRef={targetRef} />}
      {dpad2 && <Dpad config={dpad2} className="ctl-dpad ctl-dpad2" targetRef={targetRef} />}

      {stick && (
        <div
          className="ctl-stick ctl-stick-r"
          ref={stickBase}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("pressed");
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // raro, segue sem capture
            }
            stickPointerId.current = e.pointerId;
            focusPlayer(targetRef.current);
            updateStick(e.clientX, e.clientY, !!stick.fireOnHold, true);
          }}
          onPointerMove={(e) => {
            if (stickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            updateStick(e.clientX, e.clientY, !!stick.fireOnHold, false);
          }}
          onPointerUp={(e) => {
            if (stickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            e.currentTarget.classList.remove("pressed");
            stickPointerId.current = null;
            resetStick(!!stick.fireOnHold);
          }}
          onPointerCancel={(e) => {
            e.currentTarget.classList.remove("pressed");
            stickPointerId.current = null;
            resetStick(!!stick.fireOnHold);
          }}
        />
      )}

      {buttons.map((btn) => (
        <ActionButton key={btn.id} id={btn.id} keyValue={btn.key} position={btn.position} targetRef={targetRef} />
      ))}
    </div>
  );
}
