# FlashGames

App auto-hospedado para jogar jogos em Flash (.swf) no navegador usando o
[Ruffle](https://ruffle.rs) (emulador Flash em WebAssembly, self-hosted — sem
depender de CDN). Login simples por usuario/senha, com save automatico por
usuario (sincroniza o "save" nativo do jogo, o SharedObject do Flash, com o
servidor). Funciona no celular com controles na tela, configuraveis por jogo.

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
  `manifest.json` (d-pad, analogico de mira/tiro, botoes extras). Em telas
  touch os controles aparecem automaticamente sobre o jogo; tem um botao 🎮
  pra ligar/desligar manualmente. Detalhes em `games/README.md`.
- **Biblioteca de jogos dinamica**: o backend le `/app/games` (bind mount de
  `/pendriver/FlashGames/games`) a cada request de listagem — adicionar um
  jogo e so criar a pasta com `manifest.json` + `.swf`, sem rebuild. Ver
  `games/README.md`.
- **PWA**: da pra "instalar" o site (Android/desktop: "Adicionar a tela
  inicial"/"Instalar app"; iOS Safari: Compartilhar → "Adicionar a Tela de
  Inicio") — abre em tela cheia sem barra do navegador. O service worker
  (`frontend/public/sw.js`) so cacheia o Ruffle e os `.swf` dos jogos
  (stale-while-revalidate — carregam instantaneo depois da primeira vez); o
  resto (API, HTML, JS do app) sempre vai direto pra rede, pra nunca mostrar
  tela ou save desatualizado.

## Jogo incluso: Boxhead 2Play — The Rooms

Baixado do item publico do Internet Archive
[`378950-boxhead-2-play-rooms`](https://archive.org/details/378950-boxhead-2-play-rooms)
(colecao `open_source_software`, verificado contra malware pela curadoria do
IA). E o arquivo `games/boxhead-2-play-rooms/game.swf`.

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

## Adicionando mais jogos

Ver `games/README.md`.
