export type SystemKey = "SNES" | "NES" | "GENESIS" | "GBA";

export interface GameSummary {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  system: SystemKey;
  cover: string | null;
}

export type SystemLauncher = "snes" | "nes" | "megadrive" | "gba";

export interface GameDetail extends GameSummary {
  launcher: SystemLauncher;
  rom: string;
}

export interface User {
  id: number;
  username: string;
}
