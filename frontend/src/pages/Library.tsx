import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { GameSummary } from "../types";
import { useAuth } from "../auth/AuthContext";

export default function Library() {
  const { user, logout } = useAuth();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listGames()
      .then((res) => setGames(res.games))
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar jogos"));
  }, []);

  return (
    <div className="library-page">
      <header className="library-header">
        <h1>FlashGames</h1>
        <div className="library-user">
          <span>Ola, {user?.username}</span>
          <button onClick={() => logout()}>Sair</button>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}
      {!error && games.length === 0 && <p>Nenhum jogo encontrado em /games ainda.</p>}

      <div className="game-grid">
        {games.map((g) => (
          <Link key={g.slug} to={`/play/${g.slug}`} className="game-card">
            <div className="game-card-thumb">{g.title.slice(0, 1)}</div>
            <div className="game-card-body">
              <h2>{g.title}</h2>
              {g.description && <p>{g.description}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
