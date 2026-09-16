export type SystemKey = "SNES" | "NES" | "GENESIS" | "GBA" | "PS1";

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

export type SystemLauncher = "snes" | "nes" | "megadrive" | "gba" | "psx";

export interface GameDetail extends GameSummary {
  launcher: SystemLauncher;
  rom: string;
}

export interface User {
  id: number;
  username: string;
}
