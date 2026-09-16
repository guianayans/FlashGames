# BIOS de console

Alguns cores (hoje: PS1/`pcsx_rearmed`) só rodam jogo comercial com o
firmware original do console. É o **dump do seu próprio aparelho** — não
entra no repositório (mesmo motivo das ROMs em `PS1/`, `SNES/`, etc: não é
nosso pra redistribuir, nem em repo privado). Esta pasta em si é
versionada (só pra deixar claro onde o arquivo vai), mas qualquer arquivo
que você colocar aqui dentro fica de fora do git — ver `.gitignore`.

Coloque o(s) arquivo(s) direto aqui. **O nome do arquivo importa e é
case-sensitive** (o pcsx_rearmed procura em minúsculo) — segundo a doc
oficial (https://docs.libretro.com/library/pcsx_rearmed/), a ordem de
prioridade é:

- `psxonpsp660.bin`
- `scph101.bin`
- `scph7001.bin`
- `scph5501.bin`
- `scph1001.bin`

Se nenhum desses bater, o core cai pro fallback: qualquer arquivo cujo
nome comece com `scph` (minúsculo) — então um dump como `scph7003.bin`
funciona por esse fallback, mas `SCPH7003.bin` (maiúsculo) **não é
reconhecido** e o core cai sozinho pro modo HLE (BIOS emulada, com menos
compatibilidade — alguns jogos dão tela preta ou tem problema de memory
card). Renomeie o arquivo pra minúsculo se vier de algum lugar com
maiúsculas.

O backend expõe a lista em `/api/games/system/bios` e o core lê todos os
arquivos daqui, escolhendo sozinho o certo pra região do jogo — ver
`ROMS.md`.
