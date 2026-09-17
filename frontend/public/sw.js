// Service worker do FlashGames.
//
// Registro minimo (exigido pelo Chrome/Android pra considerar o app
// instalavel), mas com uma otimizacao real: as ROMs e as capas (.jpg) sao
// arquivos pesados e praticamente estaticos, entao usamos
// stale-while-revalidate neles - carrega instantaneo do cache nas proximas
// visitas, e atualiza o cache em segundo plano (assim, se voce trocar um
// arquivo de jogo no servidor, o proximo load ja pega a versao nova, so a
// visita atual que ainda usa a antiga). O motor de emulacao (Nostalgist.js
// + cores) vem de um CDN externo (cross-origin) e nao passa por este SW.
//
// Tudo mais (API, HTML, JS/CSS do app) passa direto pra rede, sem cache, pra
// nunca servir uma versao velha da tela ou de dado dinamico (saves, sessao).
// As fontes (self-hosted, /fonts/) tambem sao cacheadas: nunca mudam de
// conteudo pro mesmo caminho, entao dispensam revalidacao (cache-first).

const CACHE_NAME = "flashgames-assets-v5";
// BIOS (/roms/BIOS/*.bin) fica de fora do stale-while-revalidate: e' pouco
// pedido (uma vez por partida) e, justamente por causa disso, uma resposta
// velha em cache (ex: de quando o arquivo ainda nao existia ou tinha nome
// errado) pode mascarar por muito tempo uma correcao feita no servidor.
const REVALIDATE_RE = /\/roms\/(?!BIOS\/).+\.(zip|sfc|smc|nes|md|gen|bin|gba|jpg|jpeg|png|webp)$/;
const CACHE_FIRST_RE = /\/fonts\/.+\.woff2?$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Só intercepta same-origin para evitar bug do WebKit/Safari com
  // respostas opacas de requisições cross-origin refeitas via SW.
  if (url.origin !== self.location.origin) return;

  // Pra tudo que a gente NAO quer cachear (API, HTML, JS/CSS, navegacao
  // de pagina como /play/:slug), a melhor forma de "deixar passar direto"
  // e' simplesmente NAO chamar event.respondWith() — sem isso, o browser
  // trata a requisicao normal, direto, sem o SW no meio. Chamar
  // event.respondWith(fetch(event.request)) pra esses casos (como tinha
  // antes) da "TypeError: Failed to fetch" em navegacao de pagina no
  // Chrome quando o pedido envolve redirect (ex: HTTPS/HSTS do proxy) —
  // o SW nao pode reencaminhar um response redirecionado pra uma
  // navegacao do jeito que event.respondWith exige, e a pagina falha ao
  // carregar (tela preta, precisa recarregar sozinha).
  if (event.request.method !== "GET") return;

  if (CACHE_FIRST_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  if (!REVALIDATE_RE.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
