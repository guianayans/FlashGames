# Como adicionar jogos (emuladores)

O app roda ROMs de console antigo via [EmulatorJS](https://emulatorjs.org).
Cada sistema suportado tem uma pasta na raiz do projeto, montada dentro do
container (bind mount) — dá pra adicionar ROM nova sem rebuildar a imagem:

- `SNES/` — Super Nintendo (`.sfc`, `.smc`, `.zip`)
- `NES/` — Nintendo/Famicom (`.nes`, `.zip`)
- `GENESIS/` — Mega Drive/Genesis (`.md`, `.gen`, `.bin`, `.zip`)
- `GBA/` — Game Boy Advance (`.gba`, `.zip`)
- `PS1/` — PlayStation, **uma pasta por jogo** (não é 1 arquivo solto como
  os outros). Dentro de cada pasta, o scanner escolhe sozinho o arquivo
  "principal" (`.m3u` > `.cue` > `.chd` > `.pbp` > `.ccd`, e só cai pro
  `.bin`/`.iso`/`.img` solto se não achar nenhum desses).

## PS1: BIOS obrigatória

O core do PS1 (`pcsx_rearmed`) só consegue rodar jogo comercial com uma
**BIOS** do console (o firmware do próprio PS1 — não é algo que a gente
redistribui, tem que ser um dump seu). Sem ela, o emulador não consegue
carregar o jogo e cai direto na tela de menu do RetroArch ("Load Core").

Coloque o(s) arquivo(s) de BIOS (ex. `SCPH1001.BIN` para jogos americanos,
`SCPH5501.BIN` para europeus, `SCPH5500.BIN` para japoneses) dentro da
pasta `BIOS/` na raiz do projeto — fora de `PS1/`, pra não ser confundido
com jogo. O core lê todos os arquivos que tiver lá e escolhe sozinho o
certo pra região do jogo.

## Uso básico: só soltar o arquivo

Não precisa de manifest nem de pasta por jogo — basta colocar o arquivo da
ROM (que você já possui legalmente) direto dentro da pasta do sistema
certo, em qualquer nível (pode organizar em subpastas, ex. por letra, como
já vem numa coleção — o scanner varre tudo recursivamente). O `.zip` pode
ser a ROM zipada direto (o EmulatorJS extrai sozinho).

O **título** exibido é o nome do arquivo sem a extensão (ex.
`Chrono Trigger (USA).zip` → "Chrono Trigger (USA)"). O **slug** (usado na
URL) é gerado automaticamente a partir do nome do arquivo + sistema.

## Opcional: capa e descrição

Ao lado do arquivo da ROM, com o **mesmo nome** (sem a extensão da ROM):

- `Nome do Jogo.jpg` (ou `.png`/`.webp`) — capa do card na biblioteca.
- `Nome do Jogo.json` — sobrescreve campos automáticos:

```json
{
  "title": "Chrono Trigger",
  "description": "Descrição curta.",
  "category": "rpg",
  "tags": ["squaresoft", "1995"]
}
```

Todos os campos do `.json` são opcionais.

## Categorias

As categorias (cor/ícone dos chips) ficam em `frontend/src/categories.ts`
(`CATEGORY_META`) — sem `category` no `.json`, o jogo cai em "Outros". O
filtro principal da biblioteca hoje é por **sistema** (SNES/NES/Genesis/
GBA), não por categoria.

## Controles

O controle físico do handheld (d-pad, X/Y/A/B, L/R, SELECT/START) já segue
o padrão de um controle de console — não precisa configurar nada por jogo.
Se quiser trocar qual tecla de teclado cada botão dispara (afeta todos os
jogos, é global), use a engrenagem ⚙ dentro do player mobile.

## Jogos Flash antigos

O suporte a `.swf`/Ruffle foi removido. As pastas antigas em `games/`
continuam no disco (nada foi apagado), mas não aparecem mais na
biblioteca.
