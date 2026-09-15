export {};

interface RufflePlayerElement extends HTMLElement {
  ruffle(): {
    load(options: { url: string; width?: number; height?: number }): Promise<void>;
  };
}

interface RuffleAPI {
  createPlayer(): RufflePlayerElement;
}

declare global {
  interface Window {
    RufflePlayer?: {
      newest?: () => RuffleAPI;
    };
  }
}
