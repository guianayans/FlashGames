import { useCallback, useRef } from "react";
import type { ControlsConfig, DpadConfig } from "../types";

interface Props {
  controls: ControlsConfig;
  /** ref pro elemento <ruffle-player> (nao o wrapper) — é nele que o Ruffle escuta teclado/pointer */
  targetRef: React.RefObject<HTMLElement>;
  /** "overlay" (padrao): botoes flutuam por cima do jogo. "deck": fluxo normal, pra um layout tipo gamepad abaixo do jogo */
  layout?: "overlay" | "deck";
}

const CODE_MAP: Record<string, string> = {
  w: "KeyW",
  a: "KeyA",
  s: "KeyS",
  d: "KeyD",
  r: "KeyR",
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

  const release = useCallback(
    (dir: string, key?: string) => {
      if (!key) return;
      if (!activeDirs.current.has(dir)) return;
      activeDirs.current.delete(dir);
      dispatchKey("keyup", key);
    },
    []
  );

  return { press, release };
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

  const dir = (name: "up" | "down" | "left" | "right", key: string | undefined, label: string, extraClass: string) => (
    <button
      className={`dpad-btn ${extraClass}`}
      onTouchStart={(e) => {
        e.preventDefault();
        press(name, key);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        release(name, key);
      }}
      onTouchCancel={(e) => {
        e.preventDefault();
        release(name, key);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className={className}>
      {dir("up", config.up, "▲", "dpad-up")}
      {dir("left", config.left, "◀", "dpad-left")}
      {dir("right", config.right, "▶", "dpad-right")}
      {dir("down", config.down, "▼", "dpad-down")}
    </div>
  );
}

export default function TouchControls({ controls, targetRef, layout = "overlay" }: Props) {
  const joystickBase = useRef<HTMLDivElement | null>(null);
  const joystickKnob = useRef<HTMLDivElement | null>(null);
  const joystickPointerId = useRef<number | null>(null);

  const onButtonStart = useCallback(
    (key: string) => (e: React.TouchEvent | React.PointerEvent) => {
      e.preventDefault();
      focusPlayer(targetRef.current);
      dispatchKey("keydown", key);
    },
    [targetRef]
  );

  const onButtonEnd = useCallback((key: string) => (e: React.TouchEvent | React.PointerEvent) => {
    e.preventDefault();
    dispatchKey("keyup", key);
  }, []);

  const updateJoystick = useCallback(
    (clientX: number, clientY: number, fireOnHold: boolean, isStart: boolean) => {
      const base = joystickBase.current;
      const knob = joystickKnob.current;
      const canvas = getCanvas(targetRef.current);
      if (!base || !knob || !canvas) return;

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
      knob.style.transform = `translate(${dx}px, ${dy}px)`;

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

  const resetJoystick = useCallback(
    (fireOnHold: boolean) => {
      const knob = joystickKnob.current;
      const canvas = getCanvas(targetRef.current);
      if (knob) knob.style.transform = "translate(0px, 0px)";
      if (canvas && fireOnHold) {
        const r = canvas.getBoundingClientRect();
        dispatchPointer(canvas, "pointerup", r.left + r.width / 2, r.top + r.height / 2, false);
      }
    },
    [targetRef]
  );

  const dpad = controls.dpad;
  const dpad2 = controls.dpad2;
  const joystick = controls.aimJoystick;
  const buttons = controls.buttons || [];

  return (
    <div className={`touch-controls layout-${layout}`}>
      {dpad && <Dpad config={dpad} className="touch-dpad" targetRef={targetRef} />}
      {dpad2 && <Dpad config={dpad2} className="touch-dpad touch-dpad2" targetRef={targetRef} />}

      {joystick && (
        <div
          className="touch-joystick"
          ref={joystickBase}
          onPointerDown={(e) => {
            e.preventDefault();
            try {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              // segue sem capture (raro, mas nao pode travar o resto do handler)
            }
            joystickPointerId.current = e.pointerId;
            focusPlayer(targetRef.current);
            updateJoystick(e.clientX, e.clientY, !!joystick.fireOnHold, true);
          }}
          onPointerMove={(e) => {
            if (joystickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            updateJoystick(e.clientX, e.clientY, !!joystick.fireOnHold, false);
          }}
          onPointerUp={(e) => {
            if (joystickPointerId.current !== e.pointerId) return;
            e.preventDefault();
            joystickPointerId.current = null;
            resetJoystick(!!joystick.fireOnHold);
          }}
          onPointerCancel={() => {
            joystickPointerId.current = null;
            resetJoystick(!!joystick.fireOnHold);
          }}
        >
          <div className="touch-joystick-knob" ref={joystickKnob} />
          {joystick.label && <span className="touch-joystick-label">{joystick.label}</span>}
        </div>
      )}

      {buttons.map((btn) => (
        <button
          key={btn.id}
          className={`touch-action-btn pos-${btn.position}`}
          onTouchStart={onButtonStart(btn.key)}
          onTouchEnd={onButtonEnd(btn.key)}
          onTouchCancel={onButtonEnd(btn.key)}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
