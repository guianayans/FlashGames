import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Controle remoto via QR code (celular vira controle) — a conexao em si
// (WebSocket, pareamento, status, ate' 4 jogadores) mora AQUI, num
// Provider montado acima do router (ver main.tsx), pra sobreviver a troca
// de pagina (Biblioteca -> Player e vice-versa), a um refresh de pagina
// inteiro, e ate' a pagina inteira sendo FECHADA e reaberta numa aba nova
// (ver localStorage abaixo — nao sessionStorage, que e' por ABA: fechar a
// aba e abrir outra perderia o token mesmo com o celular ainda
// conectado). Cada pagina so' REGISTRA um handler
// (ver subscribe) pra decidir o que fazer com a mensagem que chega — a
// Biblioteca navega a grade (moveFocus/confirmFocused, ignora "player" —
// nao tem conceito de jogador na tela de biblioteca), o Player manda pro
// nostalgist.pressDown/pressUp(button, player) — sem duplicar a conexao.
//
// Multiplayer (ate' 4 no total, misturando controle fisico + celular): UM
// so' QR/token, varios celulares escaneiam o MESMO codigo (like Jackbox) —
// cada um manda um "clientId" proprio (gerado no celular, guardado no
// localStorage dele) que sobrevive a reconexao. Quem decide o numero de
// jogador (P1..P4) e' o DESKTOP (aqui), porque e' o unico lado que sabe
// quantos controles FISICOS ja estao ocupando slot (ver reservePhysicalSlots,
// chamado por useGamepadPlayer em Player.tsx) — o relay (backend) so' roteia.
export type RemoteControlStatus = "idle" | "connecting" | "waiting" | "connected" | "error";
export type RemoteMessage =
  | { button: string; down: boolean; player: number }
  | { type: "exit"; player: number }
  | { type: "toggleSaveMenu"; player: number }
  | { type: "phoneJoined"; clientId: string; player: number }
  | { type: "phoneLeft"; clientId: string }
  | { type: "phoneRejected"; clientId: string };
type RemoteHandler = (msg: RemoteMessage) => void;

export interface RemotePhone {
  clientId: string;
  player: number;
  connected: boolean;
}

interface RemoteControlContextValue {
  status: RemoteControlStatus;
  remoteUrl: string | null;
  phones: RemotePhone[];
  start: () => void;
  stop: () => void;
  subscribe: (handler: RemoteHandler) => () => void;
  reservePhysicalSlots: (taken: Set<number>) => void;
}

const RemoteControlContext = createContext<RemoteControlContextValue | null>(null);

const STORAGE_KEY = "flashgames_remote_session_v1";
const MAX_PLAYERS = 4;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const RECONNECT_GIVE_UP_AFTER = 6; // tentativas seguidas SEM nunca abrir (token morto) antes de desistir

type StoredSession = { token: string; path: string; phoneSlots: [string, number][] };

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d?.token !== "string" || typeof d?.path !== "string" || !Array.isArray(d?.phoneSlots)) return null;
    return d;
  } catch {
    return null;
  }
}

export function RemoteControlProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RemoteControlStatus>("idle");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [phones, setPhones] = useState<RemotePhone[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const stoppedRef = useRef(true); // true = usuario pediu stop/nunca iniciou — nao tenta reconectar sozinho
  const everOpenedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phoneSlotsRef = useRef<Map<string, number>>(new Map()); // clientId -> player (estavel, nao libera ao desconectar)
  const connectedPhonesRef = useRef<Set<string>>(new Set()); // clientIds com WS vivo AGORA
  const reservedPhysicalRef = useRef<Set<number>>(new Set()); // slots ocupados por controle fisico (ver reservePhysicalSlots)

  // So' a pagina montada NO MOMENTO registra um handler — trocar de
  // pagina troca quem recebe as mensagens seguintes, sem precisar
  // reconectar nada.
  const handlerRef = useRef<RemoteHandler | null>(null);

  function persistSession() {
    if (!tokenRef.current || !pathRef.current) return;
    try {
      const data: StoredSession = {
        token: tokenRef.current,
        path: pathRef.current,
        phoneSlots: Array.from(phoneSlotsRef.current.entries()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // storage indisponivel (modo privado etc) — reconexao apos refresh/aba nova so' nao funciona, sem quebrar nada
    }
  }
  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ver persistSession
    }
  }

  // So' idle e' "travado" (significa: sessao explicitamente parada, ver
  // stop() — nao deixa uma mensagem atrasada da conexao antiga ressuscitar
  // o status depois). "connecting"/"error" PRECISAM poder virar
  // "waiting"/"connected" daqui — e' exatamente o que tira a UI do
  // "Gerando codigo..."/"Erro" assim que o WS abre de verdade (ver
  // ws.open) ou reconecta com sucesso.
  function syncPhonesState() {
    const list: RemotePhone[] = Array.from(phoneSlotsRef.current.entries())
      .map(([clientId, player]) => ({ clientId, player, connected: connectedPhonesRef.current.has(clientId) }))
      .sort((a, b) => a.player - b.player);
    setPhones(list);
    setStatus((prev) => (prev === "idle" ? prev : connectedPhonesRef.current.size > 0 ? "connected" : "waiting"));
  }

  // Menor numero de 1..4 nao ocupado por controle fisico nem por outro
  // celular ja' atribuido. null = sala cheia (os 4 slots ja tem dono).
  function assignPlayerSlot(clientId: string): number | null {
    const existing = phoneSlotsRef.current.get(clientId);
    if (existing) return existing;
    const used = new Set<number>(reservedPhysicalRef.current);
    phoneSlotsRef.current.forEach((n) => used.add(n));
    for (let n = 1; n <= MAX_PLAYERS; n++) {
      if (!used.has(n)) {
        phoneSlotsRef.current.set(clientId, n);
        return n;
      }
    }
    return null;
  }

  function sendRaw(msg: unknown) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // conexao caindo bem na hora do send — o proprio close cuida do resto
      }
    }
  }

  function handlePhoneArrival(clientId: string) {
    const player = assignPlayerSlot(clientId);
    if (player === null) {
      sendRaw({ to: clientId, type: "roomFull" });
      handlerRef.current?.({ type: "phoneRejected", clientId });
      return;
    }
    connectedPhonesRef.current.add(clientId);
    sendRaw({ to: clientId, type: "assignSlot", player });
    persistSession();
    syncPhonesState();
    handlerRef.current?.({ type: "phoneJoined", clientId, player });
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function scheduleReconnect() {
    if (stoppedRef.current) return;
    if (!everOpenedRef.current && reconnectAttemptsRef.current >= RECONNECT_GIVE_UP_AFTER) {
      // Token nunca chegou a abrir (expirado/invalido) apos varias
      // tentativas — desiste e limpa, senao fica tentando pra sempre.
      stoppedRef.current = true;
      tokenRef.current = null;
      pathRef.current = null;
      clearSession();
      setStatus("idle");
      setRemoteUrl(null);
      setPhones([]);
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, RECONNECT_MAX_MS);
    reconnectAttemptsRef.current += 1;
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      if (!stoppedRef.current && tokenRef.current) connectWs(tokenRef.current, pathRef.current!);
    }, delay);
  }

  function connectWs(token: string, path: string) {
    clearReconnectTimer();
    wsRef.current?.close();
    stoppedRef.current = false;
    tokenRef.current = token;
    pathRef.current = path;
    setRemoteUrl(`${window.location.origin}${path}`);
    setStatus((prev) => (prev === "idle" || prev === "error" ? "connecting" : prev));

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/remote?token=${encodeURIComponent(token)}&role=desktop`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      everOpenedRef.current = true;
      reconnectAttemptsRef.current = 0;
      syncPhonesState();
    });
    ws.addEventListener("error", () => {
      // 'close' sempre segue 'error' num WebSocket — deixa a reconexao pro handler de close
    });
    ws.addEventListener("close", () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      connectedPhonesRef.current.clear();
      if (stoppedRef.current) {
        setStatus("idle");
        setRemoteUrl(null);
        setPhones([]);
        return;
      }
      // syncPhonesState primeiro (atualiza a lista com todo mundo
      // desconectado), "error" por ULTIMO pra ser o status que realmente
      // fica (syncPhonesState tambem mexe no status — ver comentario la).
      syncPhonesState();
      setStatus("error");
      scheduleReconnect();
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

      if (d.type === "phone-list" && Array.isArray(d.clientIds)) {
        // Desktop acabou de (re)conectar — celulares que ja' estavam
        // conectados antes (ex.: so' o desktop deu refresh) reaparecem
        // aqui de uma vez, sem precisar de um novo "phone-joined" deles.
        for (const clientId of d.clientIds) {
          if (typeof clientId === "string") handlePhoneArrival(clientId);
        }
        return;
      }
      if (d.type === "phone-joined" && typeof d.clientId === "string") {
        handlePhoneArrival(d.clientId);
        return;
      }
      if (d.type === "phone-left" && typeof d.clientId === "string") {
        connectedPhonesRef.current.delete(d.clientId);
        syncPhonesState();
        handlerRef.current?.({ type: "phoneLeft", clientId: d.clientId });
        return;
      }
      if (d.type === "exit" || d.type === "toggleSaveMenu") {
        const clientId = typeof d.clientId === "string" ? d.clientId : null;
        const player = clientId ? phoneSlotsRef.current.get(clientId) : undefined;
        if (!player) return; // mensagem de um celular ainda sem slot atribuido (corrida rara) — ignora
        handlerRef.current?.({ type: d.type, player } as RemoteMessage);
        return;
      }
      if (typeof d.button === "string" && typeof d.down === "boolean") {
        const clientId = typeof d.clientId === "string" ? d.clientId : null;
        const player = clientId ? phoneSlotsRef.current.get(clientId) : undefined;
        if (!player) return;
        handlerRef.current?.({ button: d.button, down: d.down, player });
      }
    });
  }

  function stop() {
    stoppedRef.current = true;
    clearReconnectTimer();
    wsRef.current?.close();
    wsRef.current = null;
    tokenRef.current = null;
    pathRef.current = null;
    phoneSlotsRef.current.clear();
    connectedPhonesRef.current.clear();
    clearSession();
    setStatus("idle");
    setRemoteUrl(null);
    setPhones([]);
  }

  async function start() {
    stop();
    stoppedRef.current = false;
    everOpenedRef.current = false;
    reconnectAttemptsRef.current = 0;
    setStatus("connecting");
    try {
      const res = await fetch("/api/remote/pair", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("pair_failed");
      const data: { token: string; path: string } = await res.json();
      persistTokenOnly(data.token, data.path);
      connectWs(data.token, data.path);
    } catch {
      stoppedRef.current = true;
      setStatus("error");
    }
  }
  function persistTokenOnly(token: string, path: string) {
    tokenRef.current = token;
    pathRef.current = path;
    persistSession();
  }

  function subscribe(handler: RemoteHandler) {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }

  function reservePhysicalSlots(taken: Set<number>) {
    reservedPhysicalRef.current = taken;
  }

  // Restaura uma sessao ainda viva depois de um F5/refresh (o relay
  // mantem o pareamento de pe' enquanto QUALQUER lado — desktop ou algum
  // celular — continuar conectado, ver remoteRelay.js) — reconecta direto
  // no token salvo, sem passar por /pair de novo.
  useEffect(() => {
    const saved = loadStoredSession();
    if (saved) {
      phoneSlotsRef.current = new Map(saved.phoneSlots);
      everOpenedRef.current = false;
      reconnectAttemptsRef.current = 0;
      connectWs(saved.token, saved.path);
    }
    return () => {
      clearReconnectTimer();
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RemoteControlContext.Provider value={{ status, remoteUrl, phones, start, stop, subscribe, reservePhysicalSlots }}>
      {children}
    </RemoteControlContext.Provider>
  );
}

export function useRemoteControlContext() {
  const ctx = useContext(RemoteControlContext);
  if (!ctx) throw new Error("useRemoteControlContext must be used inside RemoteControlProvider");
  return ctx;
}
