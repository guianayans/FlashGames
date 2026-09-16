# BIOS de console

Alguns cores (hoje: PS1/`pcsx_rearmed`) só rodam jogo comercial com o
firmware original do console. É o **dump do seu próprio aparelho** — não
entra no repositório (mesmo motivo das ROMs em `PS1/`, `SNES/`, etc: não é
nosso pra redistribuir, nem em repo privado). Esta pasta em si é
versionada (só pra deixar claro onde o arquivo vai), mas qualquer arquivo
que você colocar aqui dentro fica de fora do git — ver `.gitignore`.

Coloque o(s) arquivo(s) direto aqui, ex. `SCPH1001.BIN` (EUA),
`SCPH5501.BIN` (Europa) ou `SCPH5500.BIN` (Japão). O backend expõe a
lista em `/api/games/system/bios` e o core lê todos os arquivos daqui,
escolhendo sozinho o certo pra região do jogo — ver `ROMS.md`.
