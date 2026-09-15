import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4070",
      "/games": "http://localhost:4070",
      "/vendor": "http://localhost:4070",
    },
  },
  build: {
    outDir: "dist",
  },
});
