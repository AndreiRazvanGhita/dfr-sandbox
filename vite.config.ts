import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset and data URLs, so the build works at any path (GitHub Pages serves it under /dfr-sandbox/).
  base: "./",
  server: { port: 5173 },
  // MapLibre alone is ~800 kB minified; one chunk is fine for a local tool.
  build: { chunkSizeWarningLimit: 1200 },
});
