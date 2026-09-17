import { Nostalgist } from "nostalgist";
import { api } from "./api";
import type { SystemLauncher } from "./types";

export interface EmulatorConfig {
  launcher: SystemLauncher;
  romUrl: string;
  // Faixas/arquivos extras que o "rom" principal referencia (hoje so PS1
  // preenche isso — ver GameDetail.romExtras) — precisam ir TODOS juntos
  // pro emulador, senao um .cue com faixa em .bin separado nao acha o
  // que precisa e falha ao carregar o conteudo.
  romExtras?: string[];
  canvas: HTMLCanvasElement;
  // Chamado repetidas vezes durante o download com a fracao 0..1 baixada
  // ate agora (soma de bytes de TODOS os arquivos — rom + faixas extras +
  // bios). So preenchido pro PS1/PS2 (ver por que no comentario de
  // prefetchWithProgress) — pros outros sistemas (SNES/NES/Genesis/GBA,
  // via metodo de conveniencia do Nostalgist) nunca e' chamado.
  onProgress?: (fraction: number) => void;
}

// O Nostalgist, quando o "rom"/"bios" que a gente manda NAO e' uma URL
// absoluta (comeca com "http(s)://" ou "//"), tenta ser "esperto": pela
// extensao do arquivo, monta sozinho uma URL pra um repositorio de ROMs
// homebrew dele no GitHub (ex: qualquer ".bin" vira
// cdn.jsdelivr.net/.../retrobrews/md-games/...) — um atalho pensado pra
// quem passa so um nome de arquivo solto tipo "flappybird.nes" sem
// backend proprio. Isso derrubou silenciosamente jogo de PS1 com faixa em
// .bin separada (o .cue carrega, mas a faixa vem de um 404 de um jogo de
// Genesis aleatorio do GitHub). Resolvendo pra URL absoluta a gente
// desliga esse "adivinhador".
// Aplicado SO no PS1/PS2 (cases "psx"/"ps2" abaixo) de proposito: os
// outros sistemas (SNES/NES/Genesis/GBA, via Nostalgist.snes()/.nes()/
// etc) ja funcionavam normalmente com o caminho relativo, e forcar URL
// absoluta neles causou regressao (carregamento mais lento e tela preta)
// — sinal de que esses metodos de conveniencia fazem algo a mais com o
// valor de "rom" que nao se da bem com URL ja resolvida. Sem necessidade
// comprovada de mexer neles, melhor nao arriscar.
function toAbsoluteUrl(relativeOrAbsolute: string): string {
  return new URL(relativeOrAbsolute, window.location.origin).href;
}

function fileNameFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "arquivo");
}

async function contentLength(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return Number(res.headers.get("content-length") || 0);
  } catch {
    return 0;
  }
}

async function fetchWithByteProgress(url: string, onBytes: (n: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${fileNameFromUrl(url)} (${res.status})`);
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(chunks);
}

// Baixa uma lista de URLs (rom + faixas extras + bios juntos) na MAO, em
// vez de deixar o Nostalgist buscar cada uma sozinho por baixo dos panos
// — assim da pra somar o progresso de bytes de tudo (0..1) e mostrar uma
// barra de verdade em GameScreen/Player enquanto carrega. O tamanho de
// cada arquivo vem de um HEAD antes de comecar (Content-Length), pra
// saber o total antes de baixar qualquer byte.
// Devolve no formato {fileName, fileContent} que o Nostalgist aceita sem
// perder o nome (importante: um jogo de PS1 com .cue+.bin depende do
// nome de cada faixa bater exatamente com o que o .cue referencia — um
// Blob puro, sem nome, geraria um nome aleatorio e quebraria isso).
async function prefetchWithProgress(
  urls: string[],
  onProgress?: (fraction: number) => void
): Promise<{ fileName: string; fileContent: Blob }[]> {
  const sizes = await Promise.all(urls.map(contentLength));
  const total = sizes.reduce((a, b) => a + b, 0);
  let loaded = 0;
  const results: { fileName: string; fileContent: Blob }[] = [];
  for (const url of urls) {
    const fileContent = await fetchWithByteProgress(url, (n) => {
      loaded += n;
      if (total > 0) onProgress?.(Math.min(1, loaded / total));
    });
    results.push({ fileName: fileNameFromUrl(url), fileContent });
  }
  onProgress?.(1);
  return results;
}

// Nostalgist.js roda os mesmos cores libretro/RetroArch que o EmulatorJS
// usava por baixo dos panos, mas SEM nenhuma UI propria (sem menu, sem
// gamepad de toque) — a gente e quem desenha/controla tudo. Cada metodo
// (snes/nes/megadrive/gba) ja escolhe o core certo sozinho (snes9x/fceumm/
// genesis_plus_gx/mgba). Chamados via `Nostalgist.xxx(...)` diretamente (e
// nao guardados numa tabela de funcoes soltas) pra preservar o `this`
// interno da classe.
export async function loadEmulator(config: EmulatorConfig): Promise<Nostalgist> {
  const rom =
    config.romExtras && config.romExtras.length > 0 ? [config.romUrl, ...config.romExtras] : config.romUrl;
  const opts = { rom, element: config.canvas };
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
      let biosUrls: string[] = [];
      try {
        biosUrls = (await api.listBios()).files.map(toAbsoluteUrl);
      } catch {
        // sem bios configurada ainda - segue sem, RetroArch vai reclamar
        // sozinho na tela se o jogo realmente precisar de uma.
      }
      const romUrls = [config.romUrl, ...(config.romExtras || [])].map(toAbsoluteUrl);
      const allFiles = await prefetchWithProgress([...romUrls, ...biosUrls], config.onProgress);
      const psxRomFiles = allFiles.slice(0, romUrls.length);
      const psxBiosFiles = allFiles.slice(romUrls.length);
      return Nostalgist.launch({
        core: "pcsx_rearmed",
        bios: psxBiosFiles,
        rom: psxRomFiles.length === 1 ? psxRomFiles[0] : psxRomFiles,
        element: config.canvas,
        // O Nostalgist escreve os arquivos de "bios" em
        // /home/web_user/retroarch/userdata/system dentro do sistema de
        // arquivos virtual do RetroArch (isso e' fixo no proprio pacote,
        // ver node_modules/nostalgist "EmulatorFileSystem.systemDirectory"
        // — nao e' uma pasta real do servidor, existe so na memoria do
        // navegador enquanto o jogo esta aberto). Mas o Nostalgist NAO
        // seta o "system_directory" do retroarch.cfg pra combinar com
        // isso — fica no default de fabrica do RetroArch, que pode nao
        // ser exatamente esse caminho. Setando explicito aqui garante
        // que o core vai procurar a BIOS exatamente onde ela foi escrita.
        retroarchConfig: { system_directory: "/home/web_user/retroarch/userdata/system" },
        // Por padrao o core pula direto pro jogo — essa opcao liga a
        // animacao/logo de boot de verdade da BIOS (a mesma tela que
        // aparece ligando um PS1 de verdade). A doc do core avisa que
        // ISSO QUEBRA ALGUNS JOGOS especificos (nem todo jogo lida bem
        // com o boot completo da BIOS) — se algum jogo comecar a dar
        // problema depois disso, essa e' a primeira coisa a suspeitar.
        retroarchCoreConfig: { pcsx_rearmed_show_bios_bootlogo: "enabled" },
      });
    }
    case "ps2": {
      // TESTE de viabilidade — ver conversa. Sem metodo de conveniencia
      // (Nostalgist.ps2 nao existe) — core "pcsx2" (codinome "LRPS2") na
      // mao, mesmo criterio do PS1.
      //
      // BIOS do PS2 e' um caso especial: ao contrario de TODOS os outros
      // cores, o LRPS2 procura a bios em system/pcsx2/bios/ (uma SUBPASTA
      // dentro do diretorio de sistema), nao direto em system/. A opcao
      // "bios" do Nostalgist so escreve arquivo achatado direto em
      // system/<nome> (sem como apontar pra subpasta — ver
      // node_modules/nostalgist EmulatorFileSystem.writeFile/urlBaseName).
      // Pra contornar isso: launcha com `runEmulatorManually: true` (o
      // Nostalgist prepara o sistema de arquivos e escreve a ROM, mas NAO
      // inicia o core ainda), escreve a BIOS na mao direto no FS do
      // emscripten (getEmscriptenFS(), publico) na pasta certa, e so
      // DEPOIS chama start() pra realmente ligar o core.
      let biosUrls: string[] = [];
      try {
        biosUrls = (await api.listBios()).files.map(toAbsoluteUrl);
      } catch {
        // sem bios configurada ainda - segue sem.
      }
      const romUrl = toAbsoluteUrl(config.romUrl);
      const [romFile] = await prefetchWithProgress([romUrl], config.onProgress);
      const instance = await Nostalgist.launch({
        core: "pcsx2",
        rom: romFile,
        element: config.canvas,
        retroarchConfig: { system_directory: "/home/web_user/retroarch/userdata/system" },
        runEmulatorManually: true,
      });
      try {
        const FS = instance.getEmscriptenFS();
        const biosDir = "/home/web_user/retroarch/userdata/system/pcsx2/bios";
        FS.mkdirTree(biosDir);
        for (const url of biosUrls) {
          const res = await fetch(url);
          if (!res.ok) continue;
          const bytes = new Uint8Array(await res.arrayBuffer());
          FS.writeFile(`${biosDir}/${fileNameFromUrl(url)}`, bytes);
        }
      } catch {
        // sem bios configurada ainda, ou falhou escrevendo - segue mesmo
        // assim, o core vai reclamar sozinho na tela se precisar mesmo.
      }
      await instance.start();
      return instance;
    }
  }
}

export type { Nostalgist };
