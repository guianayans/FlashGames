import { Nostalgist } from "nostalgist";
import type { SystemLauncher } from "./types";

export interface EmulatorConfig {
  launcher: SystemLauncher;
  romUrl: string;
  canvas: HTMLCanvasElement;
}

// Nostalgist.js roda os mesmos cores libretro/RetroArch que o EmulatorJS
// usava por baixo dos panos, mas SEM nenhuma UI propria (sem menu, sem
// gamepad de toque) — a gente e quem desenha/controla tudo. Cada metodo
// (snes/nes/megadrive/gba) ja escolhe o core certo sozinho (snes9x/fceumm/
// genesis_plus_gx/mgba). Chamados via `Nostalgist.xxx(...)` diretamente (e
// nao guardados numa tabela de funcoes soltas) pra preservar o `this`
// interno da classe.
export async function loadEmulator(config: EmulatorConfig): Promise<Nostalgist> {
  const opts = { rom: config.romUrl, element: config.canvas };
  switch (config.launcher) {
    case "snes":
      return Nostalgist.snes(opts);
    case "nes":
      return Nostalgist.nes(opts);
    case "megadrive":
      return Nostalgist.megadrive(opts);
    case "gba":
      return Nostalgist.gba(opts);
  }
}

export type { Nostalgist };
