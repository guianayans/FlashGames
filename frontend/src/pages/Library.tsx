import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { GameSummary } from "../types";
import { useAuth } from "../auth/AuthContext";
import { categoryMeta } from "../categories";

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function Library() {
  const { user, logout } = useAuth();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("todos");

  useEffect(() => {
    api
      .listGames()
      .then((res) => setGames(res.games))
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar jogos"));
  }, []);

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const g of games) {
      seen.set(g.category, (seen.get(g.category) || 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [games]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return games.filter((g) => {
      if (activeCategory !== "todos" && g.category !== activeCategory) return false;
      if (!q) return true;
      const haystack = normalize([g.title, g.description, ...(g.tags || [])].join(" "));
      return haystack.includes(q);
    });
  }, [games, query, activeCategory]);

  return (
    <div className="library-page">
      <header className="library-header glass">
        <h1 className="library-logo">FLASHGAMES</h1>

        <div className="library-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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

      <div className="category-row">
        <button
          className={`category-chip${activeCategory === "todos" ? " active" : ""}`}
          style={{ ["--chip-color" as string]: "#00e5ff" }}
          onClick={() => setActiveCategory("todos")}
        >
          Todos
        </button>
        {categories.map(([slug, count]) => {
          const meta = categoryMeta(slug);
          return (
            <button
              key={slug}
              className={`category-chip${activeCategory === slug ? " active" : ""}`}
              style={{ ["--chip-color" as string]: meta.color }}
              onClick={() => setActiveCategory(slug)}
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

      {!error && games.length === 0 && <p className="library-empty">Nenhum jogo encontrado em /games ainda.</p>}
      {!error && games.length > 0 && filtered.length === 0 && (
        <p className="library-empty">Nada por aqui. Tenta outro termo ou categoria.</p>
      )}

      <div className="game-grid">
        {filtered.map((g) => {
          const meta = categoryMeta(g.category);
          return (
            <Link
              key={g.slug}
              to={`/play/${g.slug}`}
              className="game-card"
              style={{ ["--accent" as string]: meta.color }}
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
              </div>
              <div className="game-card-body">
                <h2>{g.title}</h2>
                {g.description && <p>{g.description}</p>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
