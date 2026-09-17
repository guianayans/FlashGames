// Pagina standalone (sem React) que roda DENTRO do <iframe id="game-iframe">
// do GameScreen.html (frontend/public/GameScreen.html). O GameScreen.html
// manda postMessage com o mesmo evento de teclado que despacharia
// (keydown/keyup, com uma tecla FIXA por botao fisico) mais um "releaseAll"
// de seguranca. Esta pagina:
//
//   1) recebe o slug do jogo via query string (?slug=...)
//   2) carrega o Nostalgist.js (libretro/RetroArch, sem nenhuma UI propria)
//      com a ROM certa, no launcher certo (snes/nes/megadrive/gba)
//   3) escuta o postMessage do GameScreen.html e chama pressDown/pressUp do
//      Nostalgist diretamente pelo NOME do botao — o mapeamento botao-fisico
//      -> botao-de-console e sempre o mesmo em qualquer jogo de qualquer
//      sistema, entao nao existe remap por manifest aqui
import { api } from "./api";
import { loadEmulator } from "./loadEmulatorScript";
import type { Nostalgist } from "nostalgist";

const params = new URLSearchParams(location.search);
const slug = params.get("slug") || "";

// Traduz a tecla fixa que o GameScreen.html ja manda por botao fisico (ver
// data-key de cada .btn/.cbtn em frontend/public/GameScreen.html) pro nome
// de botao que o Nostalgist espera (up/down/left/right, a/b/x/y, l/r,
// select/start) — nao precisamos mudar as teclas do GameScreen.html.
const KEY_TO_BUTTON: Record<string, string> = {
  x: "x",
  y: "y",
  z: "a", // btn-a
  Shift: "b", // btn-b
  Tab: "select",
  k: "start", // btn-start — evita colidir com o bind nativo de Enter no RetroArch (ver diagnostico)
  q: "l",
  e: "r",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

let nostalgist: Nostalgist | null = null;

// Todos os botoes JA pressionados sem o "solta" correspondente ainda — rede
// de seguranca (releaseAllHeld) pra garantir que nada fique preso no
// emulador, independente do que aconteceu la em cima no GameScreen.html.
// Chave "player:button" (ex. "1:a", "2:start") pra P1 e P2 nao pisarem um
// no held-state do outro.
const heldButtons = new Set<string>();

function press(type: "keydown" | "keyup", key: string, player = 1) {
  const button = KEY_TO_BUTTON[key];
  if (!button || !nostalgist) return;
  const heldKey = `${player}:${button}`;
  if (type === "keydown") {
    heldButtons.add(heldKey);
    nostalgist.pressDown({ button, player });
  } else {
    heldButtons.delete(heldKey);
    nostalgist.pressUp({ button, player });
  }
}

function releaseAllHeld() {
  if (!nostalgist || heldButtons.size === 0) return;
  Array.from(heldButtons).forEach((heldKey) => {
    const [playerStr, button] = heldKey.split(":");
    nostalgist?.pressUp({ button, player: Number(playerStr) });
  });
  heldButtons.clear();
}

document.addEventListener("touchend", (e) => {
  if (e.touches.length === 0) releaseAllHeld();
});
document.addEventListener("touchcancel", (e) => {
  if (e.touches.length === 0) releaseAllHeld();
});

// Swipe da borda esquerda — em paisagem o jogo ocupa a tela toda, entao
// e' este iframe (nao o GameScreen.html por fora dele) quem recebe o
// toque perto da borda. Mesma logica de GameScreen.html: bloqueia o
// gesto nativo de "voltar" do iOS e avisa window.top (a react app, que
// tem o botao — ver mobile-player-back em Player.tsx) pra revelar o
// botao em vez de navegar direto.
const EDGE_PX = 24;
const MOVE_PX = 36;
let swipeStartX: number | null = null;
let swipeStartY: number | null = null;
let watchingEdgeSwipe = false;
let edgeSwipeSent = false;

document.addEventListener(
  "touchstart",
  (e) => {
    const t = e.touches[0];
    if (!t || t.clientX > EDGE_PX) {
      watchingEdgeSwipe = false;
      return;
    }
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    watchingEdgeSwipe = true;
    edgeSwipeSent = false;
  },
  { passive: true }
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (!watchingEdgeSwipe || swipeStartX === null || swipeStartY === null) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - swipeStartX;
    const dy = Math.abs(t.clientY - swipeStartY);
    if (dx < 8 && dy < 8) return;
    if (dy > dx) {
      watchingEdgeSwipe = false;
      return;
    }
    e.preventDefault();
    if (!edgeSwipeSent && dx > MOVE_PX) {
      edgeSwipeSent = true;
      try {
        window.top?.postMessage({ type: "gc:revealBack" }, location.origin);
      } catch {
        // ignore
      }
    }
  },
  { passive: false }
);

function stopWatchingEdgeSwipe() {
  watchingEdgeSwipe = false;
}
document.addEventListener("touchend", stopWatchingEdgeSwipe, { passive: true });
document.addEventListener("touchcancel", stopWatchingEdgeSwipe, { passive: true });

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data as { type?: string; key?: string; player?: number } | null;
  if (!d || !d.type) return;

  if (d.type === "releaseAll") {
    releaseAllHeld();
    return;
  }
  if ((d.type === "keydown" || d.type === "keyup") && d.key) {
    press(d.type, d.key, d.player || 1);
  }
});

function showError(stage: HTMLElement, message: string) {
  stage.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;` +
    `height:100%;padding:16px;color:#fff;background:#000;` +
    `font:14px/1.4 system-ui,sans-serif;text-align:center;">${message}</div>`;
}

async function main() {
  const stage = document.getElementById("stage");
  if (!stage || !slug) return;

  // Sem isso, qualquer erro aqui (API fora do ar, ROM 404, core falhando)
  // deixava a tela do jogo simplesmente preta e parada, sem nenhuma pista —
  // especialmente ruim no mobile, sem devtools a mao.
  try {
    const { game } = await api.getGame(slug);

    const canvas = document.createElement("canvas");
    // object-fit:contain preserva a proporcao original do jogo sem cortar
    // (letterbox), igual o "showAll" do Ruffle antes.
    canvas.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block;";
    stage.appendChild(canvas);

    nostalgist = await loadEmulator({
      launcher: game.launcher,
      romUrl: game.rom,
      romExtras: game.romExtras,
      canvas,
    });
  } catch (err) {
    console.error("[game-wrapper] falha ao carregar o jogo", err);
    showError(stage, err instanceof Error ? err.message : "Erro ao carregar o jogo");
  }
}

main();
