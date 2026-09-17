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
import { systemMeta } from "./categories";
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

// Save state — o menu de verdade (miniatura, slots, botoes) e' desenhado
// la em GameScreen.html; aqui so entra o pedido ("salva o slot 2") e sai
// a resposta, porque so esta pagina tem acesso direto ao `nostalgist`
// (saveState()/loadState()) e ao backend. Devolve a lista de slots
// atualizada depois de salvar/apagar pra GameScreen.html so precisar
// re-desenhar, sem um round-trip extra so pra re-listar.
async function replySlotList() {
  try {
    const res = await api.listSaveStates(slug);
    window.parent.postMessage({ type: "saveState:list:result", slots: res.slots }, location.origin);
  } catch {
    window.parent.postMessage({ type: "saveState:list:result", slots: [] }, location.origin);
  }
}

async function handleSaveState(slot: number) {
  try {
    if (!nostalgist) throw new Error("sem jogo carregado");
    const { state, thumbnail } = await nostalgist.saveState();
    await api.putSaveState(slug, slot, state, thumbnail);
    const res = await api.listSaveStates(slug);
    window.parent.postMessage({ type: "saveState:save:result", slots: res.slots }, location.origin);
  } catch (err) {
    console.error("[game-wrapper] falha ao salvar state", err);
    window.parent.postMessage({ type: "saveState:save:result", slots: [] }, location.origin);
  }
}

async function handleLoadState(slot: number) {
  try {
    if (!nostalgist) throw new Error("sem jogo carregado");
    const blob = await api.getSaveStateBlob(slug, slot);
    await nostalgist.loadState(blob);
    window.parent.postMessage({ type: "saveState:load:result", ok: true }, location.origin);
  } catch (err) {
    console.error("[game-wrapper] falha ao carregar state", err);
    window.parent.postMessage({ type: "saveState:load:result", ok: false }, location.origin);
  }
}

async function handleDeleteState(slot: number) {
  try {
    await api.deleteSaveState(slug, slot);
    const res = await api.listSaveStates(slug);
    window.parent.postMessage({ type: "saveState:delete:result", slots: res.slots }, location.origin);
  } catch (err) {
    console.error("[game-wrapper] falha ao apagar state", err);
    window.parent.postMessage({ type: "saveState:delete:result", slots: [] }, location.origin);
  }
}

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data as { type?: string; key?: string; player?: number; slot?: number } | null;
  if (!d || !d.type) return;

  if (d.type === "releaseAll") {
    releaseAllHeld();
    return;
  }
  if ((d.type === "keydown" || d.type === "keyup") && d.key) {
    press(d.type, d.key, d.player || 1);
    return;
  }
  // Pausa/retoma de verdade o jogo (ver GameScreen.html, openSaveMenu/
  // closeSaveMenu) — nao so' filtrar o input que a GENTE manda: um
  // controle bluetooth que o navegador enxerga como TECLADO (comum em
  // controle barato de celular) mandaria tecla direto pro Nostalgist sem
  // passar pelo nosso postMessage nenhum, entao so' filtrar nosso proprio
  // pressDown/pressUp nao bastava — pausar o core de verdade sim.
  if (d.type === "pauseGame") {
    nostalgist?.pause();
    return;
  }
  if (d.type === "resumeGame") {
    nostalgist?.resume();
    return;
  }
  if (d.type === "saveState:list") {
    replySlotList();
    return;
  }
  if (d.type === "saveState:save" && typeof d.slot === "number") {
    handleSaveState(d.slot);
    return;
  }
  if (d.type === "saveState:load" && typeof d.slot === "number") {
    handleLoadState(d.slot);
    return;
  }
  if (d.type === "saveState:delete" && typeof d.slot === "number") {
    handleDeleteState(d.slot);
  }
});

function showError(stage: HTMLElement, message: string) {
  stage.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;` +
    `height:100%;padding:16px;color:#fff;background:#000;` +
    `font:14px/1.4 system-ui,sans-serif;text-align:center;">${message}</div>`;
}

function setLoadProgress(fraction: number) {
  const fill = document.getElementById("loading-bar-fill");
  const pct = document.getElementById("loading-pct");
  const percent = Math.round(fraction * 100);
  if (fill) fill.style.width = `${percent}%`;
  if (pct) pct.textContent = `${percent}%`;
}

let walkRafId = 0;

function hideLoadingOverlay() {
  document.getElementById("loading-overlay")?.classList.add("hidden");
  if (walkRafId) cancelAnimationFrame(walkRafId);
}

// Icone do console do jogo (ver frontend/public/images/consoles/) andando
// pela tela de carregamento inteira, ricocheteando nas bordas — mesmo
// criterio do player desktop (Player.tsx, WalkingLoadingIcon), so em
// DOM/CSS puro aqui (essa pagina nao usa React). O "andar local" (passo
// balancando, sombra espremendo) e' so CSS (#loading-icon-img/-shadow);
// aqui so translada o #loading-walk-sprite pai. Todo sistema suportado
// hoje (SNES/NES/Genesis/GBA/PS1) tem icone cadastrado em categories.ts
// — se um novo sistema entrar sem icone, essa tela simplesmente fica sem
// nada no lugar (sem spinner de reserva; era confuso ter os dois).
const WALK_ICON_SIZE = 40; // largura do sprite (bate com o width do CSS)
const WALK_SPRITE_HEIGHT = 56; // altura total incluindo a sombra embaixo (icone 40 + gap 8 + sombra 5)
const WALK_SPEED_PX_S = 70;

function startWalkingIcon(system: string) {
  const iconImage = systemMeta(system).iconImage;
  if (!iconImage) return;
  const img = document.getElementById("loading-icon-img") as HTMLImageElement | null;
  const area = document.getElementById("loading-walk-area");
  const sprite = document.getElementById("loading-walk-sprite");
  if (!img || !area || !sprite) return;
  img.src = iconImage;

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
    walkRafId = requestAnimationFrame(tick);
  }
  walkRafId = requestAnimationFrame(tick);
}

async function main() {
  const stage = document.getElementById("stage");
  if (!stage || !slug) return;

  // Sem isso, qualquer erro aqui (API fora do ar, ROM 404, core falhando)
  // deixava a tela do jogo simplesmente preta e parada, sem nenhuma pista —
  // especialmente ruim no mobile, sem devtools a mao.
  try {
    const { game } = await api.getGame(slug);
    startWalkingIcon(game.system);
    // Registra a jogada pro filtro "Recentes" da Library (ver
    // routes/plays.js) — dispara e esquece, mesmo criterio do desktop
    // (Player.tsx).
    api.recordPlay(slug).catch(() => {});

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
      onProgress: setLoadProgress,
    });
    hideLoadingOverlay();
  } catch (err) {
    console.error("[game-wrapper] falha ao carregar o jogo", err);
    hideLoadingOverlay();
    showError(stage, err instanceof Error ? err.message : "Erro ao carregar o jogo");
  }
}

main();
