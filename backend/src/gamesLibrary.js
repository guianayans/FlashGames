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

export function listGames() {
  return Array.from(scanAll().values()).sort((a, b) => a.title.localeCompare(b.title));
}

export function getGame(slug) {
  return scanAll().get(slug) || null;
}

export { ROMS_DIR };
