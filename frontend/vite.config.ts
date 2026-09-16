import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4070",
      "/roms": "http://localhost:4070",
      "/vendor": "http://localhost:4070",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        // App React normal (biblioteca, login, player desktop).
        main: resolve(__dirname, "index.html"),
        // Pagina standalone (sem React) carregada dentro do <iframe> do
        // GameScreen.html — ve GameController.setGame() em Player.tsx.
        gameWrapper: resolve(__dirname, "game-wrapper.html"),
      },
    },
  },
});
