// Pagina standalone (sem React) que roda DENTRO do <iframe id="game-iframe">
// do GameScreen.html (frontend/public/GameScreen.html, copia byte-a-byte do
// modelo de referencia em elementos/GameScreen.html). O GameScreen.html so
// sabe fazer duas coisas com o jogo carregado: despachar KeyboardEvent
// (keydown/keyup, com uma tecla FIXA por botao) e mandar postMessage com o
// mesmo evento + um evento extra "analog" pros analogicos. Esta pagina:
//
//   1) recebe o slug do jogo via query string (?slug=...)
//   2) carrega o Ruffle e o .swf correspondente, na resolucao nativa do jogo
//      (sem cortar, mesmo esquema "showAll" + forceScale de antes)
//   3) escuta o postMessage do GameScreen.html e REMAPEIA a tecla fixa que
//      ele manda pra tecla que aquele jogo especifico espera (definida no
//      manifest.json de cada jogo, controls.dpad/dpad2/aimJoystick/buttons)
//   4) sincroniza o save do jogo com o backend, igual o player desktop
//
// O GameScreen.html em si nao e alterado — so o que roda dentro do iframe
// dele e escrito por nos, pra adaptar a saida fixa dele a cada jogo.
import { api } from "./api";
import { loadRuffleScript } from "./loadRuffleScript";
import { prepareGameStorage, flushGameSave, type GameStorageSession } from "./ruffleSave";
import type { ControlsConfig, DpadConfig } from "./types";

const params = new URLSearchParams(location.search);
const slug = params.get("slug") || "";

const CODE_MAP: Record<string, string> = {
  " ": "Space",
  Shift: "ShiftLeft",
  Control: "ControlLeft",
  Alt: "AltLeft",
  Tab: "Tab",
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

function codeFor(key: string): string {
  if (CODE_MAP[key]) return CODE_MAP[key];
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key.length === 1) return `Key${key.toUpperCase()}`;
  return key;
}

interface RufflePlayerElement extends HTMLElement {
  ruffle(): {
    load(options: { url: string; scale?: string; forceScale?: boolean; backgroundColor?: string }): Promise<void>;
  };
}

function focusPlayer(player: RufflePlayerElement | null) {
  if (!player) return;
  try {
    player.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

// Todas as teclas que JA foram despachadas como "keydown" sem o "keyup"
// correspondente ainda — usado pela rede de seguranca (releaseAllHeldKeys)
// pra garantir que nada fique preso no Ruffle, independente do que
// aconteceu la em cima no GameScreen.html.
const heldKeys = new Set<string>();

function dispatchKey(type: "keydown" | "keyup", key: string) {
  if (type === "keydown") heldKeys.add(key);
  else heldKeys.delete(key);
  window.dispatchEvent(
    new KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true })
  );
}

function getCanvas(player: RufflePlayerElement | null): HTMLElement | null {
  if (!player) return null;
  return player.querySelector("canvas") ?? player.shadowRoot?.querySelector("canvas") ?? null;
}

function dispatchPointer(canvas: HTMLElement, type: string, clientX: number, clientY: number, pressed: boolean) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: pressed ? 1 : 0,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      view: window,
    })
  );
}

// O d-pad e os analogicos do GameScreen.html mandam sempre a MESMA tecla
// fixa por direcao (ver elementos/GameScreen.html) — essa tabela traduz
// essa saida fixa pra direcao logica usada no manifest.json de cada jogo
// (controls.dpad/dpad2). Os botoes X/Y/A/B/FN/SEL/START, por outro lado,
// agora sao remapeaveis pelo proprio usuario direto no GameScreen.html (ver
// a secao "REMAPEAR BOTOES" nesse arquivo) — a tecla que ele mandar via
// postMessage JA E a tecla final que o jogo deve receber, sem indireção
// nenhuma por manifest aqui.
const RAW_ARROW_DIR: Record<string, keyof DpadConfig> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

async function main() {
  const stage = document.getElementById("stage");
  if (!stage || !slug) return;

  const { game } = await api.getGame(slug);
  const controls: ControlsConfig | undefined = game.controls;

  let session: GameStorageSession | null = null;
  try {
    session = await prepareGameStorage(slug);
  } catch {
    // segue sem sincronizar save se a API falhar - jogo ainda funciona
  }

  await loadRuffleScript();
  if (!window.RufflePlayer?.newest) return;

  const ruffle = window.RufflePlayer.newest();
  const player = ruffle.createPlayer() as RufflePlayerElement;
  player.style.width = "100%";
  player.style.height = "100%";
  player.style.backgroundColor = "#000";
  stage.appendChild(player);

  await player.ruffle().load({
    url: `/games/${slug}/${game.swf}`,
    // "showAll" preserva a proporcao original sem cortar (letterbox);
    // forceScale ignora o Stage.scaleMode que o jogo tente setar sozinho.
    scale: "showAll",
    forceScale: true,
    // Sem isso a area de letterbox (o "sobra" quando a proporcao do jogo
    // nao bate com a da tela) fica branca — o padrao do Ruffle quando o
    // .swf nao define uma cor de fundo propria.
    backgroundColor: "#000000",
  });
  focusPlayer(player);

  // GameScreen.html tem UM d-pad fisico + UM analogico esquerdo, ambos
  // mandando as MESMAS teclas de seta (ver DIR_KEYS/STICK_KEYS no HTML) —
  // nao da pra distinguir a origem, entao tratamos os dois como "o dpad".
  // Pro caso raro de um jogo com dpad2 (2 jogadores, ex.: Fireboy &
  // Watergirl), o d-pad fisico vira o jogador cuja config ja E setas
  // (repasse direto, sem remapeamento) e o analogico DIREITO (que manda um
  // canal "analog" dedicado, com stick:'right') vira o outro jogador.
  const usesDpad2ForArrows = !!controls?.dpad2 && !controls?.aimJoystick;
  const arrowDpad: DpadConfig | undefined = usesDpad2ForArrows ? controls?.dpad2 : controls?.dpad;
  const rightStickDpad: DpadConfig | undefined = usesDpad2ForArrows ? controls?.dpad : undefined;

  // O analogico direito, quando usado pra segunda direcao (dpad2 no jogo),
  // chega como vetor continuo (canal "analog"), nao como tecla — precisamos
  // manter estado de quais direcoes estao "seguradas" pra so disparar
  // keydown/keyup nas transicoes, igual um d-pad de verdade. O
  // GameScreen.html nao manda nenhum evento de "soltou o analogico" (so
  // para de mandar "analog"), entao um timeout de inatividade solta tudo.
  const rightStickHeld = new Set<keyof DpadConfig>();
  let rightStickIdleTimer: number | undefined;
  function releaseRightStickDpad() {
    rightStickHeld.forEach((dir) => {
      const key = rightStickDpad?.[dir];
      if (key) {
        focusPlayer(player);
        dispatchKey("keyup", key);
      }
    });
    rightStickHeld.clear();
  }
  function updateRightStickDpad(x: number, y: number) {
    if (!rightStickDpad) return;
    const dead = 0.35;
    const need = new Set<keyof DpadConfig>();
    if (Math.hypot(x, y) >= dead) {
      if (Math.abs(x) > Math.abs(y)) need.add(x > 0 ? "right" : "left");
      else need.add(y > 0 ? "down" : "up");
    }
    (["up", "down", "left", "right"] as const).forEach((dir) => {
      const key = rightStickDpad[dir];
      if (!key) return;
      const shouldHold = need.has(dir);
      const isHeld = rightStickHeld.has(dir);
      if (shouldHold && !isHeld) {
        rightStickHeld.add(dir);
        focusPlayer(player);
        dispatchKey("keydown", key);
      } else if (!shouldHold && isHeld) {
        rightStickHeld.delete(dir);
        focusPlayer(player);
        dispatchKey("keyup", key);
      }
    });
    window.clearTimeout(rightStickIdleTimer);
    rightStickIdleTimer = window.setTimeout(releaseRightStickDpad, 200);
  }

  // Mira (analogico direito quando o jogo pede aimJoystick) — o
  // GameScreen.html nao manda um evento explicito de "soltou o analogico",
  // so para de mandar "analog"; por isso inferimos solto por timeout.
  let aiming = false;
  let aimIdleTimer: number | undefined;
  function handleAim(x: number, y: number) {
    const aim = controls?.aimJoystick;
    if (!aim) return;
    const canvas = getCanvas(player);
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const aimX = cx + x * (r.width / 2);
    const aimY = cy + y * (r.height / 2);
    dispatchPointer(canvas, "pointermove", aimX, aimY, true);
    if (!aiming && aim.fireOnHold) {
      dispatchPointer(canvas, "pointerdown", aimX, aimY, true);
    }
    aiming = true;
    window.clearTimeout(aimIdleTimer);
    aimIdleTimer = window.setTimeout(() => {
      aiming = false;
      if (aim.fireOnHold) {
        const rr = canvas.getBoundingClientRect();
        dispatchPointer(canvas, "pointerup", rr.left + rr.width / 2, rr.top + rr.height / 2, false);
      }
    }, 200);
  }

  // Rede de seguranca definitiva contra teclas/mira presas: solta TUDO
  // que este wrapper ja despachou pro Ruffle, sem depender de nenhum
  // bookkeeping de origem (GameScreen.html, analogico direito, mira) —
  // e a camada final antes do Ruffle, entao e o lugar mais confiavel pra
  // garantir isso. Disparado por 1) um postMessage explicito do
  // GameScreen.html quando ELE detecta que nenhum dedo mais toca a tela,
  // e 2) o proprio touchend/touchcancel deste documento (cobre o caso de
  // um toque ter sido roteado direto pra dentro deste iframe — na
  // paisagem o jogo ocupa a tela inteira embaixo dos controles — sem
  // passar pelos handlers do GameScreen.html).
  function releaseAllHeldKeys() {
    if (heldKeys.size > 0) {
      focusPlayer(player);
      Array.from(heldKeys).forEach((key) => dispatchKey("keyup", key));
    }
    rightStickHeld.clear();
    window.clearTimeout(rightStickIdleTimer);
    if (aiming) {
      aiming = false;
      window.clearTimeout(aimIdleTimer);
      const canvas = getCanvas(player);
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        dispatchPointer(canvas, "pointerup", r.left + r.width / 2, r.top + r.height / 2, false);
      }
    }
  }

  document.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) releaseAllHeldKeys();
  });
  document.addEventListener("touchcancel", (e) => {
    if (e.touches.length === 0) releaseAllHeldKeys();
  });

  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; key?: string; stick?: string; x?: number; y?: number } | null;
    if (!d || !d.type) return;

    if (d.type === "releaseAll") {
      releaseAllHeldKeys();
      return;
    }

    if (d.type === "keydown" || d.type === "keyup") {
      const rawKey = d.key;
      if (!rawKey) return;
      const dir = RAW_ARROW_DIR[rawKey];
      if (dir) {
        const mapped = arrowDpad?.[dir];
        if (mapped) {
          // Foca em keydown E keyup (nao so keydown): se o Ruffle perder o
          // foco interno enquanto a tecla esta segurada, o keyup de soltar
          // seria ignorado por ele e o personagem ficaria andando sozinho
          // mesmo com o GameScreen.html mandando o evento certinho.
          focusPlayer(player);
          dispatchKey(d.type, mapped);
        }
        return;
      }
      // Botoes (X/Y/A/B/FN/SEL/START): a tecla que o usuario configurou no
      // proprio GameScreen.html (remapeavel la, ver comentario acima) vai
      // direto pro jogo, sem indireção por manifest.
      focusPlayer(player);
      dispatchKey(d.type, rawKey);
      return;
    }

    if (d.type === "analog" && d.stick === "right" && typeof d.x === "number" && typeof d.y === "number") {
      if (controls?.aimJoystick) handleAim(d.x, d.y);
      else if (rightStickDpad) updateRightStickDpad(d.x, d.y);
    }
  });

  if (!session) return;
  const activeSession = session;
  const flush = (keepalive = false) => flushGameSave(slug, activeSession, keepalive);
  const flushInterval = window.setInterval(() => flush(false), 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
  window.addEventListener("beforeunload", () => flush(true));
  window.addEventListener("unload", () => {
    window.clearInterval(flushInterval);
  });
}

main();
