export interface CategoryMeta {
  label: string;
  color: string;
  icon: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  acao: { label: "Ação", color: "#ff2e6d", icon: "◆" },
  estrategia: { label: "Estratégia", color: "#00d4ff", icon: "▲" },
  puzzle: { label: "Puzzle", color: "#b453ff", icon: "●" },
  plataforma: { label: "Plataforma", color: "#39ff8f", icon: "■" },
  arcade: { label: "Arcade", color: "#ffb020", icon: "✦" },
  simulacao: { label: "Simulação", color: "#14e6c9", icon: "▼" },
  outros: { label: "Outros", color: "#8b8ba7", icon: "○" },
};

export function categoryMeta(slug: string): CategoryMeta {
  return CATEGORY_META[slug] || { label: slug, color: "#8b8ba7", icon: "○" };
}

export interface SystemMeta extends CategoryMeta {
  // Icone de verdade (imagem do proprio console/controle, ver
  // /pendriver/FlashGames/imagens/Consoles) — quando presente, a UI usa
  // essa imagem no lugar do glifo unicode de "icon" (que fica so de
  // fallback pra sistema sem imagem cadastrada).
  iconImage?: string;
}

export const SYSTEM_META: Record<string, SystemMeta> = {
  SNES: { label: "Super Nintendo", color: "#ff2e6d", icon: "◆", iconImage: "/images/consoles/SNES.png" },
  NES: { label: "NES", color: "#ffb020", icon: "✦", iconImage: "/images/consoles/NES.png" },
  GENESIS: { label: "Mega Drive", color: "#00d4ff", icon: "▲", iconImage: "/images/consoles/GENESIS.png" },
  GBA: { label: "Game Boy Advance", color: "#39ff8f", icon: "■", iconImage: "/images/consoles/GBA.png" },
  PS1: { label: "PlayStation", color: "#b453ff", icon: "●", iconImage: "/images/consoles/PS1.png" },
};

export function systemMeta(slug: string): SystemMeta {
  return SYSTEM_META[slug] || { label: slug, color: "#8b8ba7", icon: "○" };
}
