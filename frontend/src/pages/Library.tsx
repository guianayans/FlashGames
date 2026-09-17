import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { GameSummary } from "../types";
import { useAuth } from "../auth/AuthContext";
import { systemMeta } from "../categories";
import ConfirmDialog from "../components/ConfirmDialog";

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Renderizar os ~2500 cards de uma vez deixava a pagina pesada pra montar,
// principalmente no celular — pagina em blocos de PAGE_SIZE em vez de
// jogar tudo no DOM de uma vez.
const PAGE_SIZE = 48;

// "#" agrupa titulos que comecam com numero (bem comuns nessa colecao, ex.
// "3 Ninjas Kick Back") — sem isso ficariam de fora do filtro por letra.
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function titleBucket(title: string): string {
  const first = normalize(title).trim()[0] ?? "";
  return /[0-9]/.test(first) ? "#" : first.toUpperCase();
}

// Chave da posicao de scroll salva no sessionStorage, por combinacao de
// filtro/pagina (a propria query string ja identifica isso).
function scrollKey(search: string): string {
  return `library-scroll:${search}`;
}

export default function Library() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
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

  // Puxar a tela pra baixo (no topo) atualiza a lista — Safari/PWA no iOS
  // nao tem pull-to-refresh nativo (diferente do Chrome/Android), entao
  // esse gesto e essa UI sao 100% nossos.
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const pullState = useRef<{ startY: number; active: boolean } | null>(null);

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
      pullState.current = { startY: e.touches[0].clientY, active: true };
    }

    function onTouchMove(e: TouchEvent) {
      const state = pullState.current;
      if (!state?.active) return;
      const delta = e.touches[0].clientY - state.startY;
      if (delta <= 0 || window.scrollY > 0) {
        state.active = false;
        setPullDistance(0);
        return;
      }
      e.preventDefault();
      setPullDistance(Math.min(PULL_MAX, delta * 0.5));
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
      if (activeSystem !== "todos" && g.system !== activeSystem) return false;
      if (letter && titleBucket(g.title) !== letter) return false;
      if (!q) return true;
      const haystack = normalize([g.title, g.description, g.category, ...(g.tags || [])].join(" "));
      return haystack.includes(q);
    });
  }, [games, query, activeSystem, favoritesOnly, favorites, topOnly, letter]);

  // Favoritos/Top Games (sem filtro de sistema aplicado) separam por
  // console em cards expansiveis, em vez da grade paginada normal — sao
  // listas curtas o bastante pra mostrar tudo de uma vez, e olhar "so os
  // meus jogos de SNES favoritados" (por exemplo) fica mais facil
  // dobrando os outros consoles pra fora do caminho.
  const groupedByConsole = (favoritesOnly || topOnly) && activeSystem === "todos";
  const [collapsedSystems, setCollapsedSystems] = useState<Set<string>>(new Set());
  function toggleSystemCollapsed(system: string) {
    setCollapsedSystems((prev) => {
      const next = new Set(prev);
      if (next.has(system)) next.delete(system);
      else next.add(system);
      return next;
    });
  }
  const gamesBySystem = useMemo(() => {
    const map = new Map<string, GameSummary[]>();
    for (const g of filtered) {
      const list = map.get(g.system);
      if (list) list.push(g);
      else map.set(g.system, [g]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  // Pra desabilitar no overlay as letras sem nenhum jogo correspondente.
  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) set.add(titleBucket(g.title));
    return set;
  }, [games]);

  const pageCount = groupedByConsole ? 1 : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = useMemo(() => {
    if (groupedByConsole) return filtered.filter((g) => !collapsedSystems.has(g.system));
    return filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  }, [filtered, pageSafe, groupedByConsole, collapsedSystems]);

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
    if (!gamepadActive) return;
    const id = focusedId;
    if (!id) {
      if (paged.length > 0) setFocusedId(`card:${paged[0].slug}`);
      return;
    }
    if (id.startsWith("card:")) {
      const slug = id.slice(5);
      if (!paged.some((g) => g.slug === slug)) {
        setFocusedId(paged.length > 0 ? `card:${paged[0].slug}` : "alpha-trigger");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamepadActive, paged]);

  function focusId(id: string) {
    setFocusedId(id);
    // Chegar no chip "Todos" (topo dos filtros) sobe a tela inteira, nao
    // so o minimo pra revelar o chip — ele fica logo abaixo da busca/
    // topbar, entao "nearest" deixava a top bar cortada as vezes.
    if (id === "chip:todos") {
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
      const dx = r.left + r.width / 2 - curCx;
      const dy = r.top + r.height / 2 - curCy;
      let score: number;
      if (dir === "right") {
        if (dx <= 4) continue;
        score = dx + Math.abs(dy) * 4;
      } else if (dir === "left") {
        if (dx >= -4) continue;
        score = -dx + Math.abs(dy) * 4;
      } else if (dir === "down") {
        if (dy <= 4) continue;
        score = dy + Math.abs(dx) * 1.2;
      } else {
        if (dy >= -4) continue;
        score = -dy + Math.abs(dx) * 1.2;
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
      navigate(`/play/${id.slice(5)}`);
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
      updateFilters({ system: null, fav: null, top: null });
    } else if (id === "chip:fav") {
      updateFilters({ system: null, top: null, fav: sp.get("fav") === "1" ? null : "1" });
    } else if (id === "chip:top") {
      updateFilters({ system: null, fav: null, top: sp.get("top") === "1" ? null : "1" });
    } else if (id.startsWith("chip:system:")) {
      const slug = id.slice(12);
      const curSystem = sp.get("system") ?? "todos";
      updateFilters({ fav: null, top: null, system: curSystem === slug ? null : slug });
    } else if (id === "page:prev") {
      goToPage(pageSafeRef.current - 1);
    } else if (id === "page:next") {
      goToPage(Math.min(pageCountRef.current, pageSafeRef.current + 1));
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

        // Overlay A-Z aberto E em modo teclado: D-pad/confirma navegam e
        // "digitam" nele em vez de mexer na grade de jogos por tras.
        if (alphaOpenRef.current && keyboardModeRef.current) {
          handleDir("left", left, now, moveOverlayFocus);
          handleDir("right", right, now, moveOverlayFocus);
          handleDir("up", up, now, moveOverlayFocus);
          handleDir("down", down, now, moveOverlayFocus);
          if (pressedNow(0) && !btnState[0]) confirmOverlayFocus();
          // B (1) ou Start (9) de novo: fecha o teclado (termina de digitar).
          if ((pressedNow(1) && !btnState[1]) || (pressedNow(9) && !btnState[9])) setAlphaOpen(false);
          [0, 1, 9].forEach((idx) => {
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
        // jogo focado. Direita (B/Circle): favorita o jogo focado. L1/R1:
        // pagina anterior/proxima. Start: abre o filtro por letra (vira
        // teclado sozinho, ver keyboardMode).
        if (pressedNow(0) && !btnState[0]) confirmFocused();
        if (pressedNow(1) && !btnState[1]) {
          const id = focusedIdRef.current;
          if (id?.startsWith("card:")) requestToggleFavorite(id.slice(5));
        }
        if (pressedNow(4) && !btnState[4]) goToPage(pageSafeRef.current - 1);
        if (pressedNow(5) && !btnState[5]) goToPage(Math.min(pageCountRef.current, pageSafeRef.current + 1));
        if (pressedNow(9) && !btnState[9]) setAlphaOpen(true);
        [0, 1, 4, 5, 9].forEach((idx) => {
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
    // Em modo teclado comeca focado na primeira letra de verdade ("A"),
    // nao no bucket "#" — fluxo de digitacao mais natural.
    if (keyboardMode) setOverlayFocusedKey("A");
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

  function pickLetter(l: string | null) {
    // Modo controle: o overlay vira teclado — "Todos" apaga tudo que foi
    // digitado, uma letra ACRESCENTA na busca (fica aberto, pra continuar
    // digitando). Sem controle, continua sendo o filtro por letra
    // inicial de sempre, e fecha o overlay.
    if (keyboardMode) {
      updateFilters({ q: l === null ? null : (queryRef.current || "") + l });
      return;
    }
    updateFilters({ letter: l });
    setAlphaOpen(false);
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

  function confirmOverlayFocus() {
    const key = overlayFocusedKeyRef.current;
    if (!key) return;
    pickLetter(key === "__ALL__" ? null : key);
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
  function renderGameCard(g: GameSummary) {
    const meta = systemMeta(g.system);
    const isFavorite = favorites.has(g.slug);
    return (
      <Link
        key={g.slug}
        to={`/play/${g.slug}`}
        className={`game-card${gamepadActive && focusedId === `card:${g.slug}` ? " gamepad-focused" : ""}`}
        data-bp-id={`card:${g.slug}`}
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
          className={`library-alpha-trigger${letter ? " active" : ""}${gamepadActive && focusedId === "alpha-trigger" ? " bp-focused" : ""}`}
          onClick={() => setAlphaOpen(true)}
          aria-label="Filtrar por letra"
        >
          {letter || "A–Z"}
        </button>

        <div className={`library-search${gamepadActive && focusedId === "search" ? " bp-focused" : ""}`} data-bp-id="search">
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
            <div className="alpha-grid">
              <button
                type="button"
                data-letter="__ALL__"
                className={`alpha-chip alpha-chip-all${!keyboardMode && !letter ? " active" : ""}${overlayFocusedKey === "__ALL__" ? " gamepad-focused" : ""}`}
                onClick={() => pickLetter(null)}
              >
                {keyboardMode ? "Apagar tudo" : "Todos"}
              </button>
              {ALPHABET.map((l) => (
                <button
                  key={l}
                  type="button"
                  data-letter={l}
                  className={`alpha-chip${!keyboardMode && letter === l ? " active" : ""}${overlayFocusedKey === l ? " gamepad-focused" : ""}`}
                  disabled={!keyboardMode && !availableLetters.has(l)}
                  onClick={() => pickLetter(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="category-row">
        <button
          data-bp-id="chip:todos"
          className={`category-chip${activeSystem === "todos" ? " active" : ""}${gamepadActive && focusedId === "chip:todos" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#00e5ff" }}
          onClick={() => updateFilters({ system: null, fav: null, top: null })}
        >
          Todos
        </button>
        <button
          data-bp-id="chip:fav"
          className={`category-chip${favoritesOnly ? " active" : ""}${gamepadActive && focusedId === "chip:fav" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#ffb020" }}
          onClick={() => updateFilters({ system: null, top: null, fav: favoritesOnly ? null : "1" })}
          aria-pressed={favoritesOnly}
        >
          <span className="chip-dot">★</span>
          Favoritos
        </button>
        <button
          data-bp-id="chip:top"
          className={`category-chip${topOnly ? " active" : ""}${gamepadActive && focusedId === "chip:top" ? " bp-focused" : ""}`}
          style={{ ["--chip-color" as string]: "#ff2e9a" }}
          onClick={() => updateFilters({ system: null, fav: null, top: topOnly ? null : "1" })}
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
              className={`category-chip${activeSystem === slug ? " active" : ""}${gamepadActive && focusedId === bpId ? " bp-focused" : ""}`}
              style={{ ["--chip-color" as string]: meta.color }}
              onClick={() => updateFilters({ fav: null, top: null, system: activeSystem === slug ? null : slug })}
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
          {favoritesOnly ? "Voce ainda nao favoritou nenhum jogo." : "Nada por aqui. Tenta outro termo ou sistema."}
        </p>
      )}

      {groupedByConsole ? (
        <div className="console-groups">
          {gamesBySystem.map(([system, systemGames]) => {
            const meta = systemMeta(system);
            const collapsed = collapsedSystems.has(system);
            return (
              <div key={system} className="console-group">
                <button
                  type="button"
                  className="console-group-header"
                  onClick={() => toggleSystemCollapsed(system)}
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
            className={gamepadActive && focusedId === "page:prev" ? "bp-focused" : ""}
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
            className={gamepadActive && focusedId === "page:next" ? "bp-focused" : ""}
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
