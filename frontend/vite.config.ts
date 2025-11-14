import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/static/frontend/",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "../django/app/staticfiles/frontend",
    emptyOutDir: true,
    manifest: true,
    assetsDir: "assets",
  },
});
