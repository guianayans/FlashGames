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

function scanAll() {
  const games = new Map();
  for (const systemKey of Object.keys(SYSTEMS)) {
    const systemDir = path.join(ROMS_DIR, systemKey);
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

export { ROMS_DIR };
