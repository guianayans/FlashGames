import fs from "node:fs";
import path from "node:path";

const GAMES_DIR = process.env.GAMES_DIR || "/app/games";
const SLUG_RE = /^[a-z0-9-]{1,64}$/;

function readManifest(slug) {
  const manifestPath = path.join(GAMES_DIR, slug, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    if (manifest.slug !== slug) return null;
    const swfPath = path.join(GAMES_DIR, slug, manifest.swf || "game.swf");
    if (!fs.existsSync(swfPath)) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function listGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs
    .readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SLUG_RE.test(entry.name))
    .map((entry) => readManifest(entry.name))
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getGame(slug) {
  if (!SLUG_RE.test(slug)) return null;
  return readManifest(slug);
}

export { GAMES_DIR };
