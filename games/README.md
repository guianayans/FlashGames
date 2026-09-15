# Como adicionar um novo jogo

Esta pasta e montada dentro do container (bind mount), entao voce pode adicionar
jogos direto no servidor em `/pendriver/FlashGames/games/` sem precisar rebuildar
a imagem (so recarregar a pagina/backend detecta na proxima listagem).

1. Crie uma pasta com um slug (letras minusculas, numeros e hifen), ex: `games/meu-jogo/`.
2. Coloque o arquivo `.swf` dentro dela, ex: `games/meu-jogo/game.swf`.
3. (Opcional, mas recomendado) coloque uma imagem de capa, ex: `games/meu-jogo/cover.jpg`
   (qualquer proporcao serve — o card na biblioteca corta pra 8:5. Sem capa, o
   card mostra so a inicial do titulo).
4. Crie um `manifest.json` nessa pasta com este formato:

```json
{
  "slug": "meu-jogo",
  "title": "Nome do Jogo",
  "description": "Descricao curta.",
  "category": "acao",
  "tags": ["tiro", "zumbis"],
  "cover": "cover.jpg",
  "swf": "game.swf",
  "width": 640,
  "height": 480,
  "controls": {
    "dpad": { "up": "w", "down": "s", "left": "a", "right": "d" },
    "aimJoystick": { "label": "Mirar / Atirar", "fireOnHold": true, "radius": 140 },
    "buttons": [
      { "id": "acao1", "label": "Espaco", "key": " ", "position": "action-1" }
    ]
  }
}
```

`category`, `tags` e `cover` sao opcionais — sem `category` o jogo cai em
"Outros" na aba de filtro; sem `tags` ele so aparece em buscas pelo
titulo/descricao.

## Categorias disponiveis

As categorias (e cores/icones dos chips e badges) ficam mapeadas em
`frontend/src/categories.ts`. Hoje sao: `acao`, `estrategia`, `puzzle`,
`plataforma`, `arcade`, `simulacao`. Pra adicionar uma categoria nova, so acrescentar uma
entrada nesse arquivo (label acentuado, cor neon em hex, icone) e usar o
mesmo slug (minusculo, sem acento) no `category` do manifest.

## Campos de `controls` (todos opcionais)

- `dpad`: 4 direcoes que viram teclas de teclado (keydown/keyup) enquanto o
  jogador segura o botao na tela. Use o valor da tecla como em `KeyboardEvent.key`
  (ex: `"w"`, `"ArrowUp"`, `" "`).
- `dpad2`: um segundo d-pad (aparece do lado direito da tela) pra jogos de
  2 jogadores no mesmo teclado, tipo Fireboy & Watergirl — um dpad controla
  cada personagem.
- `aimJoystick`: analógico virtual (lado direito da tela) que move um mouse
  virtual a partir do centro da tela do jogo — bom para jogos de tiro top-down
  como o Boxhead. `fireOnHold: true` mantem o botao esquerdo do mouse pressionado
  enquanto o analógico estiver ativo (auto-fire). `radius` controla o raio (em
  pixels de tela) que o analógico visual aceita arrastar; a mira em si sempre
  cobre a tela inteira do jogo proporcionalmente.
- `buttons`: lista de botoes extras (recarregar, trocar arma, pausar, confirmar
  menu, etc). Cada botao dispara `keydown` ao tocar e `keyup` ao soltar.
  `position` e soltopositions pre-definidas do CSS
  (`action-1`, `action-2`, `weapon-1`..`weapon-4`, `menu-confirm`, `pause`) -
  veja `frontend/src/components/TouchControls.tsx` para adicionar novas.

Se `controls` nao for definido, o jogo ainda funciona no celular (o Ruffle
recebe toque como clique), so nao aparecem os botoes de teclado/direcao na tela
— funciona bem pra jogos de aponte-e-clique (ex: Snail Bob) sem configurar nada.

## Salvamento por usuario

O salvamento automatico funciona para qualquer jogo sem configuracao extra:
o frontend sincroniza as chaves do `localStorage` que o Ruffle usa para emular
o `SharedObject` do Flash (o "save" nativo do jogo) com o backend, por usuario
logado. Nao e necessario fazer nada especial no manifest para isso funcionar.

## De onde vieram os jogos e as capas inclusos

Os jogos que ja vem no catalogo sao todos jogos originais (nao usam marca
registrada de terceiros tipo Disney/Nintendo/Sega/Valve/Capcom) — dois lotes:

- 10 baixados de itens publicos do Internet Archive, verificados contra
  malware pela curadoria do proprio IA.
- 12 baixados do repositorio publico
  [AmmarSAA/Flash-Games-Directory](https://github.com/AmmarSAA/Flash-Games-Directory)
  (integridade conferida comparando o tamanho de cada `.swf` baixado com o
  tamanho do blob no repositorio).

Cada `manifest.json` tem um campo `source` com o link de onde o jogo veio.

As capas (`cover.jpg`) nao sao screenshots crus: partem de uma imagem real do
jogo (menu, tela de titulo ou gameplay, geralmente capturada de um item do
Internet Archive mesmo quando o `.swf` veio do outro repositorio) e passam
por um tratamento duotone (cor por categoria) + scanlines + grain, pra
ficarem visualmente consistentes com o resto da interface mesmo vindo de
fontes bem diferentes entre si (menu de titulo, gameplay, render 3D etc).

## Sobre os arquivos .swf e o repositorio publico

Os `.swf` de cada jogo **nao entram no git** (ver `.gitignore`: `games/**/*.swf`)
porque geralmente nao sao nossos pra redistribuir publicamente - so o
`manifest.json` de cada jogo fica versionado. Isso significa que, ao clonar
o repositorio em outro lugar, a pasta `games/` vem sem os `.swf`: e preciso
copiar os arquivos de volta manualmente (o servidor de producao ja tem eles
em `/pendriver/FlashGames/games/`, fora do controle do git).

