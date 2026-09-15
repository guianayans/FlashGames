import { useCallback, useRef } from "react";
import type { ControlsConfig } from "../types";

interface Props {
  controls: ControlsConfig;
  targetRef: React.RefObject<HTMLElement>;
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

function dispatchKey(type: "keydown" | "keyup", key: string) {
  const ev = new KeyboardEvent(type, {
    key,
    code: codeFor(key),
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(ev);
  window.dispatchEvent(ev);
}

function dispatchMouse(target: HTMLElement, type: string, clientX: number, clientY: number, pressed: boolean) {
  const ev = new MouseEvent(type, {
    clientX,
    clientY,
    button: 0,
    buttons: pressed ? 1 : 0,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  target.dispatchEvent(ev);
  document.dispatchEvent(ev);
}

export default function TouchControls({ controls, targetRef }: Props) {
  const activeDirs = useRef<Set<string>>(new Set());
  const joystickBase = useRef<HTMLDivElement | null>(null);
  const joystickKnob = useRef<HTMLDivElement | null>(null);
  const joystickPointerId = useRef<number | null>(null);

  const pressDpad = useCallback(
    (dir: string, key?: string) => {
      if (!key) return;
      if (activeDirs.current.has(dir)) return;
      activeDirs.current.add(dir);
      dispatchKey("keydown", key);
    },
    []
  );

  const releaseDpad = useCallback((dir: string, key?: string) => {
    if (!key) return;
    if (!activeDirs.current.has(dir)) return;
    activeDirs.current.delete(dir);
    dispatchKey("keyup", key);
  }, []);

  const onButtonStart = useCallback((key: string) => (e: React.TouchEvent | React.PointerEvent) => {
    e.preventDefault();
    dispatchKey("keydown", key);
  }, []);

  const onButtonEnd = useCallback((key: string) => (e: React.TouchEvent | React.PointerEvent) => {
    e.preventDefault();
    dispatchKey("keyup", key);
  }, []);

  const updateJoystick = useCallback(
    (clientX: number, clientY: number, fireOnHold: boolean, isStart: boolean) => {
      const base = joystickBase.current;
      const knob = joystickKnob.current;
      const target = targetRef.current;
      if (!base || !knob || !target) return;

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

      const targetRect = target.getBoundingClientRect();
      const gameCenterX = targetRect.left + targetRect.width / 2;
      const gameCenterY = targetRect.top + targetRect.height / 2;
      const aimX = gameCenterX + (dx / uiRadius) * (targetRect.width / 2) * Math.max(intensity, 0.35);
      const aimY = gameCenterY + (dy / uiRadius) * (targetRect.height / 2) * Math.max(intensity, 0.35);

      dispatchMouse(target, "mousemove", aimX, aimY, true);
      if (isStart && fireOnHold) {
        dispatchMouse(target, "mousedown", aimX, aimY, true);
      }
    },
    [targetRef]
  );

  const resetJoystick = useCallback(
    (fireOnHold: boolean) => {
      const knob = joystickKnob.current;
      const target = targetRef.current;
      if (knob) knob.style.transform = "translate(0px, 0px)";
      if (target && fireOnHold) {
        const r = target.getBoundingClientRect();
        dispatchMouse(target, "mouseup", r.left + r.width / 2, r.top + r.height / 2, false);
      }
    },
    [targetRef]
  );

  const dpad = controls.dpad;
  const joystick = controls.aimJoystick;
  const buttons = controls.buttons || [];

  return (
    <div className="touch-controls">
      {dpad && (
        <div className="touch-dpad">
          <button
            className="dpad-btn dpad-up"
            onTouchStart={(e) => {
              e.preventDefault();
              pressDpad("up", dpad.up);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              releaseDpad("up", dpad.up);
            }}
          >
            ▲
          </button>
          <button
            className="dpad-btn dpad-left"
            onTouchStart={(e) => {
              e.preventDefault();
              pressDpad("left", dpad.left);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              releaseDpad("left", dpad.left);
            }}
          >
            ◀
          </button>
          <button
            className="dpad-btn dpad-right"
            onTouchStart={(e) => {
              e.preventDefault();
              pressDpad("right", dpad.right);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              releaseDpad("right", dpad.right);
            }}
          >
            ▶
          </button>
          <button
            className="dpad-btn dpad-down"
            onTouchStart={(e) => {
              e.preventDefault();
              pressDpad("down", dpad.down);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              releaseDpad("down", dpad.down);
            }}
          >
            ▼
          </button>
        </div>
      )}

      {joystick && (
        <div
          className="touch-joystick"
          ref={joystickBase}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            joystickPointerId.current = e.pointerId;
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
