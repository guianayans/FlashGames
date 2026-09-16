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
  Enter: "start",
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
const heldButtons = new Set<string>();

function press(type: "keydown" | "keyup", key: string) {
  const button = KEY_TO_BUTTON[key];
  if (!button || !nostalgist) return;
  if (type === "keydown") {
    heldButtons.add(button);
    nostalgist.pressDown(button);
  } else {
    heldButtons.delete(button);
    nostalgist.pressUp(button);
  }
}

function releaseAllHeld() {
  if (!nostalgist || heldButtons.size === 0) return;
  Array.from(heldButtons).forEach((button) => nostalgist?.pressUp(button));
  heldButtons.clear();
}

document.addEventListener("touchend", (e) => {
  if (e.touches.length === 0) releaseAllHeld();
});
document.addEventListener("touchcancel", (e) => {
  if (e.touches.length === 0) releaseAllHeld();
});

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data as { type?: string; key?: string } | null;
  if (!d || !d.type) return;

  if (d.type === "releaseAll") {
    releaseAllHeld();
    return;
  }
  if ((d.type === "keydown" || d.type === "keyup") && d.key) {
    press(d.type, d.key);
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
      canvas,
    });
  } catch (err) {
    console.error("[game-wrapper] falha ao carregar o jogo", err);
    showError(stage, err instanceof Error ? err.message : "Erro ao carregar o jogo");
  }
}

main();
