// Log de diagnostico temporario pros controles de toque — mostrado num painel
// na propria tela (ver DebugPanel.tsx) pra dar pra ver o que ta acontecendo
// direto no aparelho real, sem precisar de console remoto.
type Listener = (lines: string[]) => void;

const lines: string[] = [];
const listeners = new Set<Listener>();
let counter = 0;

export function dlog(msg: string) {
  counter += 1;
  const time = new Date().toISOString().slice(11, 23);
  lines.push(`${counter.toString().padStart(3, "0")} ${time} ${msg}`);
  if (lines.length > 60) lines.shift();
  const snapshot = [...lines];
  listeners.forEach((l) => l(snapshot));
}

export function subscribeDebugLog(fn: Listener): () => void {
  listeners.add(fn);
  fn([...lines]);
  return () => {
    listeners.delete(fn);
  };
}

export function getDebugLogText(): string {
  return lines.join("\n");
}

// Hook sem UI pra inspecionar o log via devtools/scripts externos (ex.:
// `window.__flashgamesDebugLog()` num teste automatizado) sem precisar
// renderizar o DebugPanel na tela — o painel visual cobria os controles
// de toque inferiores (analogico, FN/SELECT/START) com pointer-events:auto
// por cima deles, "engolindo" o toque antes que chegasse no controle.
if (typeof window !== "undefined") {
  (window as unknown as { __flashgamesDebugLog?: () => string }).__flashgamesDebugLog = getDebugLogText;
}
