import { api } from "./api";

/**
 * O Ruffle emula o SharedObject do Flash (o "save" nativo dos jogos) usando
 * localStorage do navegador. Como o app e multiusuario num unico dominio,
 * sincronizamos essas chaves com o backend por usuario logado:
 *
 * 1) Ao entrar num jogo: apaga do localStorage qualquer chave ja conhecida
 *    (registry global por jogo) e restaura so as chaves salvas do usuario
 *    atual. Isso evita "vazar" o save de outra pessoa no mesmo navegador.
 * 2) Periodicamente (e ao sair da pagina): coleta as chaves conhecidas +
 *    quaisquer chaves novas criadas durante a sessao e manda pro backend.
 */

export interface GameStorageSession {
  knownKeys: Set<string>;
  baselineKeys: Set<string>;
}

export async function prepareGameStorage(slug: string): Promise<GameStorageSession> {
  const { keys: registryKeys } = await api.getSaveKeys(slug);
  const knownKeys = new Set(registryKeys);

  for (const key of knownKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage indisponivel (modo privado etc) - segue sem save na nuvem
    }
  }

  try {
    const { data } = await api.getSave(slug);
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        knownKeys.add(key);
        try {
          localStorage.setItem(key, value);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // sem save previo ou erro de rede - comeca do zero
  }

  const baselineKeys = new Set(safeKeys());
  return { knownKeys, baselineKeys };
}

function safeKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

export function collectGameSave(session: GameStorageSession): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of safeKeys()) {
    const isKnown = session.knownKeys.has(key);
    const isNew = !session.baselineKeys.has(key);
    if (!isKnown && !isNew) continue;
    const value = localStorage.getItem(key);
    if (value != null) {
      result[key] = value;
      session.knownKeys.add(key);
    }
  }
  return result;
}

export async function flushGameSave(slug: string, session: GameStorageSession, keepalive = false) {
  const data = collectGameSave(session);
  if (Object.keys(data).length === 0) return;
  try {
    if (keepalive && "sendBeacon" in navigator) {
      // sendBeacon nao manda cookies em alguns navegadores; tenta fetch keepalive primeiro
    }
    await fetch(`/api/saves/${slug}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      keepalive,
    });
  } catch {
    // melhor esforco - se falhar, tenta de novo no proximo ciclo
  }
}
