import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Controle remoto via QR code (celular vira controle) — a conexao em si
// (WebSocket, pareamento, status) mora AQUI, num Provider montado acima
// do router (ver main.tsx), pra sobreviver a troca de pagina (Biblioteca
// -> Player e vice-versa). Cada pagina so' REGISTRA um handler (ver
// subscribe) pra decidir o que fazer com a mensagem que chega — a
// Biblioteca navega a grade (moveFocus/confirmFocused), o Player manda
// pro nostalgist.pressDown/pressUp — sem duplicar a conexao em si.
export type RemoteControlStatus = "idle" | "connecting" | "waiting" | "connected" | "error";
export type RemoteMessage = { button: string; down: boolean } | { type: "exit" } | { type: "toggleSaveMenu" };
type RemoteHandler = (msg: RemoteMessage) => void;

interface RemoteControlContextValue {
  status: RemoteControlStatus;
  remoteUrl: string | null;
  start: () => void;
  stop: () => void;
  subscribe: (handler: RemoteHandler) => () => void;
}

const RemoteControlContext = createContext<RemoteControlContextValue | null>(null);

export function RemoteControlProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RemoteControlStatus>("idle");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // So' a pagina montada NO MOMENTO registra um handler — trocar de
  // pagina troca quem recebe as mensagens seguintes, sem precisar
  // reconectar nada.
  const handlerRef = useRef<RemoteHandler | null>(null);

  function stop() {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    setRemoteUrl(null);
  }

  async function start() {
    stop();
    setStatus("connecting");
    try {
      const res = await fetch("/api/remote/pair", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("pair_failed");
      const data: { token: string; path: string } = await res.json();
      setRemoteUrl(`${window.location.origin}${data.path}`);

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws/remote?token=${encodeURIComponent(data.token)}&role=desktop`
      );
      wsRef.current = ws;

      ws.addEventListener("open", () => setStatus("waiting"));
      ws.addEventListener("error", () => setStatus("error"));
      ws.addEventListener("close", () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setStatus("idle");
        setRemoteUrl(null);
      });
      ws.addEventListener("message", (e) => {
        let msg: unknown;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        const d = msg as Record<string, unknown>;

        if (d.type === "paired") {
          setStatus("connected");
          return;
        }
        if (d.type === "peer-disconnected") {
          setStatus("waiting");
          return;
        }
        if (d.type === "exit" || d.type === "toggleSaveMenu") {
          handlerRef.current?.(d as RemoteMessage);
          return;
        }
        if (typeof d.button === "string" && typeof d.down === "boolean") {
          handlerRef.current?.({ button: d.button, down: d.down });
        }
      });
    } catch {
      setStatus("error");
    }
  }

  function subscribe(handler: RemoteHandler) {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return (
    <RemoteControlContext.Provider value={{ status, remoteUrl, start, stop, subscribe }}>
      {children}
    </RemoteControlContext.Provider>
  );
}

export function useRemoteControlContext() {
  const ctx = useContext(RemoteControlContext);
  if (!ctx) throw new Error("useRemoteControlContext must be used inside RemoteControlProvider");
  return ctx;
}
