import { Nostalgist } from "nostalgist";
import { api } from "./api";
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
    case "psx": {
      // Sem metodo de conveniencia pro PS1 (Nostalgist.psx nao existe) —
      // core na mao. pcsx_rearmed e' o core PS1 mais leve/rapido pra rodar
      // em WASM no navegador (o outro core PS1 do libretro, beetle-psx,
      // e' mais preciso mas pesado demais pra isso aqui).
      // pcsx_rearmed PRECISA de uma BIOS de PS1 pra rodar jogo comercial —
      // sem ela, o core nao consegue iniciar o conteudo e o RetroArch cai
      // direto na propria tela de menu ("Load Core"). O usuario coloca o(s)
      // dump(s) dele em PS1/../BIOS (ver ROMS.md) e o backend expoe a lista
      // em /api/games/system/bios — se nao tiver nenhum arquivo la, so
      // segue sem bios mesmo (loga um aviso, mas nao trava o launch).
      let bios: string[] = [];
      try {
        bios = (await api.listBios()).files;
      } catch {
        // sem bios configurada ainda - segue sem, RetroArch vai reclamar
        // sozinho na tela se o jogo realmente precisar de uma.
      }
      return Nostalgist.launch({ core: "pcsx_rearmed", bios, ...opts });
    }
  }
}

export type { Nostalgist };
