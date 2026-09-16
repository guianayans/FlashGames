import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { GameDetail } from "../types";
import { loadRuffleScript } from "../loadRuffleScript";
import { prepareGameStorage, flushGameSave, type GameStorageSession } from "../ruffleSave";

// Janela do GameScreen.html com a API que ele expoe (ver
// frontend/public/GameScreen.html, copia fiel de elementos/GameScreen.html).
interface GameScreenWindow extends Window {
  GameController?: { setGame(src: string, slug?: string): void };
}

function detectPointerCoarse(): boolean {
  if (typeof window === "undefined") return false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return window.matchMedia("(pointer: coarse)").matches || shortSide <= 560;
}

export default function Player() {
  const { slug = "" } = useParams();

  // Celular/touch: o GameScreen.html (controller com shell de portatil,
  // d-pad, analogicos e botoes) assume a tela inteira e cuida de tudo,
  // portrait e landscape (inclusive o botao de fullscreen nativo dele). O
  // Ruffle roda dentro do <iframe id="game-iframe"> DELE, carregado via
  // GameController.setGame() — ver frontend/src/game-wrapper.ts.
  const [pointerCoarse, setPointerCoarse] = useState(detectPointerCoarse);

  useEffect(() => {
    // So escuta mudanca de capacidade de ponteiro (ex.: mouse/teclado
    // bluetooth conectado/desconectado num celular) — NAO reage a
    // "resize" do viewport. O endereco do navegador escondendo/aparecendo
    // ao rolar, ou o GameScreen.html entrando/saindo de fullscreen, tambem
    // disparam resize e mudam a heuristica de "lado curto <= 560px";
    // reagir a isso trocava MobilePlayer <-> DesktopPlayer no meio do jogo
    // (desmontando o iframe inteiro, com o jogo dentro) — o "glitch" que
    // parava os botoes de funcionar. Uma vez detectado touch, fica
    // travado em touch pelo resto da sessao nesta pagina.
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

function MobilePlayer({ slug }: { slug: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = () => {
    const win = frameRef.current?.contentWindow as GameScreenWindow | null | undefined;
    win?.GameController?.setGame(`/game-wrapper.html?slug=${encodeURIComponent(slug)}`, slug);
  };

  return (
    <div className="mobile-player">
      <Link to="/" className="mobile-player-back" aria-label="Voltar pra biblioteca">
        ←
      </Link>
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
  const sessionRef = useRef<GameStorageSession | null>(null);
  const flushIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);

    let cancelled = false;
    let cleanupPlayer: (() => void) | null = null;

    async function run() {
      try {
        const { game: detail } = await api.getGame(slug);
        if (cancelled) return;
        setGame(detail);

        const session = await prepareGameStorage(slug);
        if (cancelled) return;
        sessionRef.current = session;

        await loadRuffleScript();
        if (cancelled || !stageRef.current || !window.RufflePlayer?.newest) return;

        const ruffle = window.RufflePlayer.newest();
        const player = ruffle.createPlayer();
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.backgroundColor = "#000";
        stageRef.current.innerHTML = "";
        stageRef.current.appendChild(player);

        await player.ruffle().load({
          url: `/games/${slug}/${detail.swf}`,
          // "showAll" preserva a proporcao original sem cortar (letterbox).
          // forceScale ignora o Stage.scaleMode que o proprio jogo tente
          // setar via ActionScript (comum em jogos antigos) — sem isso,
          // alguns jogos forcam o proprio tamanho fixo e cortam dentro do
          // nosso container.
          scale: "showAll",
          forceScale: true,
          // Sem isso a area de letterbox fica branca por padrao do Ruffle.
          backgroundColor: "#000000",
        });

        const flush = (keepalive = false) => {
          if (sessionRef.current) flushGameSave(slug, sessionRef.current, keepalive);
        };

        flushIntervalRef.current = window.setInterval(() => flush(false), 10_000);
        const onVisibility = () => {
          if (document.hidden) flush(true);
        };
        const onPageHide = () => flush(true);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", onPageHide);

        cleanupPlayer = () => {
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("pagehide", onPageHide);
          if (flushIntervalRef.current) window.clearInterval(flushIntervalRef.current);
          flush(true);
          if (stageRef.current) stageRef.current.innerHTML = "";
        };
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar o jogo");
      }
    }

    run();

    return () => {
      cancelled = true;
      cleanupPlayer?.();
    };
  }, [slug]);

  return (
    <div className="player-page">
      <div className="player-topbar glass">
        <Link to="/" className="back-link">
          ← Biblioteca
        </Link>
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
          aspectRatio: game ? `${game.width}/${game.height}` : "4/3",
        }}
      >
        <div className="player-stage" ref={stageRef} />
      </div>

      {game?.description && <p className="player-description">{game.description}</p>}
    </div>
  );
}
