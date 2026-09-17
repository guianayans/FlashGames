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

// Base64 em pedacos (nao String.fromCharCode(...bytes) de uma vez so) —
// save state de PS1 passa de alguns MB, e o spread num array grande
// desse jeito estoura o limite de argumentos da call stack do JS.
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface SaveStateSlot {
  slot: number;
  updatedAt: string;
  thumbnail: string | null;
}

// Bate com MAX_SLOTS em backend/src/routes/savestates.js.
export const SAVE_STATE_SLOTS = 4;

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
  listSaveStates(slug: string) {
    return request<{ slots: SaveStateSlot[] }>(`/api/savestates/${slug}`);
  },
  async putSaveState(slug: string, slot: number, state: Blob, thumbnail: Blob | null | undefined) {
    const stateB64 = await blobToBase64(state);
    const thumbB64 = thumbnail ? await blobToBase64(thumbnail) : null;
    return request<{ ok: true }>(`/api/savestates/${slug}/${slot}`, {
      method: "PUT",
      body: JSON.stringify({ state: stateB64, thumbnail: thumbB64 }),
    });
  },
  async getSaveStateBlob(slug: string, slot: number): Promise<Blob> {
    const res = await fetch(`/api/savestates/${slug}/${slot}/state`, { credentials: "include" });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return res.blob();
  },
  deleteSaveState(slug: string, slot: number) {
    return request<{ ok: true }>(`/api/savestates/${slug}/${slot}`, { method: "DELETE" });
  },
};
