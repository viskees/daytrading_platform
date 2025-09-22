import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/static/frontend/",
  build: {
    outDir: "../django/app/staticfiles/frontend",
    emptyOutDir: true,
    manifest: true,
    assetsDir: "assets",
  },
});
