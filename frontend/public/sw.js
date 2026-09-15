// Service worker do FlashGames.
//
// Registro minimo (exigido pelo Chrome/Android pra considerar o app
// instalavel), mas com uma otimizacao real: o Ruffle (ruffle.js + os .wasm,
// ~30MB) e os .swf dos jogos sao arquivos pesados e praticamente estaticos,
// entao usamos stale-while-revalidate neles - carrega instantaneo do cache
// nas proximas visitas, e atualiza o cache em segundo plano (assim, se voce
// trocar o .swf de um jogo no servidor, o proximo load ja pega a versao
// nova, so a visita atual que ainda usa a antiga).
//
// Tudo mais (API, HTML, JS/CSS do app) passa direto pra rede, sem cache, pra
// nunca servir uma versao velha da tela ou de dado dinamico (saves, sessao).

const CACHE_NAME = "flashgames-assets-v1";
const CACHEABLE_RE = /\/vendor\/ruffle\/|\/games\/.+\.swf$/;

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

  if (event.request.method !== "GET" || !CACHEABLE_RE.test(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

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
