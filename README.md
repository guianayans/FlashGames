# FlashGames

App auto-hospedado para jogar jogos em Flash (.swf) no navegador usando o
[Ruffle](https://ruffle.rs) (emulador Flash em WebAssembly, self-hosted — sem
depender de CDN). Login simples por usuario/senha, com save automatico por
usuario (sincroniza o "save" nativo do jogo, o SharedObject do Flash, com o
servidor). Funciona no celular com controles na tela, configuraveis por jogo.
Biblioteca com busca e filtro por categoria, visual cyberpunk/glassmorphism
com capas neon geradas para cada jogo.

Segue o mesmo padrao dos outros apps em `/pendriver` rodando via Coolify
(Traefik + rede `coolify` externa) — fica em `/pendriver/FlashGames`.

## Estrutura

```
FlashGames/
  backend/        API Express (login, biblioteca de jogos, saves) + serve o front buildado
  frontend/       SPA em React + Vite (login, biblioteca, player)
  games/          um diretorio por jogo: manifest.json + arquivo .swf (bind mount)
  docker-compose.yml
  Dockerfile      build multi-stage: baixa o Ruffle self-hosted, builda o front, empacota o backend
```

## Como funciona

- **Ruffle self-hosted**: o `Dockerfile` baixa o pacote oficial
  `ruffle-<versao>-web-selfhosted.zip` das releases do
  [ruffle-rs/ruffle](https://github.com/ruffle-rs/ruffle/releases) no build da
  imagem (versao fixada em `ARG RUFFLE_VERSION`, ver topo do `Dockerfile`) e
  serve os arquivos em `/vendor/ruffle`. Nada de CDN externo em runtime.
- **Login**: usuario + senha (bcrypt). Se o usuario nao existe, a conta e
  criada na hora do primeiro login. Sessao fica num cookie httpOnly assinado
  (JWT, 30 dias).
- **Saves por usuario**: o Ruffle emula o SharedObject do Flash (o save nativo
  dos jogos, tipo highscore/progresso) usando `localStorage` do navegador.
  O frontend sincroniza essas chaves com o backend a cada ~10s e ao sair da
  pagina, por usuario logado — ver `frontend/src/ruffleSave.ts`. Ao entrar
  num jogo, ele limpa do navegador qualquer chave conhecida daquele jogo e
  restaura so as do usuario atual (evita vazar save de outra pessoa no mesmo
  navegador/dispositivo compartilhado).
- **Controles no celular**: cada jogo pode declarar `controls` no
  `manifest.json` (d-pad, d-pad duplo pra jogos de 2 jogadores, analogico de
  mira/tiro, botoes extras). Em telas touch os controles aparecem
  automaticamente; tem um botao 🎮 pra ligar/desligar manualmente. Detalhes
  em `games/README.md`.
  - **Celular na vertical**: o jogo fica no tamanho normal em cima e os
    controles viram um "deck" de gamepad abaixo dele, com uma imagem de
    fundo de um portatil de jogos futurista (`frontend/public/images/handheld-bg.webp`).
  - **Celular na horizontal**: o jogo vai pra tela cheia (preservando a
    proporcao original — sem esticar) e os controles sobrepoem o jogo,
    redimensionados pra caber na tela curta.
  - Os toques sao traduzidos pra eventos de verdade que o Ruffle escuta: teclado
    (`keydown`/`keyup` em `window`, so processados quando o player esta em foco —
    por isso todo toque tambem chama `.focus()` no player) e ponteiro
    (`PointerEvent` disparado direto no `<canvas>` dentro da shadow root do
    `<ruffle-player>`, nao um `MouseEvent` solto em qualquer elemento).
- **Biblioteca de jogos dinamica**: o backend le `/app/games` (bind mount de
  `/pendriver/FlashGames/games`) a cada request de listagem — adicionar um
  jogo e so criar a pasta com `manifest.json` + `.swf`, sem rebuild. Ver
  `games/README.md`.
- **Busca e filtro por categoria**: a biblioteca tem busca por titulo/descricao/tags
  (acento-insensivel) e chips de categoria com contagem (`Acao`, `Estrategia`,
  `Puzzle`, `Plataforma`, `Arcade` — configuravel em `frontend/src/categories.ts`).
- **Visual**: tema cyberpunk/glassmorphism (fontes Chakra Petch + Inter
  self-hosted, painéis com blur e borda neon, glow por categoria) — ver
  `frontend/src/styles.css`.
- **PWA**: da pra "instalar" o site (Android/desktop: "Adicionar a tela
  inicial"/"Instalar app"; iOS Safari: Compartilhar → "Adicionar a Tela de
  Inicio") — abre em tela cheia sem barra do navegador. O service worker
  (`frontend/public/sw.js`) so cacheia o Ruffle e os `.swf` dos jogos
  (stale-while-revalidate — carregam instantaneo depois da primeira vez); o
  resto (API, HTML, JS do app) sempre vai direto pra rede, pra nunca mostrar
  tela ou save desatualizado.

## Jogos inclusos

10 jogos originais (sem IP de terceiros tipo Disney/Nintendo/Sega), todos
baixados de itens publicos do Internet Archive verificados contra malware
pela curadoria do IA — o link de origem de cada um esta no campo `source`
do respectivo `manifest.json`:

| Jogo | Categoria |
| --- | --- |
| Boxhead 2Play: The Rooms | Ação |
| The Last Stand: Union City | Ação |
| Bloons Tower Defense | Estratégia |
| Stick War | Estratégia |
| Snail Bob | Puzzle |
| Fireboy and Watergirl: Forest Temple | Plataforma |
| Achievement Unlocked | Plataforma |
| Learn to Fly | Arcade |
| Toss the Turtle | Arcade |
| Effing Worms | Arcade |

Ver `games/README.md` pra detalhes sobre como as capas foram geradas e como
adicionar mais jogos.

## Rodando localmente (sem Docker)

Backend:

```bash
cd backend
npm install
SESSION_SECRET=dev-secret-bem-longo-1234567890 DATA_DIR=../data GAMES_DIR=../games PORT=4070 npm start
```

Frontend (outro terminal, com proxy pro backend em `:4070` configurado no
`vite.config.ts`):

```bash
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Rodando com Docker

```bash
cd /pendriver/FlashGames
cp .env.example .env   # edite o SESSION_SECRET
docker compose build
docker compose up -d
```

App sobe em `:4070` dentro do container, exposto publicamente via Traefik em
`https://flashgames.gvtserver.online` (rede `coolify` externa — precisa
existir no host, igual aos outros apps).

No Coolify: aponte o app pra este `docker-compose.yml` (build context
`/pendriver/FlashGames`). A unica variavel obrigatoria e o `SESSION_SECRET` — tudo mais
ja tem valor padrao (`CORS_ORIGIN` cai pro dominio do Traefik automaticamente).
Se usar um dominio diferente de `flashgames.gvtserver.online`, troque nos
labels do Traefik aqui no `docker-compose.yml` e no `CORS_ORIGIN`.

### Roteamento via Coolify Proxy (alternativa aos labels)

O `docker-compose.yml` ja tem os labels do Traefik e funciona sozinho — nao
precisa de mais nada na maioria dos casos. Se preferir configurar o
roteamento manualmente pela aba **Server > Proxy > Dynamic Configurations**
do Coolify (em vez de depender dos labels do compose), use o
`flashgames-proxy.yml` deste repositorio: cole o conteudo dele la. **Nao
ative os dois ao mesmo tempo** para o mesmo dominio — duplica os roteadores
no Traefik.

## Adicionando mais jogos

Ver `games/README.md`.
