// Alguns controles (DualShock/DualSense por bluetooth no Chrome/Linux sao
// o caso mais comum) expoem um SEGUNDO "gamepad" fantasma so' pro
// acelerometro/giroscopio embutido — sempre marcado como connected:true
// (dispara 'gamepadconnected' de verdade), mas sem mapping "standard" e
// sem nenhum botao de verdade (fica sempre parado). Sem filtrar isso, UM
// UNICO controle fisico contava como 2 "gamepads" pro navigator: virava
// P2 fantasma que nunca recebe input (travando jogos que checam quantos
// controles estao conectados de verdade, ex. PS1/pcsx_rearmed) e/ou
// disparava um segundo 'gamepadconnected' que sobrescrevia o slot do
// controle real sem liberar o anterior (Biblioteca mostrando "P1 P2" com
// um controle fisico so' conectado). Usado em todo lugar que decide "tem
// um controle fisico de verdade aqui" — Player.tsx (useGamepadPlayer +
// SaveStateMenu + connectedPlayerCount), Library.tsx (poll fisico),
// RemotePairingModal.tsx e ConfirmDialog.tsx (navegacao por gamepad
// dentro dos modais).
export function isRealGamepad(gp: Gamepad | null | undefined): gp is Gamepad {
  return !!gp && gp.connected && gp.mapping === "standard";
}
