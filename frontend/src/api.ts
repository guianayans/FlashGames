import type { GameDetail, GameSummary, User } from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login(username: string, password: string) {
    return request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },
  me() {
    return request<{ user: User }>("/api/auth/me");
  },
  listGames() {
    return request<{ games: GameSummary[] }>("/api/games");
  },
  listBios() {
    return request<{ files: string[] }>("/api/games/system/bios");
  },
  listFavorites() {
    return request<{ slugs: string[] }>("/api/favorites");
  },
  addFavorite(slug: string) {
    return request<{ ok: true }>(`/api/favorites/${slug}`, { method: "PUT" });
  },
  removeFavorite(slug: string) {
    return request<{ ok: true }>(`/api/favorites/${slug}`, { method: "DELETE" });
  },
  getPreferences() {
    return request<{ originalCovers: boolean }>("/api/preferences");
  },
  updatePreferences(originalCovers: boolean) {
    return request<{ ok: true }>("/api/preferences", {
      method: "PUT",
      body: JSON.stringify({ originalCovers }),
    });
  },
  getGame(slug: string) {
    return request<{ game: GameDetail }>(`/api/games/${slug}`);
  },
  getSaveKeys(slug: string) {
    return request<{ keys: string[] }>(`/api/saves/${slug}/keys`);
  },
  getSave(slug: string) {
    return request<{ data: Record<string, string> | null; updatedAt: string | null }>(
      `/api/saves/${slug}`
    );
  },
  putSave(slug: string, data: Record<string, string>) {
    return request<{ ok: true }>(`/api/saves/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ data }),
    });
  },
};
