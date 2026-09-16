import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { GameSummary } from "../types";
import { useAuth } from "../auth/AuthContext";
import { systemMeta } from "../categories";

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Renderizar os ~2500 cards de uma vez deixava a pagina pesada pra montar,
// principalmente no celular — pagina em blocos de PAGE_SIZE em vez de
// jogar tudo no DOM de uma vez.
const PAGE_SIZE = 48;

// "#" agrupa titulos que comecam com numero (bem comuns nessa colecao, ex.
// "3 Ninjas Kick Back") — sem isso ficariam de fora do filtro por letra.
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function titleBucket(title: string): string {
  const first = normalize(title).trim()[0] ?? "";
  return /[0-9]/.test(first) ? "#" : first.toUpperCase();
}

// Chave da posicao de scroll salva no sessionStorage, por combinacao de
// filtro/pagina (a propria query string ja identifica isso).
function scrollKey(search: string): string {
  return `library-scroll:${search}`;
}

export default function Library() {
  const { user, logout } = useAuth();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Busca, sistema, favoritos e pagina vivem na URL (searchParams) em vez de
  // useState puro — assim, ao abrir um jogo (navigate) e voltar
  // (navigate(-1) no Player, ver useLibraryBack), o navegador restaura essa
  // MESMA URL e a pesquisa aparece exatamente como o usuario deixou, sem
  // precisar recarregar a pagina.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const activeSystem = searchParams.get("system") ?? "todos";
  const favoritesOnly = searchParams.get("fav") === "1";
  const letter = searchParams.get("letter") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [alphaOpen, setAlphaOpen] = useState(false);

  // Puxar a tela pra baixo (no topo) atualiza a lista — Safari/PWA no iOS
  // nao tem pull-to-refresh nativo (diferente do Chrome/Android), entao
  // esse gesto e essa UI sao 100% nossos.
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const pullState = useRef<{ startY: number; active: boolean } | null>(null);

  function updateFilters(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page"); // filtro mudou, volta pra pagina 1
    setSearchParams(next, { replace: true });
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    setSearchParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadLibrary() {
    try {
      const res = await api.listGames();
      setGames(res.games);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar jogos");
    }
    try {
      const res = await api.listFavorites();
      setFavorites(new Set(res.slugs));
    } catch {
      // sem favoritos carregados, so a estrela fica sem estado — nao
      // impede o resto da biblioteca de funcionar.
    }
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  const PULL_THRESHOLD = 64;
  const PULL_MAX = 96;

  // touchmove precisa ser um listener NATIVO (nao onTouchMove do JSX): o
  // React anexa o handler de touchmove como passive por padrao, entao
  // preventDefault() dentro do synthetic event NAO bloqueia o bounce
  // nativo do Safari — sem isso os dois gestos (o nosso indicador + o
  // rubber-band do iOS) brigam e ficam tremendo na tela.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || refreshing) {
        pullState.current = null;
        return;
      }
      pullState.current = { startY: e.touches[0].clientY, active: true };
    }

    function onTouchMove(e: TouchEvent) {
      const state = pullState.current;
      if (!state?.active) return;
      const delta = e.touches[0].clientY - state.startY;
      if (delta <= 0 || window.scrollY > 0) {
        state.active = false;
        setPullDistance(0);
        return;
      }
      e.preventDefault();
      setPullDistance(Math.min(PULL_MAX, delta * 0.5));
    }

    async function onTouchEnd() {
      const state = pullState.current;
      pullState.current = null;
      if (!state?.active) return;
      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true);
          loadLibrary().finally(() => {
            setRefreshing(false);
            setPullDistance(0);
          });
          return PULL_THRESHOLD;
        }
        return 0;
      });
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing]);

  async function toggleFavorite(slug: string) {
    const wasFavorite = favorites.has(slug);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(slug);
      else next.add(slug);
      return next;
    });
    try {
      if (wasFavorite) await api.removeFavorite(slug);
      else await api.addFavorite(slug);
    } catch {
      // falhou no servidor - desfaz o otimista
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(slug);
        else next.delete(slug);
        return next;
      });
    }
  }

  const systems = useMemo(() => {
    const seen = new Map<string, number>();
    for (const g of games) {
      seen.set(g.system, (seen.get(g.system) || 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [games]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return games.filter((g) => {
      if (favoritesOnly && !favorites.has(g.slug)) return false;
      if (activeSystem !== "todos" && g.system !== activeSystem) return false;
      if (letter && titleBucket(g.title) !== letter) return false;
      if (!q) return true;
      const haystack = normalize([g.title, g.description, g.category, ...(g.tags || [])].join(" "));
      return haystack.includes(q);
    });
  }, [games, query, activeSystem, favoritesOnly, favorites, letter]);

  // Pra desabilitar no overlay as letras sem nenhum jogo correspondente.
  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) set.add(titleBucket(g.title));
    return set;
  }, [games]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE),
    [filtered, pageSafe]
  );

  // Restaura o scroll de onde o usuario parou ao voltar de um jogo (ver
  // saveScroll, chamado ao clicar num card). So tenta depois que a lista
  // carregou e a pagina certa ja esta renderizada, senao a altura do
  // documento ainda nao existe pra rolar ate la.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (games.length === 0) return;
    if (restoredFor.current === location.search) return;
    restoredFor.current = location.search;
    const saved = sessionStorage.getItem(scrollKey(location.search));
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
    }
  }, [games, paged]);

  // Overlay do alfabeto: Esc fecha, e trava o scroll da pagina por tras
  // enquanto ele estiver aberto (senao da pra rolar a lista de jogos
  // "atraves" do overlay no mobile).
  useEffect(() => {
    if (!alphaOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAlphaOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [alphaOpen]);

  function pickLetter(l: string | null) {
    updateFilters({ letter: l });
    setAlphaOpen(false);
  }

  function saveScroll() {
    try {
      sessionStorage.setItem(scrollKey(location.search), String(window.scrollY));
    } catch {
      // sessionStorage indisponivel (aba privada etc.) - sem restauracao, tudo bem
    }
  }

  const pullActive = pullDistance > 0 || refreshing;
  const pullProgress = Math.min(1, pullDistance / PULL_THRESHOLD);

  return (
    <div className="library-page" ref={pageRef}>
      {pullActive && (
        <div className="pull-refresh" style={{ height: refreshing ? PULL_THRESHOLD : pullDistance }}>
          <div
            className={`pull-refresh-spinner${refreshing ? " spinning" : ""}`}
            style={!refreshing ? { transform: `rotate(${pullProgress * 180}deg)`, opacity: 0.4 + pullProgress * 0.6 } : undefined}
          />
        </div>
      )}

      <div className="library-brand">
        <img src="/logo.png" alt="FlashGames" className="library-logo" />
      </div>

      <header className="library-header glass">
        <button
          type="button"
          className={`library-alpha-trigger${letter ? " active" : ""}`}
          onClick={() => setAlphaOpen(true)}
          aria-label="Filtrar por letra"
        >
          {letter || "A–Z"}
        </button>

        <div className="library-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => updateFilters({ q: e.target.value || null })}
            placeholder="Buscar jogos..."
            aria-label="Buscar jogos"
          />
        </div>

        <div className="library-user">
          <span>
            Ola, <strong>{user?.username}</strong>
          </span>
          <button onClick={() => logout()}>Sair</button>
        </div>
      </header>

      {alphaOpen && (
        <div className="alpha-overlay" role="dialog" aria-modal="true" aria-label="Filtrar por letra" onClick={() => setAlphaOpen(false)}>
          <div className="alpha-card glass" onClick={(e) => e.stopPropagation()}>
            <div className="alpha-card-header">
              <h2>Filtrar por letra</h2>
              <button type="button" className="alpha-close" onClick={() => setAlphaOpen(false)} aria-label="Fechar">
                ×
              </button>
            </div>
            <div className="alpha-grid">
              <button
                type="button"
                className={`alpha-chip alpha-chip-all${!letter ? " active" : ""}`}
                onClick={() => pickLetter(null)}
              >
                Todos
              </button>
              {ALPHABET.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`alpha-chip${letter === l ? " active" : ""}`}
                  disabled={!availableLetters.has(l)}
                  onClick={() => pickLetter(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="category-row">
        <button
          className={`category-chip${activeSystem === "todos" ? " active" : ""}`}
          style={{ ["--chip-color" as string]: "#00e5ff" }}
          onClick={() => updateFilters({ system: null })}
        >
          Todos
        </button>
        <button
          className={`category-chip${favoritesOnly ? " active" : ""}`}
          style={{ ["--chip-color" as string]: "#ffb020" }}
          onClick={() => updateFilters({ fav: favoritesOnly ? null : "1" })}
          aria-pressed={favoritesOnly}
        >
          <span className="chip-dot">★</span>
          Favoritos
        </button>
        {systems.map(([slug, count]) => {
          const meta = systemMeta(slug);
          return (
            <button
              key={slug}
              className={`category-chip${activeSystem === slug ? " active" : ""}`}
              style={{ ["--chip-color" as string]: meta.color }}
              onClick={() => updateFilters({ system: slug })}
            >
              <span className="chip-dot">{meta.icon}</span>
              {meta.label}
              <span>({count})</span>
            </button>
          );
        })}
      </div>

      {error && <p className="error-text">{error}</p>}

      {!error && games.length > 0 && (
        <p className="library-count">
          {filtered.length} {filtered.length === 1 ? "jogo encontrado" : "jogos encontrados"}
        </p>
      )}

      {!error && games.length === 0 && <p className="library-empty">Nenhuma ROM encontrada ainda.</p>}
      {!error && games.length > 0 && filtered.length === 0 && (
        <p className="library-empty">
          {favoritesOnly ? "Voce ainda nao favoritou nenhum jogo." : "Nada por aqui. Tenta outro termo ou sistema."}
        </p>
      )}

      <div className="game-grid">
        {paged.map((g) => {
          const meta = systemMeta(g.system);
          const isFavorite = favorites.has(g.slug);
          return (
            <Link
              key={g.slug}
              to={`/play/${g.slug}`}
              className="game-card"
              style={{ ["--accent" as string]: meta.color }}
              onClick={saveScroll}
            >
              <div className="game-card-media">
                {g.cover ? (
                  <img src={g.cover} alt="" loading="lazy" />
                ) : (
                  <div className="game-card-media-fallback">{g.title.slice(0, 1)}</div>
                )}
                <div className="game-card-scan" />
                <span className="game-card-badge">
                  {meta.icon} {meta.label}
                </span>
                <button
                  type="button"
                  className={`game-card-favorite${isFavorite ? " active" : ""}`}
                  aria-label={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                  aria-pressed={isFavorite}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(g.slug);
                  }}
                >
                  {isFavorite ? "★" : "☆"}
                </button>
              </div>
              <div className="game-card-body">
                <h2>{g.title}</h2>
                {g.description && <p>{g.description}</p>}
              </div>
            </Link>
          );
        })}
      </div>

      {!error && pageCount > 1 && (
        <div className="pagination">
          <button type="button" disabled={pageSafe <= 1} onClick={() => goToPage(pageSafe - 1)}>
            ← Anterior
          </button>
          <span className="pagination-status">
            Pagina {pageSafe} de {pageCount}
          </span>
          <button type="button" disabled={pageSafe >= pageCount} onClick={() => goToPage(pageSafe + 1)}>
            Proxima →
          </button>
        </div>
      )}
    </div>
  );
}
