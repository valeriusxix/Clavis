import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repo root for both server and web (Vite only exposes VITE_* vars).
  envDir: "../..",
  server: {
    port: 5173,
    // Lets the app work with VITE_API_URL empty (same-origin /api).
    proxy: { "/api": "http://localhost:8787" },
  },
});
