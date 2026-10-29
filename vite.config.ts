import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // MapLibre alone is ~800 kB minified; one chunk is fine for a local tool.
  build: { chunkSizeWarningLimit: 1200 },
});
