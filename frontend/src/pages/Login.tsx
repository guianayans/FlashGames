import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-scene" aria-hidden="true" />

      <div className="login-content">
        <div className="login-wordmark">
          <img src="/logo.png" alt="FlashGames" className="login-logo" />
          <p>Entre com seu usuario pra carregar seus saves e jogar.</p>
        </div>

        <form className="login-card glass" onSubmit={onSubmit}>
          <label>
            Usuario
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={20}
              required
              autoFocus
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              minLength={4}
              maxLength={72}
              required
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>

          <p className="login-hint">
            Primeira vez? So digitar um usuario e senha novos ja cria sua conta.
          </p>
        </form>
      </div>
    </div>
  );
}
