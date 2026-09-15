export interface GameSummary {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  cover: string | null;
  width: number;
  height: number;
}

export interface DpadConfig {
  up?: string;
  down?: string;
  left?: string;
  right?: string;
}

export interface AimJoystickConfig {
  label?: string;
  fireOnHold?: boolean;
  radius?: number;
}

export interface ButtonConfig {
  id: string;
  label: string;
  key: string;
  position: string;
}

export interface ControlsConfig {
  dpad?: DpadConfig;
  /** segundo d-pad opcional, pra jogos de 2 jogadores no mesmo teclado (ex: Fireboy & Watergirl) */
  dpad2?: DpadConfig;
  aimJoystick?: AimJoystickConfig;
  buttons?: ButtonConfig[];
}

export interface GameDetail extends GameSummary {
  swf: string;
  controls?: ControlsConfig;
}

export interface User {
  id: number;
  username: string;
}
