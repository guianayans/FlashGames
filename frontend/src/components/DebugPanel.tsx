import { useEffect, useRef, useState } from "react";
import { subscribeDebugLog, getDebugLogText } from "../debugLog";

/**
 * Painel de diagnostico TEMPORARIO — mostra em tempo real o que os
 * controles de toque estao detectando/disparando, direto na tela do
 * aparelho. So pra debugar o problema de toque em dispositivo real; remover
 * depois que resolver.
 */
export default function DebugPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeDebugLog(setLines), []);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getDebugLogText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — alguns navegadores exigem gesto direto; o botao ja e um.
    }
  };

  if (!open) {
    return (
      <button className="debug-fab" onClick={() => setOpen(true)}>
        🐞 {lines.length}
      </button>
    );
  }

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <strong>DEBUG toque</strong>
        <div className="debug-panel-actions">
          <button onClick={copy}>{copied ? "copiado!" : "copiar"}</button>
          <button onClick={() => setOpen(false)}>fechar</button>
        </div>
      </div>
      <div className="debug-panel-body" ref={boxRef}>
        {lines.length === 0 ? (
          <div className="debug-line">(sem eventos ainda — toque num botao)</div>
        ) : (
          lines.map((l, i) => (
            <div className="debug-line" key={i}>
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
