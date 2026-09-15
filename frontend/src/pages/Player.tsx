import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { GameDetail } from "../types";
import { loadRuffleScript } from "../loadRuffleScript";
import { prepareGameStorage, flushGameSave, type GameStorageSession } from "../ruffleSave";
import { useContainFit } from "../useContainFit";
import TouchControls from "../components/TouchControls";

export default function Player() {
  const { slug = "" } = useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [pointerCoarse, setPointerCoarse] = useState(false);
  const [portrait, setPortrait] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const playerElRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<GameStorageSession | null>(null);
  const flushIntervalRef = useRef<number | null>(null);

  const gameRatio = game ? game.width / game.height : 4 / 3;
  const [shellRect, setShellSlot] = useContainFit(gameRatio);
  const [fsRect, setFsSlot] = useContainFit(gameRatio);

  // Detecta "e celular" (pra decidir se mostra o shell/tela cheia + controles
  // ativados por padrao) e orientacao. So `pointer: coarse` nao e confiavel
  // sozinho (alguns navegadores/dispositivos nao reportam certo) — combina
  // com o tamanho da tela: o lado curto do viewport (funciona em qualquer
  // orientacao) tem que ser de celular, nao de tablet/desktop.
  useEffect(() => {
    const mqCoarse = window.matchMedia("(pointer: coarse)");
    const mqPortrait = window.matchMedia("(orientation: portrait)");
    let defaultApplied = false;
    const sync = () => {
      const shortSide = Math.min(window.innerWidth, window.innerHeight);
      const isMobile = mqCoarse.matches || shortSide <= 560;
      setPointerCoarse(isMobile);
      setPortrait(mqPortrait.matches);
      // So aplica o padrao (controles ligados em celular) uma vez, na
      // primeira deteccao — depois disso e o usuario quem manda no toggle,
      // girar a tela nao pode resetar a escolha dele.
      if (!defaultApplied) {
        defaultApplied = true;
        setShowControls(isMobile);
      }
    };
    sync();
    mqCoarse.addEventListener("change", sync);
    mqPortrait.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mqCoarse.removeEventListener("change", sync);
      mqPortrait.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);


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
        stageRef.current.innerHTML = "";
        stageRef.current.appendChild(player);
        playerElRef.current = player;

        await player.ruffle().load({
          url: `/games/${slug}/${detail.swf}`,
          // "showAll" preserva a proporcao original sem cortar (letterbox).
          // forceScale ignora o Stage.scaleMode que o proprio jogo tente
          // setar via ActionScript (comum em jogos antigos) — sem isso,
          // alguns jogos forcam o proprio tamanho fixo e cortam dentro do
          // nosso container.
          scale: "showAll",
          forceScale: true,
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

  const hasControls = !!game?.controls;
  const isHandheld = pointerCoarse && portrait; // celular vertical: shell de portatil
  const isMobileLandscape = pointerCoarse && !portrait; // celular horizontal: tela cheia

  const pageClass = [
    "player-page",
    isHandheld ? "is-handheld" : "",
    isMobileLandscape ? "is-mobile-landscape" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // A stage (onde o <ruffle-player> mora) precisa ficar sempre montada, sem
  // nunca desmontar, senao o jogo recarrega do zero a cada troca de
  // orientacao. So a posicao/tamanho dela mudam por modo.
  let stageStyle: CSSProperties;
  if (isHandheld) {
    stageStyle = shellRect
      ? { position: "fixed", left: shellRect.left, top: shellRect.top, width: shellRect.width, height: shellRect.height, borderRadius: "13px 13px 4px 4px" }
      : { position: "fixed", opacity: 0, width: 0, height: 0 };
  } else if (isMobileLandscape) {
    stageStyle = fsRect
      ? { position: "fixed", left: fsRect.left, top: fsRect.top, width: fsRect.width, height: fsRect.height, borderRadius: 0 }
      : { position: "fixed", opacity: 0, width: 0, height: 0 };
  } else {
    stageStyle = {
      position: "relative",
      width: "100%",
      maxWidth: 960,
      margin: "0 auto",
      aspectRatio: game ? `${game.width}/${game.height}` : "4/3",
    };
  }

  return (
    <div className={pageClass}>
      {isHandheld && (
        <>
          <div className="shell-topbar">
            <Link to="/" className="shell-back" aria-label="Voltar pra biblioteca">
              ←
            </Link>
            <span className="shell-title">{game?.title ?? "Carregando..."}</span>
            <button
              className="shell-toggle"
              onClick={() => setShowControls((v) => !v)}
              title="Mostrar/ocultar controles"
            >
              🎮
            </button>
          </div>

          <div className="shell">
            <img className="shell-img" src="/images/handheld-bg.webp" alt="" />
            <div className="shell-screen-slot" ref={setShellSlot} />
            {showControls && hasControls && (
              <TouchControls controls={game!.controls!} targetRef={playerElRef} placement="shell" />
            )}
          </div>
        </>
      )}

      {!isHandheld && !isMobileLandscape && (
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
      )}

      {isMobileLandscape && (
        <>
          <div className="landscape-screen-slot" ref={setFsSlot} />
          <div className="mobile-landscape-bar">
            <Link to="/" className="back-link" aria-label="Voltar pra biblioteca">
              ←
            </Link>
            <button
              className="toggle-controls-btn"
              onClick={() => setShowControls((v) => !v)}
              title="Mostrar/ocultar controles de toque"
            >
              🎮
            </button>
          </div>
          {showControls && hasControls && (
            <TouchControls controls={game!.controls!} targetRef={playerElRef} placement="fullscreen" />
          )}
        </>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="player-stage-wrapper" style={stageStyle}>
        <div className="player-stage" ref={stageRef} />
      </div>

      {!isHandheld && !isMobileLandscape && game?.description && (
        <p className="player-description">{game.description}</p>
      )}
    </div>
  );
}
