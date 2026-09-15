export interface GameSummary {
  slug: string;
  title: string;
  description: string;
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
