import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, SAVE_STATE_SLOTS } from "../api";
import type { SaveStateSlot } from "../api";
import { systemMeta } from "../categories";
import type { GameDetail, SystemLauncher } from "../types";

// Proporcao nativa de cada console — usada pra dimensionar o palco do jogo
// (ver DesktopPlayer) sem esticar/distorcer a imagem. object-fit:contain
// no canvas ja protege contra distorcao de qualquer jeito, mas acertar a
// proporcao aqui evita barras pretas desnecessarias.
const SYSTEM_ASPECT_RATIO: Record<SystemLauncher, number> = {
  snes: 4 / 3,
  nes: 4 / 3,
  megadrive: 4 / 3,
  gba: 3 / 2,
  psx: 4 / 3,
};
import { loadEmulator } from "../loadEmulatorScript";
import type { Nostalgist } from "nostalgist";

// Janela do GameScreen.html com a API que ele expoe (ver
// frontend/public/GameScreen.html).
interface GameScreenWindow extends Window {
  GameController?: { setGame(src: string, slug?: string): void };
}

function detectPointerCoarse(): boolean {
  if (typeof window === "undefined") return false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return window.matchMedia("(pointer: coarse)").matches || shortSide <= 560;
}

// "Voltar" via navigate(-1) em vez de Link to="/" — assim o navegador
// restaura a URL exata de onde o usuario veio (com ?q=...&system=...&page=
// que a Library grava nos searchParams), voltando pra pesquisa/filtro/
// pagina/scroll de onde ele tinha parado, sem recarregar nada. location.key
// === "default" quer dizer que nao tem historico dentro do SPA (link
// direto/refresh na propria pagina do jogo) — ai navigate(-1) sairia do
// app, entao cai pra "/" mesmo (sem estado pra restaurar de qualquer jeito).
function useLibraryBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/");
  };
}

export default function Player() {
  const { slug = "" } = useParams();

  // Celular/touch: o GameScreen.html (controller com shell de portatil,
  // d-pad, analogicos e botoes) assume a tela inteira e cuida de tudo,
  // portrait e landscape (inclusive o botao de fullscreen nativo dele). O
  // Nostalgist.js roda dentro do <iframe id="game-iframe"> DELE, carregado
  // via GameController.setGame() — ver frontend/src/game-wrapper.ts.
  const [pointerCoarse, setPointerCoarse] = useState(detectPointerCoarse);

  useEffect(() => {
    // So escuta mudanca de capacidade de ponteiro (ex.: mouse/teclado
    // bluetooth conectado/desconectado num celular) — NAO reage a
    // "resize" do viewport (ver historico no memory de touch controls: isso
    // causava um "glitch" que desmontava o jogo no meio da sessao).
    const mqCoarse = window.matchMedia("(pointer: coarse)");
    const sync = () => {
      if (mqCoarse.matches) setPointerCoarse(true);
    };
    mqCoarse.addEventListener("change", sync);
    return () => mqCoarse.removeEventListener("change", sync);
  }, []);

  if (pointerCoarse) return <MobilePlayer slug={slug} />;
  return <DesktopPlayer slug={slug} />;
}

// Quanto tempo o botao de voltar fica visivel depois de revelado pelo
// swipe da borda, se o jogador nao tocar nele.
const BACK_BUTTON_AUTO_HIDE_MS = 3000;

function MobilePlayer({ slug }: { slug: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const goBack = useLibraryBack();

  // Escondido por padrao — so aparece quando o GameScreen.html (ou o
  // game-wrapper.ts dele, em paisagem) avisa via postMessage que detectou
  // um swipe partindo da borda esquerda (ver GameScreen.html, secao
  // "SWIPE DA BORDA"). Isso substitui o gesto nativo de "voltar" do iOS,
  // que antes tirava o jogador do jogo sem querer — agora o gesto so
  // revela o botao, e sair exige um toque nele.
  const [showBack, setShowBack] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin) return;
      const type = (e.data as { type?: string } | null)?.type;
      if (type === "gc:revealBack") {
        setShowBack(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setShowBack(false), BACK_BUTTON_AUTO_HIDE_MS);
        return;
      }
      // Segurar L2 no controle (ver GameScreen.html, dialogo "Sair do
      // jogo?") — o usuario ja confirmou LA dentro, sai direto, sem
      // precisar revelar/tocar o botao de novo.
      if (type === "gc:exitToLibrary") {
        goBack();
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [goBack]);

  const handleLoad = () => {
    const win = frameRef.current?.contentWindow as GameScreenWindow | null | undefined;
    win?.GameController?.setGame(`/game-wrapper.html?slug=${encodeURIComponent(slug)}`, slug);
  };

  return (
    <div className="mobile-player">
      <button
        type="button"
        onClick={goBack}
        className={`mobile-player-back${showBack ? " visible" : ""}`}
        aria-label="Voltar pra biblioteca"
      >
        ←
      </button>
      <iframe
        ref={frameRef}
        src="/GameScreen.html"
        className="mobile-player-frame"
        title="Game Controller"
        onLoad={handleLoad}
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </div>
  );
}

// Mapeamento por POSICAO do botao na carcaça (mesmo criterio do
// GameScreen.html, ver secao "CONTROLE FISICO" la) — o botao de baixo do
// controle sempre vira B, o da direita vira A, etc, independente do
// controle rotular isso como "A/B/X/Y" (Xbox) ou "Cross/Circle/Square/
// Triangle" (PlayStation): o SNES tem B embaixo e A na direita.
const GAMEPAD_BUTTON_MAP: Record<number, string> = {
  0: "b", // baixo (Xbox A / PS Cross)
  1: "a", // direita (Xbox B / PS Circle)
  2: "y", // esquerda (Xbox X / PS Square)
  3: "x", // cima (Xbox Y / PS Triangle)
  4: "l", // L1/LB
  5: "r", // R1/RB
  9: "start", // Start/Options/Menu
  // 8 (Select/Share/Back) de proposito NAO entra aqui — abre o menu de
  // save state em vez de ir pro jogo, ver useGamepadPlayer mais abaixo.
};
const GAMEPAD_DPAD_MAP: Record<number, string> = { 12: "up", 13: "down", 14: "left", 15: "right" };
const GAMEPAD_STICK_DEAD = 0.5;

type GamepadSlot = {
  player: 1 | 2;
  gpIndex: number | null;
  heldButtons: Record<number, boolean>;
  heldDirs: Record<string, boolean>;
};

// Detecta ate 2 gamepads (pro badge no topo) E manda o input pro jogo via
// nostalgist.pressDown/pressUp(button, player). Testado ao vivo: o
// Nostalgist.js NAO pega o gamepad sozinho neste embed — por isso manda o
// comando na mao, igual o GameScreen.html faz pro player mobile. O
// PRIMEIRO controle detectado vira P1, o segundo vira P2 — com 1 controle
// so, nunca se manda input de P2 (nao tem slot 2 ocupado pra isso).
function useGamepadPlayer(
  nostalgistRef: React.RefObject<Nostalgist | null>,
  onToggleFullscreen: () => void,
  onOpenSaveMenu: () => void
): (string | null)[] {
  const [names, setNames] = useState<(string | null)[]>([null, null]);
  // Ref pra sempre chamar a versao mais atual sem precisar recriar o
  // efeito (que reconectaria os listeners de gamepad) toda renderizacao.
  const onToggleFullscreenRef = useRef(onToggleFullscreen);
  onToggleFullscreenRef.current = onToggleFullscreen;
  const onOpenSaveMenuRef = useRef(onOpenSaveMenu);
  onOpenSaveMenuRef.current = onOpenSaveMenu;

  useEffect(() => {
    const slots: GamepadSlot[] = [
      { player: 1, gpIndex: null, heldButtons: {}, heldDirs: { up: false, down: false, left: false, right: false } },
      { player: 2, gpIndex: null, heldButtons: {}, heldDirs: { up: false, down: false, left: false, right: false } },
    ];
    let raf = 0;

    function press(slot: GamepadSlot, button: string, down: boolean) {
      const inst = nostalgistRef.current;
      if (!inst) return;
      if (down) inst.pressDown({ button, player: slot.player });
      else inst.pressUp({ button, player: slot.player });
    }

    function setName(player: 1 | 2, name: string | null) {
      setNames((prev) => {
        const next = [...prev] as (string | null)[];
        next[player - 1] = name;
        return next;
      });
    }

    function slotForIndex(gpIndex: number) {
      return slots.find((s) => s.gpIndex === gpIndex) ?? null;
    }
    function assignSlot(gp: Gamepad | null) {
      if (!gp || slotForIndex(gp.index)) return;
      const slot = slots.find((s) => s.gpIndex === null);
      if (!slot) return; // ja tem 2 controles ocupados
      slot.gpIndex = gp.index;
      setName(slot.player, gp.id || "Controle");
    }

    function clearSlot(slot: GamepadSlot) {
      Object.keys(slot.heldButtons).forEach((idx) => {
        if (slot.heldButtons[Number(idx)]) press(slot, GAMEPAD_BUTTON_MAP[Number(idx)], false);
      });
      slot.heldButtons = {};
      Object.keys(slot.heldDirs).forEach((d) => {
        if (slot.heldDirs[d]) press(slot, d, false);
        slot.heldDirs[d] = false;
      });
    }

    function onConnected(e: GamepadEvent) {
      assignSlot(e.gamepad);
    }
    function onDisconnected(e: GamepadEvent) {
      const slot = slotForIndex(e.gamepad.index);
      if (!slot) return;
      slot.gpIndex = null;
      setName(slot.player, null);
      clearSlot(slot);
    }
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);

    // Segurar R2 (botao 7 — gatilho direito) por R2_HOLD_MS liga/desliga
    // tela cheia, so no controle do P1. Botao 7 nao entra no
    // GAMEPAD_BUTTON_MAP (nenhum console suportado usa gatilho analogico
    // separado), entao fica livre pra isso sem mandar nada indevido pro
    // jogo — mesmo criterio do L2 no GameScreen.html (ver "Sair do jogo?").
    const R2_HOLD_MS = 700;
    let r2HoldStart: number | null = null;
    let r2HoldFired = false;
    let selectWasPressed = false;

    function poll() {
      const now = performance.now();
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      // Alguns navegadores nao disparam 'gamepadconnected' se o controle
      // ja estava pareado antes da pagina carregar.
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) assignSlot(pads[i]);
      }
      for (const slot of slots) {
        if (slot.gpIndex === null) continue;
        const gp = pads[slot.gpIndex];
        if (!gp) continue;
        if (slot.player === 1) {
          const r2 = gp.buttons[7];
          const r2Pressed = !!(r2 && (r2.pressed || r2.value > 0.5));
          if (r2Pressed) {
            if (r2HoldStart === null) r2HoldStart = now;
            else if (!r2HoldFired && now - r2HoldStart >= R2_HOLD_MS) {
              r2HoldFired = true;
              onToggleFullscreenRef.current();
            }
          } else {
            r2HoldStart = null;
            r2HoldFired = false;
          }

          // Select (8) abre/fecha o menu de save state — um toque simples
          // (sem segurar, diferente do R2 de cima), ja que ele nao faz
          // mais nada em jogo (tirado do GAMEPAD_BUTTON_MAP).
          const selectPressed = !!gp.buttons[8]?.pressed;
          if (selectPressed && !selectWasPressed) onOpenSaveMenuRef.current();
          selectWasPressed = selectPressed;
        }
        for (const idxStr of Object.keys(GAMEPAD_BUTTON_MAP)) {
          const idx = Number(idxStr);
          const pressed = !!gp.buttons[idx]?.pressed;
          if (pressed !== !!slot.heldButtons[idx]) {
            slot.heldButtons[idx] = pressed;
            press(slot, GAMEPAD_BUTTON_MAP[idx], pressed);
          }
        }
        const activeDirs: Record<string, boolean> = { up: false, down: false, left: false, right: false };
        for (const idxStr of Object.keys(GAMEPAD_DPAD_MAP)) {
          const idx = Number(idxStr);
          if (gp.buttons[idx]?.pressed) activeDirs[GAMEPAD_DPAD_MAP[idx]] = true;
        }
        const [ax, ay] = gp.axes;
        if (typeof ax === "number" && typeof ay === "number") {
          if (ax < -GAMEPAD_STICK_DEAD) activeDirs.left = true;
          if (ax > GAMEPAD_STICK_DEAD) activeDirs.right = true;
          if (ay < -GAMEPAD_STICK_DEAD) activeDirs.up = true;
          if (ay > GAMEPAD_STICK_DEAD) activeDirs.down = true;
        }
        for (const dir of Object.keys(activeDirs)) {
          if (activeDirs[dir] !== slot.heldDirs[dir]) {
            slot.heldDirs[dir] = activeDirs[dir];
            press(slot, dir, activeDirs[dir]);
          }
        }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      cancelAnimationFrame(raf);
    };
  }, [nostalgistRef]);

  return names;
}

// Icone do console (ver frontend/public/images/consoles/) andando pela
// tela de carregamento inteira, ricocheteando nas bordas — tamanho do
// icone e velocidade em JS (nao da pra fazer colisao com o tamanho de
// verdade do container so em CSS), mas o "andar local" (balanco pra
// cima/baixo dos pes, sombra espremendo) continua sendo so CSS
// (.player-loading-icon-img/-icon-shadow, reaproveitados do "pulando" de
// antes). O container mede o proprio tamanho a cada frame (em vez de uma
// vez so) pra se adaptar se a janela/tela cheia mudar de tamanho no meio
// do carregamento.
const WALK_ICON_SIZE = 40; // largura do sprite (bate com o width do CSS)
const WALK_SPRITE_HEIGHT = 56; // altura total incluindo a sombra embaixo (icone 40 + gap 8 + sombra 5)
const WALK_SPEED_PX_S = 70;

function WalkingLoadingIcon({ src }: { src: string }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = areaRef.current;
    const sprite = spriteRef.current;
    if (!area || !sprite) return;

    let raf = 0;
    let last = performance.now();
    const rect0 = area.getBoundingClientRect();
    let x = Math.random() * Math.max(rect0.width - WALK_ICON_SIZE, 1);
    let y = Math.random() * Math.max(rect0.height - WALK_SPRITE_HEIGHT, 1);
    const angle = Math.random() * Math.PI * 2;
    let vx = Math.cos(angle) * WALK_SPEED_PX_S;
    let vy = Math.sin(angle) * WALK_SPEED_PX_S;

    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const rect = area!.getBoundingClientRect();
      const maxX = Math.max(rect.width - WALK_ICON_SIZE, 0);
      const maxY = Math.max(rect.height - WALK_SPRITE_HEIGHT, 0);

      x += vx * dt;
      y += vy * dt;
      if (x <= 0) {
        x = 0;
        vx = Math.abs(vx);
      } else if (x >= maxX) {
        x = maxX;
        vx = -Math.abs(vx);
      }
      if (y <= 0) {
        y = 0;
        vy = Math.abs(vy);
      } else if (y >= maxY) {
        y = maxY;
        vy = -Math.abs(vy);
      }

      sprite!.style.transform = `translate(${x}px, ${y}px) scaleX(${vx < 0 ? -1 : 1})`;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="player-loading-walk-area" ref={areaRef}>
      <div className="player-loading-walk-sprite" ref={spriteRef}>
        <img src={src} alt="" className="player-loading-icon-img" />
        <div className="player-loading-icon-shadow" />
      </div>
    </div>
  );
}

// Formata "2026-09-17 14:34:01" (UTC, formato do datetime('now') do
// SQLite) pro horario local do navegador — sem o "Z" no fim o
// `new Date(...)` do JS interpreta como hora LOCAL em vez de UTC, dando
// hora errada.
function formatSaveStateDate(sqliteUtc: string): string {
  const iso = sqliteUtc.replace(" ", "T") + "Z";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Menu de save state (Select no controle ou F11 no teclado, ver
// DesktopPlayer) — grade de slots com miniatura, salvar/carregar/apagar
// cada um. So mouse+teclado (Escape fecha); quem abrir via controle usa
// o cursor do mouse pra clicar, igual qualquer menu de pausa de jogo de
// PC seria usado.
function SaveStateMenu({
  slug,
  nostalgistRef,
  onClose,
}: {
  slug: string;
  nostalgistRef: React.RefObject<Nostalgist | null>;
  onClose: () => void;
}) {
  const [slots, setSlots] = useState<SaveStateSlot[]>([]);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api.listSaveStates(slug);
      setSlots(res.slots);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar slots");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave(slot: number) {
    const inst = nostalgistRef.current;
    if (!inst) return;
    setBusySlot(slot);
    setError(null);
    try {
      const { state, thumbnail } = await inst.saveState();
      await api.putSaveState(slug, slot, state, thumbnail);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusySlot(null);
    }
  }

  async function handleLoad(slot: number) {
    const inst = nostalgistRef.current;
    if (!inst) return;
    setBusySlot(slot);
    setError(null);
    try {
      const blob = await api.getSaveStateBlob(slug, slot);
      await inst.loadState(blob);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setBusySlot(null);
    }
  }

  async function handleDelete(slot: number) {
    setBusySlot(slot);
    setError(null);
    try {
      await api.deleteSaveState(slug, slot);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao apagar");
    } finally {
      setBusySlot(null);
    }
  }

  const bySlot = new Map(slots.map((s) => [s.slot, s]));

  return (
    <div className="savestate-overlay" onClick={onClose}>
      <div className="savestate-card" onClick={(e) => e.stopPropagation()}>
        <div className="savestate-header">
          <h2>Save state</h2>
          <button type="button" className="savestate-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        {error && <p className="savestate-error">{error}</p>}
        <div className="savestate-grid">
          {Array.from({ length: SAVE_STATE_SLOTS }, (_, i) => i + 1).map((slot) => {
            const data = bySlot.get(slot);
            const busy = busySlot === slot;
            return (
              <div key={slot} className={`savestate-slot${data ? " filled" : ""}`}>
                <div className="savestate-slot-thumb">
                  {data?.thumbnail ? <img src={data.thumbnail} alt="" /> : <span>Vazio</span>}
                </div>
                <div className="savestate-slot-info">
                  <span className="savestate-slot-label">Slot {slot}</span>
                  {data && <span className="savestate-slot-date">{formatSaveStateDate(data.updatedAt)}</span>}
                </div>
                <div className="savestate-slot-actions">
                  <button type="button" disabled={busy} onClick={() => handleSave(slot)}>
                    Salvar
                  </button>
                  {data && (
                    <>
                      <button type="button" disabled={busy} onClick={() => handleLoad(slot)}>
                        Carregar
                      </button>
                      <button type="button" disabled={busy} onClick={() => handleDelete(slot)}>
                        Apagar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DesktopPlayer({ slug }: { slug: string }) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const goBack = useLibraryBack();

  // Tela cheia mantendo a proporcao do jogo (ver CSS .player-stage-
  // wrapper:fullscreen) — o elemento que entra em fullscreen e' o
  // WRAPPER (nao o canvas), que ja tem aspect-ratio/object-fit cuidando
  // de nao esticar a imagem, sobrando barra preta dos dois lados quando a
  // proporcao da tela nao bate com a do console.
  const [isFullscreen, setIsFullscreen] = useState(false);
  function toggleFullscreen() {
    const el = stageWrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen();
    else el.requestFullscreen();
  }
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === stageWrapperRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Progresso de carregamento (0..1) — so PS1 reporta de verdade (ver
  // loadEmulatorScript.ts, prefetchWithProgress); os outros sistemas nunca
  // chamam onProgress, entao a barra so fica visivel enquanto "loading"
  // ainda e' true, sem se preocupar com o numero exato nesses casos (jogo
  // pequeno, carrega rapido demais pra reparar mesmo).
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const loadingIconImage = game ? systemMeta(game.system).iconImage : undefined;

  // Save state — currentSlot e' por sessao de jogo (reseta pra 1 quando
  // troca de jogo), nao fica salvo em lugar nenhum: e' so "qual slot os
  // atalhos rapidos (F2/F4) usam agora". Toast da feedback visual das
  // acoes rapidas (o menu completo, ver SaveStateMenu, ja mostra tudo
  // sozinho).
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [currentSlot, setCurrentSlot] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }

  function openSaveMenu() {
    setSaveMenuOpen(true);
  }

  async function quickSaveState() {
    const inst = nostalgistRef.current;
    if (!inst || !game) return;
    try {
      const { state, thumbnail } = await inst.saveState();
      await api.putSaveState(game.slug, currentSlot, state, thumbnail);
      showToast(`Salvo no slot ${currentSlot}`);
    } catch {
      showToast("Erro ao salvar");
    }
  }

  async function quickLoadState() {
    const inst = nostalgistRef.current;
    if (!inst || !game) return;
    try {
      const blob = await api.getSaveStateBlob(game.slug, currentSlot);
      await inst.loadState(blob);
      showToast(`Carregado do slot ${currentSlot}`);
    } catch {
      showToast(`Slot ${currentSlot} vazio`);
    }
  }

  const [gamepad1Name, gamepad2Name] = useGamepadPlayer(nostalgistRef, toggleFullscreen, openSaveMenu);

  // Atalhos de teclado tipo RetroArch: F2 salva/F4 carrega o slot atual,
  // F6/F7 trocam o slot atual, F11 abre/fecha o menu completo (com
  // miniaturas). Ignorado se o foco estiver num campo de texto.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      switch (e.key) {
        case "F2":
          e.preventDefault();
          quickSaveState();
          break;
        case "F4":
          e.preventDefault();
          quickLoadState();
          break;
        case "F6":
          e.preventDefault();
          setCurrentSlot((s) => {
            const next = s <= 1 ? SAVE_STATE_SLOTS : s - 1;
            showToast(`Slot ${next}`);
            return next;
          });
          break;
        case "F7":
          e.preventDefault();
          setCurrentSlot((s) => {
            const next = s >= SAVE_STATE_SLOTS ? 1 : s + 1;
            showToast(`Slot ${next}`);
            return next;
          });
          break;
        case "F11":
          e.preventDefault();
          setSaveMenuOpen((v) => !v);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, currentSlot]);

  // Esconde o cursor do mouse depois de parado uns segundos em cima da
  // tela do jogo (padrao de player de video/jogo) — reaparece assim que
  // mexe de novo. So dentro do palco (fora dele, ex. na topbar, o cursor
  // continua normal — sempre tem algo clicavel ali).
  const CURSOR_IDLE_MS = 2500;
  const [cursorIdle, setCursorIdle] = useState(false);
  const cursorIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function resetCursorIdleTimer() {
    setCursorIdle(false);
    if (cursorIdleTimer.current) clearTimeout(cursorIdleTimer.current);
    cursorIdleTimer.current = setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
  }
  useEffect(() => {
    resetCursorIdleTimer();
    return () => {
      if (cursorIdleTimer.current) clearTimeout(cursorIdleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setGame(null);
    setError(null);
    setLoading(true);
    setLoadProgress(0);
    setCurrentSlot(1);
    setSaveMenuOpen(false);

    let cancelled = false;

    async function run() {
      try {
        const { game: detail } = await api.getGame(slug);
        if (cancelled) return;
        setGame(detail);
        if (!stageRef.current) return;

        stageRef.current.innerHTML = "";
        const canvas = document.createElement("canvas");
        // object-fit:contain preserva a proporcao original do jogo sem
        // cortar (letterbox), igual o "showAll" do Ruffle antes.
        canvas.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
        stageRef.current.appendChild(canvas);

        const instance = await loadEmulator({
          launcher: detail.launcher,
          romUrl: detail.rom,
          romExtras: detail.romExtras,
          canvas,
          onProgress: (f) => !cancelled && setLoadProgress(f),
        });
        if (cancelled) {
          instance.exit();
          return;
        }
        nostalgistRef.current = instance;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar o jogo");
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      nostalgistRef.current?.exit();
      nostalgistRef.current = null;
      if (stageRef.current) stageRef.current.innerHTML = "";
    };
  }, [slug]);

  return (
    <div className="player-page">
      <div className="player-topbar glass">
        <button type="button" onClick={goBack} className="back-link">
          ← Biblioteca
        </button>
        <h1>{game?.title ?? "Carregando..."}</h1>
        {gamepad1Name && <span className="gamepad-badge">🎮 P1: {gamepad1Name}</span>}
        {gamepad2Name && <span className="gamepad-badge">🎮 P2: {gamepad2Name}</span>}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div
        className={`player-stage-wrapper${cursorIdle ? " cursor-idle" : ""}`}
        ref={stageWrapperRef}
        onMouseMove={resetCursorIdleTimer}
        style={{
          position: "relative",
          ["--stage-ratio" as string]: game ? SYSTEM_ASPECT_RATIO[game.launcher] : 4 / 3,
        }}
      >
        <div className="player-stage" ref={stageRef} />
        {loading && !error && (
          <div className="player-loading-overlay">
            {loadingIconImage && <WalkingLoadingIcon src={loadingIconImage} />}
            <div className="player-loading-bottom">
              <div className="player-loading-bar">
                <div className="player-loading-bar-fill" style={{ width: `${Math.round(loadProgress * 100)}%` }} />
              </div>
              <div className="player-loading-pct">{Math.round(loadProgress * 100)}%</div>
            </div>
          </div>
        )}
        <button
          type="button"
          className="player-fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          title={isFullscreen ? "Sair da tela cheia (segure R2)" : "Tela cheia (segure R2)"}
        >
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M16 3h3a2 2 0 0 1 2 2v3" />
              <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
        {toast && <div className="player-toast">{toast}</div>}
        {saveMenuOpen && game && (
          <SaveStateMenu slug={game.slug} nostalgistRef={nostalgistRef} onClose={() => setSaveMenuOpen(false)} />
        )}
      </div>

      {game?.description && <p className="player-description">{game.description}</p>}
    </div>
  );
}
