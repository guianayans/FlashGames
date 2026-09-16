import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
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
  8: "select", // Select/Share/Back
  9: "start", // Start/Options/Menu
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
function useGamepadPlayer(nostalgistRef: React.RefObject<Nostalgist | null>): (string | null)[] {
  const [names, setNames] = useState<(string | null)[]>([null, null]);

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

    function poll() {
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

function DesktopPlayer({ slug }: { slug: string }) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const goBack = useLibraryBack();
  const [gamepad1Name, gamepad2Name] = useGamepadPlayer(nostalgistRef);

  useEffect(() => {
    setGame(null);
    setError(null);

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
          canvas,
        });
        if (cancelled) {
          instance.exit();
          return;
        }
        nostalgistRef.current = instance;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar o jogo");
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
        className="player-stage-wrapper"
        style={{
          position: "relative",
          ["--stage-ratio" as string]: game ? SYSTEM_ASPECT_RATIO[game.launcher] : 4 / 3,
        }}
      >
        <div className="player-stage" ref={stageRef} />
      </div>

      {game?.description && <p className="player-description">{game.description}</p>}
    </div>
  );
}
