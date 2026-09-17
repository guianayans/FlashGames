export type SystemKey = "SNES" | "NES" | "GENESIS" | "GBA" | "PS1" | "PS2";

export interface GameSummary {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  system: SystemKey;
  cover: string | null;
  top: boolean;
}

export type SystemLauncher = "snes" | "nes" | "megadrive" | "gba" | "psx" | "ps2";

export interface GameDetail extends GameSummary {
  launcher: SystemLauncher;
  rom: string;
  // So PS1 preenche isso — faixas/arquivos extras que o .cue/.m3u/.ccd do
  // jogo referencia (ver getPs1RomExtras no backend). Vazio nos outros
  // sistemas (arquivo unico).
  romExtras: string[];
}

export interface User {
  id: number;
  username: string;
}
