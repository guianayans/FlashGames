import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { PlayHistoryEntry } from "../api";
import type { GameSummary } from "../types";
import { useAuth } from "../auth/AuthContext";
import { systemMeta } from "../categories";
import ConfirmDialog from "../components/ConfirmDialog";

// Tela pequena (mesmo corte de 700px usado no resto do CSS pra layout
// mobile) — cards expansiveis (Favoritos/Top Games/Recentes) comecam
// FECHADOS por padrao nela, pra nao jogar uma lista enorme na cara logo
// de cara num aparelho pequeno. Reage a girar o celular/redimensionar.
function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(() => typeof window !== "undefined" && window.innerWidth <= 700);
  useEffect(() => {
    function onResize() {
      setSmall(window.innerWidth <= 700);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return small;
}

// Estado de "aberto/fechado" de um grupo de cards expansiveis (por
// console ou por Recentes) — cada card so' guarda uma EXCECAO ao padrao
// (isCollapsed retorna o padrao ate o usuario clicar nele uma vez), pra
// nao precisar saber os slugs/keys de todos os grupos com antecedencia
// so' pra "marcar tudo fechado" quando a tela e' pequena.
function useCollapsibleGroups(defaultCollapsed: boolean) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  // useCallback (nao funcao solta) pra "isCollapsed"/"toggle" so trocarem
  // de referencia quando overrides/defaultCollapsed realmente mudam — sem
  // isso, todo useMemo que depende deles (ver "paged") recalcularia em
  // QUALQUER renderizacao da pagina, nao so quando um card e' aberto/
  // fechado de verdade.
  const isCollapsed = useCallback((key: string) => overrides.get(key) ?? defaultCollapsed, [overrides, defaultCollapsed]);
  const toggle = useCallback((key: string) => {
    setOverrides((prev) => {
      const current = prev.get(key) ?? defaultCollapsed;
      const next = new Map(prev);
      next.set(key, !current);
      return next;
    });
  }, [defaultCollapsed]);
  return { isCollapsed, toggle };
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Renderizar os ~2500 cards de uma vez deixava a pagina pesada pra montar,
// principalmente no celular — pagina em blocos de PAGE_SIZE em vez de
// jogar tudo no DOM de uma vez. (Ja testamos paginar por letra inteira —
// desfeito: isso exigia reordenar a lista so' alfabeticamente, perdendo o
// "capa primeiro" que o backend ja manda, ver listGames() em
// gamesLibrary.js.)
const PAGE_SIZE = 48;

// "#" agrupa titulos que comecam com numero (bem comuns nessa colecao, ex.
// "3 Ninjas Kick Back") — sem isso ficariam de fora do filtro por letra.
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

// Layout QWERTY do "teclado" do modo controle (ver keyboardMode) — so'
// usado quando o overlay A-Z vira teclado de digitar; o filtro por letra
// normal (mouse/toque) continua com o ALPHABET de cima, sem mudar.
const QWERTY_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function titleBucket(title: string): string {
  const first = normalize(title).trim()[0] ?? "";
  return /[0-9]/.test(first) ? "#" : first.toUpperCase();
}

// Chave da posicao de scroll salva no sessionStorage, por combinacao de
// filtro/pagina (a propria query string ja identifica isso).
function scrollKey(search: string): string {
  return `library-scroll:${search}`;
}

// Um data-bp-id de card e' "card:slug" (grade normal/por console) ou
// "card:escopo:slug" (dentro de Recentes, ver renderGameCard) — slug
// nunca tem ":" (sai de slugify()), entao o ULTIMO pedaço sempre e' o
// slug de verdade, nos dois formatos.
function slugFromCardId(id: string): string {
  const parts = id.split(":");
  return parts[parts.length - 1];
}

export default function Library() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [plays, setPlays] = useState<PlayHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Toggle "capas em tamanho original" — por usuario, salvo no banco (ver
  // routes/preferences.js), pra continuar valendo em qualquer aparelho
  // que ele entrar, nao so localStorage deste navegador.
  const [originalCovers, setOriginalCovers] = useState(false);

  // Busca, sistema, favoritos e pagina vivem na URL (searchParams) em vez de
  // useState puro — assim, ao abrir um jogo (navigate) e voltar
  // (navigate(-1) no Player, ver useLibraryBack), o navegador restaura essa
  // MESMA URL e a pesquisa aparece exatamente como o usuario deixou, sem
  // precisar recarregar a pagina.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const activeSystem = searchParams.get("system") ?? "todos";
  const favoritesOnly = searchParams.get("fav") === "1";
  const topOnly = searchParams.get("top") === "1";
  const recentOnly = searchParams.get("recent") === "1";
  const letter = searchParams.get("letter") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [alphaOpen, setAlphaOpen] = useState(false);

  // Modo "Big Picture" — navegar a biblioteca inteira sem mouse/toque, so
  // com o controle fisico. Liga sozinho ao apertar QUALQUER botao/
  // analogico do controle (mesmo se ja estava "pausado" por ter usado
  // teclado/mouse depois); desliga sozinho ao digitar no teclado ou
  // mexer o mouse — sem toggle manual (Select nao faz mais nada aqui,
  // fica livre pra abrir o menu de save state dentro do jogo).
  const [gamepadActive, setGamepadActive] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);
  const [bigPictureOn, setBigPictureOn] = useState(false);
  // Setas do teclado navegam a mesma grade espacial do controle (ver
  // moveFocus/confirmFocused/toggleFocusedCardGroup) — precisa de um
  // flag PROPRIO (nao reaproveita gamepadActive, que e' so' sobre
  // hardware de controle de verdade conectado) so' pra decidir quando
  // mostrar o aneal de foco (.bp-focused) puxado pelo teclado. Desliga
  // sozinho ao usar o mouse, igual o bigPictureOn do controle faz.
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const focusVisible = gamepadActive || keyboardNavActive;
  // Id unificado de foco — cobre a pagina inteira, nao so os cards:
  // "search", "alpha-trigger", "chip:todos"/"chip:fav"/"chip:top"/
  // "chip:system:<slug>", "card:<slug>", "page:prev"/"page:next".
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const bigPictureOnRef = useRef(bigPictureOn);
  bigPictureOnRef.current = bigPictureOn;
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  // Espelhos pra ler estado sempre atual de dentro do loop de poll do
  // gamepad (aquele efeito so roda uma vez — ver comentario mais abaixo —
  // entao closures que leem estado direto ficariam presas no valor da
  // primeira renderizacao).
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Desfavoritar pede confirmacao (favoritar de novo e' facil, mas alguns
  // usuarios organizam a lista com cuidado — um toque sem querer no
  // controle ou no card nao pode desfazer isso sem avisar). So' o slug
  // pendente de confirmacao (null = nenhum dialogo aberto).
  const [confirmUnfavoriteSlug, setConfirmUnfavoriteSlug] = useState<string | null>(null);
  const confirmUnfavoriteRef = useRef(confirmUnfavoriteSlug);
  confirmUnfavoriteRef.current = confirmUnfavoriteSlug;

  // No modo controle, o overlay A-Z vira teclado (letra focada = digitar
  // na busca, em vez de pular pro filtro por letra inicial) — "" = nada
  // focado ainda, "__ALL__" = o chip "Todos" (aqui vira "apagar tudo").
  const [overlayFocusedKey, setOverlayFocusedKey] = useState("");
  const overlayFocusedKeyRef = useRef(overlayFocusedKey);
  overlayFocusedKeyRef.current = overlayFocusedKey;
  const alphaOpenRef = useRef(alphaOpen);
  alphaOpenRef.current = alphaOpen;
  const keyboardMode = gamepadActive && bigPictureOn;
  const keyboardModeRef = useRef(keyboardMode);
  keyboardModeRef.current = keyboardMode;
  const queryRef = useRef(query);
  queryRef.current = query;
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Digitar uma letra/numero em QUALQUER lugar da pagina (sem estar com
  // foco em nada especifico) foca a busca e ja "digita" essa primeira
  // tecla nela, em vez de precisar clicar no campo antes — igual o
  // Steam/Windows Explorer fazem. So nao entra em acao se o foco ja
  // esta num campo de texto (deixa o typing normal acontecer), se tem
  // modificador (Ctrl/Alt/Cmd — atalho do navegador, nao digitacao) ou
  // se o overlay A-Z esta aberto (ele tem o proprio fluxo de letras).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (alphaOpenRef.current) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (!/^[a-zA-Z0-9]$/.test(e.key)) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      updateFilters({ q: (queryRef.current || "") + e.key });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setas do teclado navegam a MESMA grade espacial que o controle usa
  // (moveFocus/confirmFocused/toggleFocusedCardGroup — os mesmos que o
  // poll do gamepad chama mais abaixo). Enter confirma/abre o foco atual
  // (equivalente ao botao de baixo do controle), Espaco abre/fecha o
  // card expansivel focado (equivalente ao Quadrado). Mesmas guardas do
  // efeito de "digitar ja pesquisa" acima (nao rouba de campo de texto,
  // nao mexe com Ctrl/Alt/Cmd, ignora com o overlay A-Z aberto) mais o
  // dialogo de confirmar desfavoritar (que tem o proprio controle via
  // ConfirmDialog, ver confirmUnfavoriteRef).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (alphaOpenRef.current) return;
      if (confirmUnfavoriteRef.current) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setKeyboardNavActive(true);
          moveFocus("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          setKeyboardNavActive(true);
          moveFocus("down");
          break;
        case "ArrowLeft":
          e.preventDefault();
          setKeyboardNavActive(true);
          moveFocus("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          setKeyboardNavActive(true);
          moveFocus("right");
          break;
        case "Enter":
          e.preventDefault();
          setKeyboardNavActive(true);
          confirmFocused();
          break;
        case " ":
        case "Spacebar":
          e.preventDefault();
          setKeyboardNavActive(true);
          toggleFocusedCardGroup();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Puxar a tela pra baixo (no topo) atualiza a lista — Safari/PWA no iOS
  // nao tem pull-to-refresh nativo (diferente do Chrome/Android), entao
  // esse gesto e essa UI sao 100% nossos.
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const pullState = useRef<{ startX: number; startY: number; active: boolean } | null>(null);

  // Forma funcional do setSearchParams (le o PREV mais atual sempre, na
  // hora em que roda de verdade) — necessario porque o loop de poll do
  // gamepad chama isso de dentro de um efeito que so monta uma vez; sem
  // isso, um updateFilters/goToPage disparado pelo controle reconstruiria
  // a URL a partir do searchParams "congelado" da primeira renderizacao,
  // desfazendo qualquer filtro mudado depois.
  function updateFilters(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        next.delete("page"); // filtro mudou, volta pra pagina 1
        return next;
      },
      { replace: true }
    );
  }

  function goToPage(p: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p <= 1) next.delete("page");
        else next.set("page", String(p));
        return next;
      },
      { replace: true }
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadLibrary() {
    try {
      const res = await api.listGames();
      setGames(res.games);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar jogos");
    }
    try {
      const res = await api.listFavorites();
      setFavorites(new Set(res.slugs));
    } catch {
      // sem favoritos carregados, so a estrela fica sem estado — nao
      // impede o resto da biblioteca de funcionar.
    }
    try {
      const res = await api.getPreferences();
      setOriginalCovers(res.originalCovers);
    } catch {
      // sem preferencia carregada, fica no padrao (capas cortadas) — nao
      // impede o resto da biblioteca de funcionar.
    }
    try {
      const res = await api.listPlays();
      setPlays(res.plays);
    } catch {
      // sem historico carregado, o filtro Recentes so fica vazio — nao
      // impede o resto da biblioteca de funcionar.
    }
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  async function toggleOriginalCovers() {
    const next = !originalCovers;
    setOriginalCovers(next);
    try {
      await api.updatePreferences(next);
    } catch {
      // falhou salvar no servidor - a troca visual ja aconteceu, so nao
      // persiste pra proxima visita/aparelho.
    }
  }

  const PULL_THRESHOLD = 64;
  const PULL_MAX = 96;

  // touchmove precisa ser um listener NATIVO (nao onTouchMove do JSX): o
  // React anexa o handler de touchmove como passive por padrao, entao
  // preventDefault() dentro do synthetic event NAO bloqueia o bounce
  // nativo do Safari — sem isso os dois gestos (o nosso indicador + o
  // rubber-band do iOS) brigam e ficam tremendo na tela.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || refreshing) {
        pullState.current = null;
        return;
      }
      pullState.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, active: true };
    }

    function onTouchMove(e: TouchEvent) {
      const state = pullState.current;
      if (!state?.active) return;
      const deltaX = e.touches[0].clientX - state.startX;
      const deltaY = e.touches[0].clientY - state.startY;
      // Gesto mais horizontal que vertical (ex.: arrastando os chips de
      // filtro pros lados, ver .category-row) NAO e' puxar-pra-atualizar
      // — solta o rastreio SEM preventDefault, deixando o scroll
      // horizontal nativo do navegador acontecer. Sem isso, qualquer
      // arrastada horizontal com o MINIMO desvio vertical (quase toda —
      // poucas pessoas arrastam perfeitamente reto) fazia o
      // preventDefault() do pull-to-refresh bloquear o scroll dos
      // filtros, travando a pagina no topo.
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        state.active = false;
        setPullDistance(0);
        return;
      }
      if (deltaY <= 0 || window.scrollY > 0) {
        state.active = false;
        setPullDistance(0);
        return;
      }
      e.preventDefault();
      setPullDistance(Math.min(PULL_MAX, deltaY * 0.5));
    }

    async function onTouchEnd() {
      const state = pullState.current;
      pullState.current = null;
      if (!state?.active) return;
      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true);
          loadLibrary().finally(() => {
            setRefreshing(false);
            setPullDistance(0);
          });
          return PULL_THRESHOLD;
        }
        return 0;
      });
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing]);

  // Favoritar e' direto; desfavoritar pede confirmacao antes (ver
  // confirmUnfavoriteSlug) — so' abre o dialogo quando o jogo JA esta
  // favoritado, senao chama toggleFavorite direto como sempre.
  function requestToggleFavorite(slug: string) {
    if (favoritesRef.current.has(slug)) setConfirmUnfavoriteSlug(slug);
    else toggleFavorite(slug);
  }

  async function toggleFavorite(slug: string) {
    // favoritesRef (nao o "favorites" direto): o loop de poll do gamepad
    // chama esta funcao de dentro de um efeito que so monta uma vez, entao
    // "favorites" fechado na closure ficaria sempre no valor inicial
    // (Set vazio) — sempre tentaria ADICIONAR, nunca remover.
    const wasFavorite = favoritesRef.current.has(slug);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(slug);
      else next.add(slug);
      return next;
    });
    try {
      if (wasFavorite) await api.removeFavorite(slug);
      else await api.addFavorite(slug);
    } catch {
      // falhou no servidor - desfaz o otimista
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(slug);
        else next.delete(slug);
        return next;
      });
    }
  }

  const systems = useMemo(() => {
    const seen = new Map<string, number>();
    for (const g of games) {
      seen.set(g.system, (seen.get(g.system) || 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [games]);
  const systemsRef = useRef(systems);
  systemsRef.current = systems;

  const playsBySlug = useMemo(() => new Map(plays.map((p) => [p.slug, p])), [plays]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return games.filter((g) => {
      if (favoritesOnly && !favorites.has(g.slug)) return false;
      // g.top ja vem do backend somando a lista curada + favoritos do
      // usuario (ver routes/games.js), mas so no momento do fetch inicial
      // — sem isso, favoritar um jogo so o levaria pra Top Games depois
      // de recarregar a pagina. favorites.has aqui deixa isso dinamico na
      // hora, sem precisar buscar a lista de novo.
      if (topOnly && !g.top && !favorites.has(g.slug)) return false;
      if (recentOnly && !playsBySlug.has(g.slug)) return false;
      if (activeSystem !== "todos" && g.system !== activeSystem) return false;
      if (letter && titleBucket(g.title) !== letter) return false;
      if (!q) return true;
      const haystack = normalize([g.title, g.description, g.category, ...(g.tags || [])].join(" "));
      return haystack.includes(q);
    });
  }, [games, query, activeSystem, favoritesOnly, favorites, topOnly, recentOnly, playsBySlug, letter]);

  // Favoritos/Top Games (sem filtro de sistema aplicado) separam por
  // console em cards expansiveis, em vez da grade paginada normal — sao
  // listas curtas o bastante pra mostrar tudo de uma vez, e olhar "so os
  // meus jogos de SNES favoritados" (por exemplo) fica mais facil
  // dobrando os outros consoles pra fora do caminho.
  const groupedByConsole = (favoritesOnly || topOnly) && activeSystem === "todos";
  const isSmallScreen = useIsSmallScreen();
  const systemGroups = useCollapsibleGroups(isSmallScreen);
  const gamesBySystem = useMemo(() => {
    const map = new Map<string, GameSummary[]>();
    for (const g of filtered) {
      const list = map.get(g.system);
      if (list) list.push(g);
      else map.set(g.system, [g]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  // Recentes (sem filtro de sistema aplicado) tambem sai do grid/paginacao
  // normal, mas com um eixo de agrupamento diferente do Favoritos/Top: em
  // vez de por console, sao so 2 cards fixos — "Mais recentes" (ordenado
  // pela ultima vez jogado) e "Mais jogados" (pela quantidade de vezes) —
  // cada um limitado a RECENT_CARD_LIMIT pra nao virar uma lista enorme
  // com o tempo.
  const showRecentCards = recentOnly && activeSystem === "todos";
  const RECENT_CARD_LIMIT = 30;
  const recentCards = useMemo(() => {
    if (!showRecentCards) return [];
    const withPlay = filtered
      .map((g) => ({ game: g, play: playsBySlug.get(g.slug) }))
      .filter((x): x is { game: GameSummary; play: PlayHistoryEntry } => !!x.play);
    const mostRecent = [...withPlay]
      .sort((a, b) => b.play.lastPlayedAt.localeCompare(a.play.lastPlayedAt))
      .slice(0, RECENT_CARD_LIMIT)
      .map((x) => x.game);
    const mostPlayed = [...withPlay]
      .sort((a, b) => b.play.playCount - a.play.playCount)
      .slice(0, RECENT_CARD_LIMIT)
      .map((x) => x.game);
    return [
      { key: "recent", label: "Mais recentes", games: mostRecent },
      { key: "played", label: "Mais jogados", games: mostPlayed },
    ];
  }, [filtered, playsBySlug, showRecentCards]);
  const recentGroups = useCollapsibleGroups(isSmallScreen);

  // Pra desabilitar no overlay as letras sem nenhum jogo correspondente.
  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) set.add(titleBucket(g.title));
    return set;
  }, [games]);

  const pageCount = groupedByConsole || showRecentCards ? 1 : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = useMemo(() => {
    if (groupedByConsole) return filtered.filter((g) => !systemGroups.isCollapsed(g.system));
    if (showRecentCards) {
      const shown = new Set<string>();
      for (const card of recentCards) {
        if (recentGroups.isCollapsed(card.key)) continue;
        for (const g of card.games) shown.add(g.slug);
      }
      return filtered.filter((g) => shown.has(g.slug));
    }
    return filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  }, [filtered, pageSafe, groupedByConsole, systemGroups.isCollapsed, showRecentCards, recentCards, recentGroups.isCollapsed]);

  // Refs "espelho" pros valores que o loop de poll do gamepad precisa —
  // assim o efeito abaixo roda so UMA vez (nao precisa reconectar os
  // listeners a cada tecla digitada na busca) e ainda assim sempre le o
  // valor mais recente, sem closure velha.
  const pagedRef = useRef(paged);
  pagedRef.current = paged;
  const pageSafeRef = useRef(pageSafe);
  pageSafeRef.current = pageSafe;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  // Se a lista mudar (filtro, pagina, refresh) e o foco atual (quando e'
  // um card) sumir dela, realinha pro primeiro card — so depois que o
  // modo controle ja foi ativado (senao ficaria destacando algo sem
  // ninguem ter pedido). Foco em outra coisa (busca, chips, paginacao)
  // fica igual — esses ids nao desaparecem com filtro/pagina.
  useEffect(() => {
    if (!focusVisible) return;
    // Le o primeiro card de verdade do DOM (nao monta "card:"+slug na
    // mao) — em Recentes o id de cada card e' "card:escopo:slug" (ver
    // renderGameCard), entao construir so' com o slug apontaria pra um
    // id que nao existe em lugar nenhum.
    function firstCardId(): string | null {
      return document.querySelector<HTMLElement>('.game-grid [data-bp-id^="card:"]')?.dataset.bpId ?? null;
    }
    const id = focusedId;
    if (!id) {
      const first = firstCardId();
      if (first) setFocusedId(first);
      return;
    }
    if (id.startsWith("card:")) {
      const slug = slugFromCardId(id);
      if (!paged.some((g) => g.slug === slug)) {
        setFocusedId(firstCardId() ?? "alpha-trigger");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusVisible, paged]);

  function focusId(id: string) {
    setFocusedId(id);
    // Chegar em QUALQUER chip de filtro (Todos, Favoritos, Top Games,
    // Recentes, sistema...) sobe a tela inteira, nao so o minimo pra
    // revelar o chip — eles ficam logo abaixo da busca/topbar, entao
    // "nearest" deixava a top bar cortada as vezes.
    if (id.startsWith("chip:")) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-bp-id="${CSS.escape(id)}"]`);
    // behavior "auto" (instantaneo) de proposito — com "smooth", segurar
    // uma direcao pra repetir o movimento chamava moveFocus() de novo NO
    // MEIO da animacao de rolagem anterior, entao getBoundingClientRect()
    // media posicoes "em transito" e a navegacao ficava erratica bem no
    // caso que mais importa (segurar pra passar varias linhas rapido).
    el?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  // Navegacao espacial cobrindo a PAGINA INTEIRA (busca, trigger A-Z,
  // chips de categoria, cards, paginacao) — nao so a grade de jogos.
  // Todo elemento navegavel tem um [data-bp-id]; pra cada direcao, acha o
  // elemento mais proximo NAQUELA direcao (medindo a posicao real na
  // tela, ja que a grade e' responsiva — auto-fill — e o numero de
  // colunas muda com o tamanho da janela). Peso maior no eixo cruzado
  // pra esquerda/direita (fica "na mesma linha") do que pra cima/baixo
  // (trocar de secao/linha e' o proprio objetivo desses dois).
  function moveFocus(dir: "up" | "down" | "left" | "right") {
    const all = Array.from(document.querySelectorAll<HTMLElement>("[data-bp-id]"));
    if (all.length === 0) return;
    const currentId = focusedIdRef.current;
    const currentEl = currentId ? all.find((el) => el.dataset.bpId === currentId) : null;
    if (!currentEl) {
      const first = all[0]?.dataset.bpId;
      if (first) focusId(first);
      return;
    }
    const cur = currentEl.getBoundingClientRect();
    const curCx = cur.left + cur.width / 2;
    const curCy = cur.top + cur.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === currentEl) continue;
      const r = el.getBoundingClientRect();
      const dxCenter = r.left + r.width / 2 - curCx;
      const dyCenter = r.top + r.height / 2 - curCy;
      // Penalidade no eixo PERPENDICULAR usa a distancia entre as BORDAS
      // (0 se as faixas se sobrepoem), nao centro-a-centro — sem isso, o
      // cabeçalho do card mais proximo dos filtros (que cobre a largura
      // inteira do grupo) media uma distancia horizontal GRANDE ate um
      // jogo numa coluna extrema (comparado ao proprio CENTRO do
      // cabeçalho), perdendo pra um chip de filtro estreito que por
      // acaso calha de ficar alinhado com aquela coluna — apertar pra
      // cima de um jogo no topo pulava pros filtros em vez de ir pro
      // cabeçalho do proprio card (so acontecia no card mais alto, os de
      // baixo tem o filtro longe o bastante pra nao competir).
      const rangeGap = (aStart: number, aEnd: number, bStart: number, bEnd: number) => {
        if (aEnd < bStart) return bStart - aEnd;
        if (bEnd < aStart) return aStart - bEnd;
        return 0;
      };
      let score: number;
      if (dir === "right") {
        if (dxCenter <= 4) continue;
        score = dxCenter + rangeGap(cur.top, cur.bottom, r.top, r.bottom) * 4;
      } else if (dir === "left") {
        if (dxCenter >= -4) continue;
        score = -dxCenter + rangeGap(cur.top, cur.bottom, r.top, r.bottom) * 4;
      } else if (dir === "down") {
        if (dyCenter <= 4) continue;
        score = dyCenter + rangeGap(cur.left, cur.right, r.left, r.right) * 1.2;
      } else {
        if (dyCenter >= -4) continue;
        score = -dyCenter + rangeGap(cur.left, cur.right, r.left, r.right) * 1.2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best?.dataset.bpId) focusId(best.dataset.bpId);
  }

  function confirmFocused() {
    const id = focusedIdRef.current;
    if (!id) return;
    if (id.startsWith("card:")) {
      saveScroll();
      navigate(`/play/${slugFromCardId(id)}`);
      return;
    }
    // Busca e o trigger A-Z levam pro mesmo lugar: o overlay A-Z e' o
    // "teclado" do modo controle (ver keyboardMode) — nao da pra digitar
    // com o cursor do gamepad num <input> sem teclado fisico.
    if (id === "search" || id === "alpha-trigger") {
      setAlphaOpen(true);
      return;
    }
    // Os chips (Todos/Favoritos/Top Games/sistema) sao mutuamente
    // exclusivos — so um fica ativo por vez, "Todos" e' o estado "nenhum
    // filtro de categoria". Por isso cada ramo sempre zera os outros dois
    // junto (senao ficava acumulando: escolhe Favoritos, depois um
    // sistema, e os dois ficam "ligados" ao mesmo tempo sem dar pra tirar
    // so um).
    const sp = searchParamsRef.current;
    if (id === "chip:todos") {
      updateFilters({ system: null, fav: null, top: null, recent: null });
    } else if (id === "chip:fav") {
      updateFilters({ system: null, top: null, recent: null, fav: sp.get("fav") === "1" ? null : "1" });
    } else if (id === "chip:top") {
      updateFilters({ system: null, fav: null, recent: null, top: sp.get("top") === "1" ? null : "1" });
    } else if (id === "chip:recent") {
      updateFilters({ system: null, fav: null, top: null, recent: sp.get("recent") === "1" ? null : "1" });
    } else if (id.startsWith("chip:system:")) {
      const slug = id.slice(12);
      const curSystem = sp.get("system") ?? "todos";
      updateFilters({ fav: null, top: null, recent: null, system: curSystem === slug ? null : slug });
    } else if (id.startsWith("group:system:")) {
      // Cabecalho de um card expansivel (Favoritos/Top Games por
      // console) — X abre/fecha, igual clicar nele com mouse/toque.
      systemGroups.toggle(id.slice(13));
    } else if (id.startsWith("group:recent:")) {
      // Mesma coisa pros 2 cards fixos de Recentes (Mais recentes/Mais
      // jogados).
      recentGroups.toggle(id.slice(13));
    } else if (id === "page:prev") {
      goToPage(pageSafeRef.current - 1);
    } else if (id === "page:next") {
      goToPage(Math.min(pageCountRef.current, pageSafeRef.current + 1));
    }
  }

  // L1/R1 alternam entre os filtros (Todos/Recentes/Favoritos/Top Games/
  // cada sistema), na MESMA ordem em que os chips aparecem na tela — ao
  // contrario do X num chip focado (que so alterna liga/desliga O MESMO
  // filtro), aqui sempre anda pra frente/tras na lista inteira, dando a
  // volta nas pontas.
  function chipOrder(): string[] {
    return ["chip:todos", "chip:recent", "chip:fav", "chip:top", ...systemsRef.current.map(([slug]) => `chip:system:${slug}`)];
  }
  function currentChipKey(): string {
    const sp = searchParamsRef.current;
    if (sp.get("fav") === "1") return "chip:fav";
    if (sp.get("top") === "1") return "chip:top";
    if (sp.get("recent") === "1") return "chip:recent";
    const sys = sp.get("system");
    if (sys) return `chip:system:${sys}`;
    return "chip:todos";
  }
  function applyChipFilter(id: string) {
    if (id === "chip:todos") {
      updateFilters({ system: null, fav: null, top: null, recent: null });
    } else if (id === "chip:fav") {
      updateFilters({ system: null, top: null, recent: null, fav: "1" });
    } else if (id === "chip:top") {
      updateFilters({ system: null, fav: null, recent: null, top: "1" });
    } else if (id === "chip:recent") {
      updateFilters({ system: null, fav: null, top: null, recent: "1" });
    } else if (id.startsWith("chip:system:")) {
      updateFilters({ fav: null, top: null, recent: null, system: id.slice(12) });
    }
    // Trocar de filtro pelo atalho do controle (L1/R1) sobe a tela
    // inteira, igual ja acontece ao trocar de pagina (ver goToPage) —
    // senao o usuario troca de filtro no meio da lista rolada e a grade
    // nova comeca fora da vista.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cycleChip(dir: 1 | -1) {
    const order = chipOrder();
    const idx = order.indexOf(currentChipKey());
    const nextIdx = ((idx === -1 ? 0 : idx) + dir + order.length) % order.length;
    applyChipFilter(order[nextIdx]);
  }

  // Quadrado com o foco num CARD (ou ja no proprio cabeçalho) dentro de
  // um card expansivel (Favoritos/Top Games por console, Recentes)
  // recolhe/expande ele na hora, sem precisar voltar ate o cabeçalho e
  // confirmar com X — acha o ".console-group" mais proximo na tela (nao
  // pelo id logico, pelo DOM mesmo, ja que o mesmo jogo pode aparecer em
  // mais de um card em Recentes) e alterna. Depois de fechar (o card em
  // si some da grade), o foco vai pro CABEÇALHO do grupo — assim ele
  // fica visivel e continua respondendo ao Quadrado, dando pra apertar
  // varias vezes seguidas alternando aberto/fechado sem o foco se
  // perder pra outro lugar. So' entra em uso na navegacao NORMAL da
  // grade (ver poll() mais abaixo) — o overlay A-Z/teclado do modo
  // controle e' um branch totalmente separado (early return antes de
  // chegar aqui), entao nao conflita com o Quadrado la dentro (que so'
  // SELECIONA a letra focada, ver confirmOverlaySelectFilter).
  function toggleFocusedCardGroup() {
    const id = focusedIdRef.current;
    if (!id || !(id.startsWith("card:") || id.startsWith("group:"))) return;
    const el = document.querySelector<HTMLElement>(`[data-bp-id="${CSS.escape(id)}"]`);
    const groupEl = el?.closest<HTMLElement>(".console-group");
    const key = groupEl?.dataset.groupKey;
    const type = groupEl?.dataset.groupType;
    if (!key || !type) return;
    if (type === "system") systemGroups.toggle(key);
    else if (type === "recent") recentGroups.toggle(key);
    // Veio de um card (nao do proprio cabeçalho) — joga o foco pro
    // cabeçalho, que continua existindo/visivel tanto fechado quanto
    // aberto (diferente do card, que some ao fechar).
    if (id.startsWith("card:")) {
      focusId(`group:${type}:${key}`);
    }
  }

  // Mesma detecção/mapeamento por posição do controle usada em Player.tsx
  // (ver useGamepadPlayer la) — aqui e' so pra navegar a biblioteca, sem
  // nenhum input de jogo envolvido.
  useEffect(() => {
    let gpIndex: number | null = null;
    let raf = 0;
    const REPEAT_DELAY_MS = 320;
    const REPEAT_RATE_MS = 140;
    const dirState: Record<string, { held: boolean; nextAt: number }> = {
      up: { held: false, nextAt: 0 },
      down: { held: false, nextAt: 0 },
      left: { held: false, nextAt: 0 },
      right: { held: false, nextAt: 0 },
    };
    const btnState: Record<number, boolean> = {};
    // Enquanto o dialogo de confirmar desfavoritar esta aberto, o poll
    // abaixo retorna cedo (ver confirmUnfavoriteRef) sem NUNCA atualizar
    // btnState — se o botao que confirmou la dentro (X/Sim) ainda
    // estiver fisicamente pressionado no frame em que o dialogo fecha,
    // btnState[0] continua "false" (congelado de antes de abrir), entao
    // a grade de fundo interpretava como um clique NOVO e abria o jogo
    // focado na hora, logo depois de desfavoritar. wasGatedByConfirm
    // marca que precisa resincronizar sem agir no primeiro frame livre.
    let wasGatedByConfirm = false;

    function onConnected(e: GamepadEvent) {
      gpIndex = e.gamepad.index;
      setGamepadActive(true);
      setGamepadName(e.gamepad.id || "Controle");
    }
    function onDisconnected(e: GamepadEvent) {
      if (e.gamepad.index !== gpIndex) return;
      gpIndex = null;
      setGamepadActive(false);
      setGamepadName(null);
    }
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);

    function handleDir(
      dir: "up" | "down" | "left" | "right",
      pressed: boolean,
      now: number,
      mover: (dir: "up" | "down" | "left" | "right") => void
    ) {
      const s = dirState[dir];
      if (!pressed) {
        s.held = false;
        return;
      }
      if (!s.held) {
        s.held = true;
        s.nextAt = now + REPEAT_DELAY_MS;
        mover(dir);
      } else if (now >= s.nextAt) {
        s.nextAt = now + REPEAT_RATE_MS;
        mover(dir);
      }
    }

    function poll() {
      const now = performance.now();
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = gpIndex !== null ? pads[gpIndex] : null;
      if (!gp) {
        for (let i = 0; i < pads.length; i++) {
          if (pads[i]) {
            gp = pads[i];
            gpIndex = gp!.index;
            setGamepadActive(true);
            setGamepadName(gp!.id || "Controle");
            break;
          }
        }
      }
      if (gp) {
        const pressedNow = (idx: number) => !!gp!.buttons[idx]?.pressed;

        // Qualquer botao ou analogico religa o Big Picture sozinho, mesmo
        // que tenha sido desligado por causa de teclado/mouse (ver
        // useEffect de baixo) — nao precisa de toggle manual.
        if (!bigPictureOnRef.current) {
          const anyButton = gp.buttons.some((b) => b.pressed);
          const anyStick = gp.axes.some((a) => Math.abs(a) > 0.5);
          if (anyButton || anyStick) setBigPictureOn(true);
        }

        if (!bigPictureOnRef.current) {
          raf = requestAnimationFrame(poll);
          return;
        }

        // Dialogo de confirmar desfavoritar aberto: o controle vira dele
        // (ConfirmDialog le o gamepad sozinho) — a grade de fundo nao
        // pode continuar respondendo ao mesmo tempo.
        if (confirmUnfavoriteRef.current) {
          wasGatedByConfirm = true;
          raf = requestAnimationFrame(poll);
          return;
        }
        if (wasGatedByConfirm) {
          // Primeiro frame livre depois do dialogo fechar — so'
          // resincroniza o que esta pressionado agora, sem agir (ver
          // comentario em wasGatedByConfirm la em cima).
          wasGatedByConfirm = false;
          [0, 1, 2, 3, 4, 5, 6, 7, 9].forEach((idx) => {
            btnState[idx] = pressedNow(idx);
          });
          raf = requestAnimationFrame(poll);
          return;
        }

        const [ax, ay, , ry] = gp.axes;
        const dead = 0.5;
        const left = !!gp.buttons[14]?.pressed || (typeof ax === "number" && ax < -dead);
        const right = !!gp.buttons[15]?.pressed || (typeof ax === "number" && ax > dead);
        const up = !!gp.buttons[12]?.pressed || (typeof ay === "number" && ay < -dead);
        const down = !!gp.buttons[13]?.pressed || (typeof ay === "number" && ay > dead);

        // Analogico direito rola a pagina livremente, independente do foco
        // (D-pad/analogico esquerdo pulam de card em card e ja arrastam a
        // tela pro foco ficar visivel — isso aqui e' pra passar o olho
        // pela lista toda direto, sem trocar o que esta focado). So faz
        // sentido fora do overlay A-Z (ele cobre a tela inteira).
        const SCROLL_DEAD = 0.15;
        const SCROLL_MAX_PX = 22; // por frame, na deflexao maxima do analogico
        if (!alphaOpenRef.current && typeof ry === "number" && Math.abs(ry) > SCROLL_DEAD) {
          const magnitude = (Math.abs(ry) - SCROLL_DEAD) / (1 - SCROLL_DEAD);
          window.scrollBy(0, Math.sign(ry) * magnitude * SCROLL_MAX_PX);
        }

        // Overlay A-Z aberto E em modo teclado: D-pad navega, e os 4
        // botoes da carcaça fazem cada um a sua coisa no chip focado
        // (referencia DualShock 4): X digita a letra na busca (como
        // sempre foi); Quadrado so' SELECIONA ela como filtro de letra
        // inicial (sem digitar, fecha o overlay — o mesmo que clicar nela
        // com mouse/toque faria); Bola fecha o teclado sem mexer em nada
        // (like B/Start); Triangulo apaga tudo que foi digitado ate agora
        // de uma vez, de qualquer chip focado (atalho pro que a chip
        // "Apagar tudo" ja faz, sem precisar navegar ate ela).
        if (alphaOpenRef.current && keyboardModeRef.current) {
          handleDir("left", left, now, moveOverlayFocus);
          handleDir("right", right, now, moveOverlayFocus);
          handleDir("up", up, now, moveOverlayFocus);
          handleDir("down", down, now, moveOverlayFocus);
          if (pressedNow(0) && !btnState[0]) confirmOverlayFocus();
          if (pressedNow(2) && !btnState[2]) confirmOverlaySelectFilter();
          if (pressedNow(3) && !btnState[3]) updateFilters({ q: null });
          // Bola (1) ou Start (9): fecha o teclado (termina de digitar).
          if ((pressedNow(1) && !btnState[1]) || (pressedNow(9) && !btnState[9])) setAlphaOpen(false);
          [0, 1, 2, 3, 9].forEach((idx) => {
            btnState[idx] = pressedNow(idx);
          });
          raf = requestAnimationFrame(poll);
          return;
        }

        // Sem overlay (ou overlay aberto so por mouse/toque, sem modo
        // teclado): navegacao normal da grade de jogos.
        handleDir("left", left, now, moveFocus);
        handleDir("right", right, now, moveFocus);
        handleDir("up", up, now, moveFocus);
        handleDir("down", down, now, moveFocus);

        // Confirma (baixo da carcaça — A no Xbox, Cross no PS): abre o
        // jogo focado. Direita (B/Circle): favorita o jogo focado.
        // Quadrado com foco num card: recolhe/expande o card expansivel
        // que ele esta dentro (Favoritos/Top Games/Recentes), sem
        // precisar voltar ate o cabeçalho — ver toggleFocusedCardGroup.
        // L1/R1: alternam entre os filtros (Todos/Recentes/Favoritos/Top
        // Games/cada sistema), na ordem em que os chips aparecem — ver
        // cycleChip. L2/R2: pagina anterior/proxima. Start: abre o
        // filtro por letra (vira teclado sozinho, ver keyboardMode).
        if (pressedNow(0) && !btnState[0]) confirmFocused();
        if (pressedNow(1) && !btnState[1]) {
          const id = focusedIdRef.current;
          if (id?.startsWith("card:")) requestToggleFavorite(slugFromCardId(id));
        }
        if (pressedNow(2) && !btnState[2]) toggleFocusedCardGroup();
        if (pressedNow(4) && !btnState[4]) cycleChip(-1);
        if (pressedNow(5) && !btnState[5]) cycleChip(1);
        if (pressedNow(6) && !btnState[6]) goToPage(pageSafeRef.current - 1);
        if (pressedNow(7) && !btnState[7]) goToPage(Math.min(pageCountRef.current, pageSafeRef.current + 1));
        if (pressedNow(9) && !btnState[9]) setAlphaOpen(true);
        [0, 1, 2, 4, 5, 6, 7, 9].forEach((idx) => {
          btnState[idx] = pressedNow(idx);
        });
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Digitar no teclado ou mexer o mouse desliga o Big Picture na hora,
  // voltando pro modo normal (mouse/toque) — o poll do gamepad acima
  // religa sozinho assim que o controle for usado de novo.
  // EXCETO enquanto o overlay A-Z esta aberto em modo teclado (digitando
  // com o proprio controle) — sem essa excecao, um evento de mouse/
  // teclado espurio (ou so a mao encostando perto do mouse) desligava o
  // Big Picture bem na hora que o overlay abria, e o controle continuava
  // mexendo na grade por TRAS do overlay em vez de digitar nele.
  useEffect(() => {
    function onUserInput() {
      if (alphaOpenRef.current && keyboardModeRef.current) return;
      if (bigPictureOnRef.current) setBigPictureOn(false);
    }
    window.addEventListener("keydown", onUserInput);
    window.addEventListener("mousemove", onUserInput);
    window.addEventListener("mousedown", onUserInput);
    return () => {
      window.removeEventListener("keydown", onUserInput);
      window.removeEventListener("mousemove", onUserInput);
      window.removeEventListener("mousedown", onUserInput);
    };
  }, []);

  // Mesma ideia, so' que pro aneal de foco do TECLADO (ver
  // keyboardNavActive) — mexer o mouse desliga, voltar a apertar uma
  // seta/Enter/Espaco religa sozinho (ver efeito das setas la em cima).
  useEffect(() => {
    function onMouseInput() {
      setKeyboardNavActive(false);
    }
    window.addEventListener("mousemove", onMouseInput);
    window.addEventListener("mousedown", onMouseInput);
    return () => {
      window.removeEventListener("mousemove", onMouseInput);
      window.removeEventListener("mousedown", onMouseInput);
    };
  }, []);

  // Restaura o scroll de onde o usuario parou ao voltar de um jogo (ver
  // saveScroll, chamado ao clicar num card). So tenta depois que a lista
  // carregou e a pagina certa ja esta renderizada, senao a altura do
  // documento ainda nao existe pra rolar ate la.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (games.length === 0) return;
    if (restoredFor.current === location.search) return;
    restoredFor.current = location.search;
    const saved = sessionStorage.getItem(scrollKey(location.search));
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
    }
  }, [games, paged]);

  // Overlay do alfabeto: Esc fecha, e trava o scroll da pagina por tras
  // enquanto ele estiver aberto (senao da pra rolar a lista de jogos
  // "atraves" do overlay no mobile).
  useEffect(() => {
    if (!alphaOpen) {
      setOverlayFocusedKey("");
      return;
    }
    // Em modo teclado comeca focado no "Q" (canto superior esquerdo do
    // layout QWERTY), nao no bucket "#" — fluxo de digitacao mais natural.
    if (keyboardMode) setOverlayFocusedKey("Q");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAlphaOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alphaOpen]);

  // Seleciona a letra como FILTRO inicial de sempre (fecha o overlay) —
  // e' o que acontece ao clicar num chip com mouse/toque, e tambem o que
  // o Quadrado faz no modo controle (ver poll(), CONFIRMA sem digitar).
  function selectLetterFilter(l: string | null) {
    updateFilters({ letter: l });
    setAlphaOpen(false);
  }

  function pickLetter(l: string | null) {
    // Modo controle: o overlay vira teclado — "Todos" apaga tudo que foi
    // digitado, uma letra ACRESCENTA na busca (fica aberto, pra continuar
    // digitando). Sem controle, continua sendo o filtro por letra
    // inicial de sempre, e fecha o overlay.
    // keyboardModeRef (nao "keyboardMode" direto): confirmOverlayFocus e'
    // chamado de dentro do poll() do gamepad, que so monta UMA vez — lendo
    // "keyboardMode" direto ficava preso no valor da primeira renderizacao
    // (sempre false, gamepad nem tinha ligado ainda), entao o X sempre
    // caia no "senao" (selecionar e fechar) em vez de digitar.
    if (keyboardModeRef.current) {
      updateFilters({ q: l === null ? null : (queryRef.current || "") + l });
      return;
    }
    selectLetterFilter(l);
  }

  // Navegacao espacial dentro do overlay A-Z (mesmo algoritmo da grade de
  // jogos, so que aplicada aos chips de letra) — so entra em uso quando
  // keyboardMode esta ativo (senao o overlay so responde a mouse/toque
  // normal, como sempre foi).
  function moveOverlayFocus(dir: "up" | "down" | "left" | "right") {
    const chips = Array.from(document.querySelectorAll<HTMLElement>(".alpha-grid [data-letter]"));
    if (chips.length === 0) return;
    const currentKey = overlayFocusedKeyRef.current;
    const currentEl = chips.find((el) => el.dataset.letter === currentKey);
    if (!currentEl) {
      setOverlayFocusedKey(chips[0].dataset.letter ?? "");
      return;
    }
    if (dir === "left" || dir === "right") {
      const idx = chips.indexOf(currentEl);
      const nextIdx = dir === "right" ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= chips.length) return;
      setOverlayFocusedKey(chips[nextIdx].dataset.letter ?? "");
      return;
    }
    const cur = currentEl.getBoundingClientRect();
    const curCx = cur.left + cur.width / 2;
    const curCy = cur.top + cur.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of chips) {
      if (el === currentEl) continue;
      const r = el.getBoundingClientRect();
      const dy = r.top + r.height / 2 - curCy;
      if (dir === "down" && dy <= 4) continue;
      if (dir === "up" && dy >= -4) continue;
      const dx = Math.abs(r.left + r.width / 2 - curCx);
      const score = Math.abs(dy) * 3 + dx;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) setOverlayFocusedKey(best.dataset.letter ?? "");
  }

  // "__ALL__" (chip Todos/Apagar tudo) e "__SPACE__" (barra de espaco) sao
  // sentinelas usadas so' no data-letter (pra navegacao espacial achar o
  // chip) — aqui viram o valor de verdade que pickLetter/selectLetterFilter
  // esperam.
  function resolveOverlayKey(key: string): string | null {
    if (key === "__ALL__") return null;
    if (key === "__SPACE__") return " ";
    return key;
  }

  function confirmOverlayFocus() {
    const key = overlayFocusedKeyRef.current;
    if (!key) return;
    pickLetter(resolveOverlayKey(key));
  }

  function confirmOverlaySelectFilter() {
    const key = overlayFocusedKeyRef.current;
    if (!key) return;
    selectLetterFilter(resolveOverlayKey(key));
  }

  function saveScroll() {
    try {
      sessionStorage.setItem(scrollKey(location.search), String(window.scrollY));
    } catch {
      // sessionStorage indisponivel (aba privada etc.) - sem restauracao, tudo bem
    }
  }

  // Card de um jogo — extraido pra funcao porque agora e' usado em dois
  // lugares: a grade paginada normal, e dentro de cada console-group
  // (ver Favoritos/Top Games separados por console, mais abaixo).
  // "scope" so' e' passado em Recentes: o MESMO jogo pode aparecer nos
  // dois cards (Mais recentes e Mais jogados) ao mesmo tempo — sem
  // diferenciar o data-bp-id de cada instancia, as DUAS ficavam com a
  // classe de foco ativa juntas quando o slug batia (so' existe UM
  // focusedId por slug), parecendo "2 jogos selecionados" quando era o
  // mesmo jogo 2 vezes. Fora de Recentes cada jogo so' aparece uma vez,
  // entao nao precisa de escopo (mantem o id simples "card:slug" que o
  // resto do app ja espera).
  function renderGameCard(g: GameSummary, scope?: string) {
    const meta = systemMeta(g.system);
    const isFavorite = favorites.has(g.slug);
    const bpId = scope ? `card:${scope}:${g.slug}` : `card:${g.slug}`;
    return (
      <Link
        key={scope ? `${scope}:${g.slug}` : g.slug}
        to={`/play/${g.slug}`}
        className={`game-card${focusVisible && focusedId === bpId ? " gamepad-focused" : ""}`}
        data-bp-id={bpId}
        style={{ ["--accent" as string]: meta.color }}
        onClick={saveScroll}
      >
        <div className="game-card-media">
          {g.cover ? (
            <img src={g.cover} alt="" loading="lazy" />
          ) : (
            <div className="game-card-media-fallback">{g.title.slice(0, 1)}</div>
          )}
          <div className="game-card-scan" />
          <span className="game-card-badge">
            {meta.iconImage ? <img src={meta.iconImage} alt="" className="game-card-badge-icon" /> : meta.icon}{" "}
            {meta.label}
          </span>
          <button
            type="button"
            className={`game-card-favorite${isFavorite ? " active" : ""}`}
            aria-label={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-pressed={isFavorite}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              requestToggleFavorite(g.slug);
            }}
          >
            {isFavorite ? "★" : "☆"}
          </button>
        </div>
        <div className="game-card-body">
          <h2>{g.title}</h2>
          {g.description && <p>{g.description}</p>}
        </div>
      </Link>
    );
  }

  const pullActive = pullDistance > 0 || refreshing;
  const pullProgress = Math.min(1, pullDistance / PULL_THRESHOLD);

  return (
    <div className="library-page" ref={pageRef}>
      {pullActive && (
        <div className="pull-refresh" style={{ height: refreshing ? PULL_THRESHOLD : pullDistance }}>
          <div
            className={`pull-refresh-spinner${refreshing ? " spinning" : ""}`}
            style={!refreshing ? { transform: `rotate(${pullProgress * 180}deg)`, opacity: 0.4 + pullProgress * 0.6 } : undefined}
          />
        </div>
      )}

      <div className="library-brand">
        <img src="/logo.png" alt="FlashGames" className="library-logo" />
      </div>

      <header className="library-header glass">
        <button
          type="button"
          data-bp-id="alpha-trigger"
          className={`library-alpha-trigger${letter ? " active" : ""}${focusVisible && focusedId === "alpha-trigger" ? " bp-focused" : ""}`}
          onClick={() => setAlphaOpen(true)}
          aria-label="Filtrar por letra"
        >
          {letter || "A–Z"}
        </button>

        <div className={`library-search${focusVisible && focusedId === "search" ? " bp-focused" : ""}`} data-bp-id="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => updateFilters({ q: e.target.value || null })}
            placeholder="Buscar jogos..."
            aria-label="Buscar jogos"
          />
          {query && (
            <button
              type="button"
              className="library-search-clear"
              onClick={() => updateFilters({ q: null })}
              aria-label="Limpar busca"
            >
              ×
            </button>
          )}
        </div>

        <div className="library-user">
          {gamepadActive && <span className="gamepad-badge">🎮 {gamepadName}</span>}
          <button
            type="button"
            className={`library-covers-toggle${originalCovers ? " active" : ""}`}
            onClick={toggleOriginalCovers}
            aria-pressed={originalCovers}
            aria-label={originalCovers ? "Usar capas cortadas" : "Usar capas em tamanho original"}
            title={originalCovers ? "Capas em tamanho original (clique pra cortar)" : "Capas cortadas (clique pra usar tamanho original)"}
          >
            {originalCovers ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            )}
          </button>
          <span>
            Ola, <strong>{user?.username}</strong>
          </span>
          <button onClick={() => logout()}>Sair</button>
        </div>
      </header>

      {alphaOpen && (
        <div className="alpha-overlay" role="dialog" aria-modal="true" aria-label="Filtrar por letra" onClick={() => setAlphaOpen(false)}>
          <div className="alpha-card glass" onClick={(e) => e.stopPropagation()}>
            <div className="alpha-card-header">
              <h2>{keyboardMode ? "Digite pra buscar" : "Filtrar por letra"}</h2>
              <button type="button" className="alpha-close" onClick={() => setAlphaOpen(false)} aria-label="Fechar">
                ×
              </button>
            </div>
            {keyboardMode && (
              <p className="alpha-hint">✕ digita · ▢ so' seleciona · ○ fecha · △ apaga tudo</p>
            )}
            {keyboardMode ? (
              <div className="alpha-grid keyboard-rows">
                <div className="keyboard-row">
                  <button
                    type="button"
                    data-letter="__ALL__"
                    className={`alpha-chip alpha-chip-all${overlayFocusedKey === "__ALL__" ? " gamepad-focused" : ""}`}
                    onClick={() => pickLetter(null)}
                  >
                    Apagar tudo
                  </button>
                </div>
                {QWERTY_ROWS.map((row, i) => (
                  <div className="keyboard-row" key={i}>
                    {row.split("").map((l) => (
                      <button
                        key={l}
                        type="button"
                        data-letter={l}
                        className={`alpha-chip${overlayFocusedKey === l ? " gamepad-focused" : ""}`}
                        onClick={() => pickLetter(l)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="keyboard-row">
                  <button
                    type="button"
                    data-letter="__SPACE__"
                    className={`alpha-chip alpha-chip-space${overlayFocusedKey === "__SPACE__" ? " gamepad-focused" : ""}`}
                    onClick={() => pickLetter(" ")}
                  >
                    Espaço
                  </button>
                </div>
              </div>
            ) : (
              <div className="alpha-grid">
                <button
                  type="button"
                  data-letter="__ALL__"
                  className={`alpha-chip alpha-chip-all${!letter ? " active" : ""}${overlayFocusedKey === "__ALL__" ? " gamepad-focused" : ""}`}
                  onClick={() => pickLetter(null)}
                >
                  Todos
                </button>
                {ALPHABET.map((l) => (
                  <button
                    key={l}
                    type="button"
                    data-letter={l}
                    className={`alpha-chip${letter === l ? " active" : ""}${overlayFocusedKey === l ? " gamepad-focused" : ""}`}
                    disabled={!availableLetters.has(l)}
                    onClick={() => pickLetter(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="category-row">
        <button
          data-bp-id="chip:todos"
          className={`category-chip${activeSystem === "todos" ? " active" : ""}${focusVisible && focusedId === "chip:todos" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#00e5ff" }}
          onClick={() => updateFilters({ system: null, fav: null, top: null, recent: null })}
        >
          Todos
        </button>
        <button
          data-bp-id="chip:recent"
          className={`category-chip${recentOnly ? " active" : ""}${focusVisible && focusedId === "chip:recent" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#39ff8f" }}
          onClick={() => updateFilters({ system: null, fav: null, top: null, recent: recentOnly ? null : "1" })}
          aria-pressed={recentOnly}
        >
          <span className="chip-dot">⏱</span>
          Recentes
        </button>
        <button
          data-bp-id="chip:fav"
          className={`category-chip${favoritesOnly ? " active" : ""}${focusVisible && focusedId === "chip:fav" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#ffb020" }}
          onClick={() => updateFilters({ system: null, top: null, recent: null, fav: favoritesOnly ? null : "1" })}
          aria-pressed={favoritesOnly}
        >
          <span className="chip-dot">★</span>
          Favoritos
        </button>
        <button
          data-bp-id="chip:top"
          className={`category-chip${topOnly ? " active" : ""}${focusVisible && focusedId === "chip:top" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#ff2e9a" }}
          onClick={() => updateFilters({ system: null, fav: null, recent: null, top: topOnly ? null : "1" })}
          aria-pressed={topOnly}
        >
          Top Games
        </button>
        {systems.map(([slug, count]) => {
          const meta = systemMeta(slug);
          const bpId = `chip:system:${slug}`;
          return (
            <button
              key={slug}
              data-bp-id={bpId}
              className={`category-chip${activeSystem === slug ? " active" : ""}${focusVisible && focusedId === bpId ? " bp-focused" : ""}`}
              style={{ ["--chip-color" as string]: meta.color }}
              onClick={() => updateFilters({ fav: null, top: null, recent: null, system: activeSystem === slug ? null : slug })}
            >
              {meta.iconImage ? (
                <img src={meta.iconImage} alt="" className="chip-dot-img" />
              ) : (
                <span className="chip-dot">{meta.icon}</span>
              )}
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

      {!error && games.length === 0 && <p className="library-empty">Nenhuma ROM encontrada ainda.</p>}
      {!error && games.length > 0 && filtered.length === 0 && (
        <p className="library-empty">
          {favoritesOnly
            ? "Voce ainda nao favoritou nenhum jogo."
            : recentOnly
              ? "Voce ainda nao jogou nada por aqui."
              : "Nada por aqui. Tenta outro termo ou sistema."}
        </p>
      )}

      {showRecentCards ? (
        <div className="console-groups">
          {recentCards.map((card) => {
            const collapsed = recentGroups.isCollapsed(card.key);
            const bpId = `group:recent:${card.key}`;
            return (
              <div key={card.key} className="console-group" data-group-type="recent" data-group-key={card.key}>
                <button
                  type="button"
                  data-bp-id={bpId}
                  className={`console-group-header${focusVisible && focusedId === bpId ? " bp-focused" : ""}`}
                  onClick={() => recentGroups.toggle(card.key)}
                  aria-expanded={!collapsed}
                  style={{ ["--accent" as string]: card.key === "recent" ? "#39ff8f" : "#ffb020" }}
                >
                  <span className="console-group-icon-glyph">{card.key === "recent" ? "⏱" : "★"}</span>
                  <span className="console-group-label">{card.label}</span>
                  <span className="console-group-count">({card.games.length})</span>
                  <span className={`console-group-chevron${collapsed ? "" : " open"}`}>▾</span>
                </button>
                {!collapsed && (
                  <div className={`game-grid${originalCovers ? " original-covers" : ""}`}>
                    {card.games.length === 0 ? (
                      <p className="library-empty">Nada aqui ainda.</p>
                    ) : (
                      card.games.map((g) => renderGameCard(g, card.key))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : groupedByConsole ? (
        <div className="console-groups">
          {gamesBySystem.map(([system, systemGames]) => {
            const meta = systemMeta(system);
            const collapsed = systemGroups.isCollapsed(system);
            const bpId = `group:system:${system}`;
            return (
              <div key={system} className="console-group" data-group-type="system" data-group-key={system}>
                <button
                  type="button"
                  data-bp-id={bpId}
                  className={`console-group-header${focusVisible && focusedId === bpId ? " bp-focused" : ""}`}
                  onClick={() => systemGroups.toggle(system)}
                  aria-expanded={!collapsed}
                  style={{ ["--accent" as string]: meta.color }}
                >
                  {meta.iconImage ? (
                    <img src={meta.iconImage} alt="" className="console-group-icon" />
                  ) : (
                    <span className="console-group-icon-glyph">{meta.icon}</span>
                  )}
                  <span className="console-group-label">{meta.label}</span>
                  <span className="console-group-count">({systemGames.length})</span>
                  <span className={`console-group-chevron${collapsed ? "" : " open"}`}>▾</span>
                </button>
                {!collapsed && (
                  <div className={`game-grid${originalCovers ? " original-covers" : ""}`}>
                    {systemGames.map((g) => renderGameCard(g))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`game-grid${originalCovers ? " original-covers" : ""}`} ref={gridRef}>
          {paged.map((g) => renderGameCard(g))}
        </div>
      )}

      {!error && pageCount > 1 && (
        <div className="pagination">
          <button
            type="button"
            data-bp-id="page:prev"
            className={focusVisible && focusedId === "page:prev" ? "bp-focused" : ""}
            disabled={pageSafe <= 1}
            onClick={() => goToPage(pageSafe - 1)}
          >
            ← Anterior
          </button>
          <span className="pagination-status">
            Pagina {pageSafe} de {pageCount}
          </span>
          <button
            type="button"
            data-bp-id="page:next"
            className={focusVisible && focusedId === "page:next" ? "bp-focused" : ""}
            disabled={pageSafe >= pageCount}
            onClick={() => goToPage(pageSafe + 1)}
          >
            Proxima →
          </button>
        </div>
      )}

      {confirmUnfavoriteSlug && (
        <ConfirmDialog
          message={`Remover "${games.find((g) => g.slug === confirmUnfavoriteSlug)?.title ?? "este jogo"}" dos favoritos?`}
          confirmLabel="Remover"
          cancelLabel="Cancelar"
          onConfirm={() => {
            toggleFavorite(confirmUnfavoriteSlug);
            setConfirmUnfavoriteSlug(null);
          }}
          onCancel={() => setConfirmUnfavoriteSlug(null)}
        />
      )}
    </div>
  );
}
