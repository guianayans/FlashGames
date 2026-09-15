# Como adicionar um novo jogo

Esta pasta e montada dentro do container (bind mount), entao voce pode adicionar
jogos direto no servidor em `/FlashGames/games/` sem precisar rebuildar a imagem
(so recarregar a pagina/backend detecta na proxima listagem).

1. Crie uma pasta com um slug (letras minusculas, numeros e hifen), ex: `games/meu-jogo/`.
2. Coloque o arquivo `.swf` dentro dela, ex: `games/meu-jogo/game.swf`.
3. Crie um `manifest.json` nessa pasta com este formato minimo:

```json
{
  "slug": "meu-jogo",
  "title": "Nome do Jogo",
  "description": "Descricao curta.",
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

## Campos de `controls` (todos opcionais)

- `dpad`: 4 direcoes que viram teclas de teclado (keydown/keyup) enquanto o
  jogador segura o botao na tela. Use o valor da tecla como em `KeyboardEvent.key`
  (ex: `"w"`, `"ArrowUp"`, `" "`).
- `aimJoystick`: analógico virtual (lado direito da tela) que move um mouse
  virtual a partir do centro da tela do jogo — bom para jogos de tiro top-down
  como o Boxhead. `fireOnHold: true` mantem o botao esquerdo do mouse pressionado
  enquanto o analógico estiver ativo (auto-fire). `radius` controla o quao longe
  do centro o "mouse virtual" se move (em pixels, na resolucao logica do jogo).
- `buttons`: lista de botoes extras (recarregar, trocar arma, pausar, confirmar
  menu, etc). Cada botao dispara `keydown` ao tocar e `keyup` ao soltar.
  `position` e soltopositions pre-definidas do CSS
  (`action-1`, `action-2`, `weapon-1`..`weapon-4`, `menu-confirm`, `pause`) -
  veja `frontend/src/components/TouchControls.tsx` para adicionar novas.

Se `controls` nao for definido, o jogo ainda funciona no celular (o Ruffle
recebe toque como clique), so nao aparecem os botoes de teclado/direcao na tela.

## Salvamento por usuario

O salvamento automatico funciona para qualquer jogo sem configuracao extra:
o frontend sincroniza as chaves do `localStorage` que o Ruffle usa para emular
o `SharedObject` do Flash (o "save" nativo do jogo) com o backend, por usuario
logado. Nao e necessario fazer nada especial no manifest para isso funcionar.

## Sobre os arquivos .swf e o repositorio publico

Os `.swf` de cada jogo **nao entram no git** (ver `.gitignore`: `games/**/*.swf`)
porque geralmente nao sao nossos pra redistribuir publicamente - so o
`manifest.json` de cada jogo fica versionado. Isso significa que, ao clonar
o repositorio em outro lugar, a pasta `games/` vem sem os `.swf`: e preciso
copiar os arquivos de volta manualmente (o servidor de producao ja tem eles
em `/FlashGames/games/`, fora do controle do git).

