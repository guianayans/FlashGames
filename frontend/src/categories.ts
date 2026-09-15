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
  outros: { label: "Outros", color: "#8b8ba7", icon: "○" },
};

export function categoryMeta(slug: string): CategoryMeta {
  return CATEGORY_META[slug] || { label: slug, color: "#8b8ba7", icon: "○" };
}
