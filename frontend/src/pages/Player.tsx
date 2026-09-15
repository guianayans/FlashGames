import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { GameDetail } from "../types";
import { loadRuffleScript } from "../loadRuffleScript";
import { prepareGameStorage, flushGameSave, type GameStorageSession } from "../ruffleSave";
import TouchControls from "../components/TouchControls";

export default function Player() {
  const { slug = "" } = useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const playerElRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<GameStorageSession | null>(null);
  const flushIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);

    const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    setShowControls(isCoarsePointer);

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
        stageRef.current.innerHTML = "";
        stageRef.current.appendChild(player);
        playerElRef.current = player;

        await player.ruffle().load({
          url: `/games/${slug}/${detail.swf}`,
          width: detail.width,
          height: detail.height,
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
          playerElRef.current = null;
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
        <button
          className="toggle-controls-btn"
          onClick={() => setShowControls((v) => !v)}
          title="Mostrar/ocultar controles de toque"
        >
          🎮
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="player-stage-wrapper" style={{ aspectRatio: game ? `${game.width}/${game.height}` : "4/3" }}>
        <div className="player-stage" ref={stageRef} />
        {showControls && game?.controls && <TouchControls controls={game.controls} targetRef={stageRef} />}
      </div>

      {game?.description && <p className="player-description">{game.description}</p>}
    </div>
  );
}
