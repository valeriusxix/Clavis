import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root for both server and web (Vite only exposes VITE_* vars).
  envDir: "../..",
  server: { port: 5173 },
});
