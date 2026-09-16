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

export const SYSTEM_META: Record<string, CategoryMeta> = {
  SNES: { label: "Super Nintendo", color: "#ff2e6d", icon: "◆" },
  NES: { label: "NES", color: "#ffb020", icon: "✦" },
  GENESIS: { label: "Mega Drive", color: "#00d4ff", icon: "▲" },
  GBA: { label: "Game Boy Advance", color: "#39ff8f", icon: "■" },
  PS1: { label: "PlayStation", color: "#b453ff", icon: "●" },
};

export function systemMeta(slug: string): CategoryMeta {
  return SYSTEM_META[slug] || { label: slug, color: "#8b8ba7", icon: "○" };
}
