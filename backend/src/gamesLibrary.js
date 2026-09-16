import fs from "node:fs";
import path from "node:path";

// Cada sistema e uma pasta no nivel raiz do projeto (ex:
// /pendriver/FlashGames/SNES), montada dentro do container em ROMS_DIR/<SISTEMA>.
// Dentro dela, as ROMs podem estar soltas ou em qualquer subpasta (ex: a
// colecao real do usuario vem organizada em subpastas por letra A-Z) — o
// scanner varre recursivamente.
// `launcher` bate com o nome do metodo estatico de conveniencia do
// Nostalgist.js no frontend (Nostalgist.snes/nes/megadrive/gba(...)), que
// ja escolhe o core certo (snes9x/fceumm/genesis_plus_gx/mgba) sozinho.
export const SYSTEMS = {
  SNES: { launcher: "snes", label: "Super Nintendo", extensions: [".sfc", ".smc", ".zip"] },
  NES: { launcher: "nes", label: "Nintendo (NES)", extensions: [".nes", ".zip"] },
  GENESIS: { launcher: "megadrive", label: "Mega Drive / Genesis", extensions: [".md", ".gen", ".bin", ".zip"] },
  GBA: { launcher: "gba", label: "Game Boy Advance", extensions: [".gba", ".zip"] },
  // PS1 nao tem metodo de conveniencia no Nostalgist (Nostalgist.psx nao
  // existe) — o frontend usa Nostalgist.launch({ core: 'pcsx_rearmed' }),
  // ver loadEmulatorScript.ts. Escaneado por PASTA (scanPs1), nao por
  // extensao solta como os outros — ver comentario la embaixo do porque.
  PS1: { launcher: "psx", label: "PlayStation", extensions: [] },
};

const ROMS_DIR = process.env.ROMS_DIR || "/app/roms";
const COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function findSibling(dir, baseName, extensions) {
  for (const ext of extensions) {
    const candidate = path.join(dir, baseName + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readOverride(romPath) {
  const dir = path.dirname(romPath);
  const base = path.basename(romPath, path.extname(romPath));
  const manifestPath = path.join(dir, `${base}.json`);
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return {};
  }
}

function walkRoms(dir, extensions, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRoms(full, extensions, out);
    } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function buildGame(systemKey, romPath) {
  const { launcher } = SYSTEMS[systemKey];
  const dir = path.dirname(romPath);
  const base = path.basename(romPath, path.extname(romPath));
  const override = readOverride(romPath);

  const slug = override.slug || `${systemKey.toLowerCase()}-${slugify(base)}`;
  const coverPath = findSibling(dir, base, COVER_EXTENSIONS);

  return {
    slug,
    title: override.title || base,
    description: override.description || "",
    category: override.category || "outros",
    tags: Array.isArray(override.tags) ? override.tags : [],
    system: systemKey,
    launcher,
    rom: romPath,
    cover: coverPath,
  };
}

// PS1 nao da pra escanear igual os outros sistemas: la, 1 arquivo = 1 jogo
// (uma ROM de SNES e' um .sfc solto). No PS1, um jogo e' uma IMAGEM DE CD
// (.cue referenciando varios .bin de faixa, ou .ccd/.chd/.pbp/.m3u) — cada
// jogo vive numa PASTA PROPRIA com varios arquivos, e a colecao real do
// usuario nem sempre segue um padrao limpo (algumas pastas tem 2 .cue
// diferentes, algumas so tem .bin solto sem nenhum .cue, os nomes de
// arquivo as vezes sao o serial tipo "SLUS-00684" em vez do nome do jogo).
// Entao aqui: 1 PASTA = 1 jogo (o titulo vem do NOME DA PASTA, que sempre
// e' legivel, nunca do nome do arquivo em si), e dentro dela a gente
// escolhe o "arquivo mestre" certo pra apontar o Nostalgist.
const PS1_MASTER_EXTENSIONS = [".m3u", ".cue", ".chd", ".pbp", ".ccd"];
const PS1_FALLBACK_EXTENSIONS = [".bin", ".iso", ".img"];
const PS1_DISC_EXTENSIONS = [...PS1_MASTER_EXTENSIONS, ...PS1_FALLBACK_EXTENSIONS];

function normalizePs1Name(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Acha as pastas de jogo (qualquer pasta que tenha direto dentro dela um
// arquivo de disco) — nao desce mais fundo a partir dali, uma pasta de
// jogo e' sempre uma FOLHA nessa varredura.
function findPs1GameFolders(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const hasDisc = entries.some(
    (e) => e.isFile() && PS1_DISC_EXTENSIONS.includes(path.extname(e.name).toLowerCase())
  );
  if (hasDisc) {
    out.push(dir);
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) findPs1GameFolders(path.join(dir, entry.name), out);
  }
}

// Dentro da pasta do jogo, escolhe o arquivo certo pra apontar o
// Nostalgist: prefere .cue/.m3u/etc sobre .bin/.iso solto (sem cue nao da
// pra saber as faixas de audio certas, mas e' melhor que nada); se tiver
// mais de um candidato do mesmo tipo (cue duplicado), prefere o que tem
// nome mais parecido com o da PASTA, desempatando pelo maior arquivo.
function pickPs1MasterFile(folder) {
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const normFolder = normalizePs1Name(path.basename(folder));

  for (const extGroup of [PS1_MASTER_EXTENSIONS, PS1_FALLBACK_EXTENSIONS]) {
    const candidates = files.filter((f) => extGroup.includes(path.extname(f).toLowerCase()));
    if (candidates.length === 0) continue;
    if (candidates.length === 1) return path.join(folder, candidates[0]);
    candidates.sort((a, b) => {
      const aMatch = normalizePs1Name(path.basename(a, path.extname(a))) === normFolder ? 1 : 0;
      const bMatch = normalizePs1Name(path.basename(b, path.extname(b))) === normFolder ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      try {
        return fs.statSync(path.join(folder, b)).size - fs.statSync(path.join(folder, a)).size;
      } catch {
        return 0;
      }
    });
    return path.join(folder, candidates[0]);
  }
  return null;
}

function scanPs1(systemDir, games) {
  const folders = [];
  findPs1GameFolders(systemDir, folders);
  for (const folder of folders) {
    const master = pickPs1MasterFile(folder);
    if (!master) continue;
    const title = path.basename(folder);
    const slug = `ps1-${slugify(title)}`;
    const coverPath =
      findSibling(folder, title, COVER_EXTENSIONS) || findSibling(path.dirname(folder), title, COVER_EXTENSIONS);
    const game = {
      slug,
      title,
      description: "",
      category: "outros",
      tags: [],
      system: "PS1",
      launcher: SYSTEMS.PS1.launcher,
      rom: master,
      cover: coverPath,
    };
    if (!games.has(game.slug)) games.set(game.slug, game);
  }
}

function scanAll() {
  const games = new Map();
  for (const systemKey of Object.keys(SYSTEMS)) {
    const systemDir = path.join(ROMS_DIR, systemKey);
    if (systemKey === "PS1") {
      scanPs1(systemDir, games);
      continue;
    }
    const romPaths = [];
    walkRoms(systemDir, SYSTEMS[systemKey].extensions, romPaths);
    for (const romPath of romPaths) {
      const game = buildGame(systemKey, romPath);
      if (!games.has(game.slug)) games.set(game.slug, game);
    }
  }
  return games;
}

// scanAll() varre o disco (milhares de ROMs, cada uma com ate 5 stat/exists
// sincronos pra achar capa e overrides) — sem cache isso rodava inteiro em
// TODA request de /api/games e /api/games/:slug, deixando a lista lenta
// pra carregar. Cacheia por CACHE_TTL_MS; a lib so muda quando alguem
// adiciona ROMs no disco, entao alguns segundos de atraso pra aparecer nao
// tem problema.
const CACHE_TTL_MS = 30_000;
let cache = null;
let cacheAt = 0;

function getGamesMap() {
  const now = Date.now();
  if (!cache || now - cacheAt > CACHE_TTL_MS) {
    cache = scanAll();
    cacheAt = now;
  }
  return cache;
}

// Jogos com capa primeiro (ordem alfabetica), depois os sem capa (tambem
// alfabetica) — a tela inicial fica mais "apresentavel" logo de cara em vez
// de misturar aleatoriamente com os sem arte.
export function listGames() {
  return Array.from(getGamesMap().values()).sort((a, b) => {
    const coverDiff = (a.cover ? 0 : 1) - (b.cover ? 0 : 1);
    if (coverDiff !== 0) return coverDiff;
    return a.title.localeCompare(b.title);
  });
}

export function getGame(slug) {
  return getGamesMap().get(slug) || null;
}

// BIOS de console (ex: PS1) ficam numa pasta a parte, ROMS_DIR/BIOS — fora
// de qualquer pasta de SYSTEMS, entao o scanner nunca confunde esses
// arquivos com jogo (nao entra no loop de scanAll). E' o usuario quem
// coloca o dump (nao redistribuimos BIOS, cada um usa o dump extraido do
// proprio console). O core (ex: pcsx_rearmed pro PS1) recebe todos os
// arquivos daqui e escolhe sozinho qual bate com a regiao do jogo — por
// isso o README.md (instrucoes, unico arquivo versionado dessa pasta,
// ver .gitignore) NAO pode entrar nessa lista: o core tentava ler ele
// como se fosse firmware e a BIOS de verdade nunca carregava.
export function listBiosFiles() {
  const biosDir = path.join(ROMS_DIR, "BIOS");
  try {
    return fs
      .readdirSync(biosDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase() !== "readme.md")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export { ROMS_DIR };
