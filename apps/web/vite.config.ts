import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // API endpoint is env-configurable; defaults match apps/api dev PORT.
      "/api": process.env.VITE_API_URL ?? "http://localhost:3001",
      "/health": process.env.VITE_API_URL ?? "http://localhost:3001",
    },
  },
});
