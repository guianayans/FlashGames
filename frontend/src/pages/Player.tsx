import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { GameDetail } from "../types";
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
      if ((e.data as { type?: string } | null)?.type !== "gc:revealBack") return;
      setShowBack(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowBack(false), BACK_BUTTON_AUTO_HIDE_MS);
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

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
        allow="fullscreen"
        allowFullScreen
      />
    </div>
  );
}

function DesktopPlayer({ slug }: { slug: string }) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const goBack = useLibraryBack();

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
      </div>

      {error && <p className="error-text">{error}</p>}

      <div
        className="player-stage-wrapper"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 960,
          margin: "0 auto",
          aspectRatio: "4/3",
        }}
      >
        <div className="player-stage" ref={stageRef} />
      </div>

      {game?.description && <p className="player-description">{game.description}</p>}
    </div>
  );
}
