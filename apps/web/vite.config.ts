import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Baked in at build time from Docker build args; "dev" defaults when unset.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "dev"),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA ?? "unknown"),
    __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME ?? ""),
  },
  server: {
    port: 5173,
    proxy: {
      // API endpoint is env-configurable; defaults match apps/api dev PORT.
      // Set VITE_API_URL when running the API on a different port.
      "/api": process.env.VITE_API_URL ?? "http://localhost:3001",
      "/health": process.env.VITE_API_URL ?? "http://localhost:3001",
    },
  },
});
