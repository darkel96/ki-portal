import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Modus "artifact": Testfassung für claude.ai (relative Pfade, ohne Anmeldeseite, Router über „#/…“).
// Modus "pages": GitHub Pages unter /<repo>/ (relative Pfade, Router über „#/…“, weil Pages keine SPA-Weiterleitung kennt).
export default defineConfig(({ mode }) => ({
  base: mode === "artifact" || mode === "pages" ? "./" : "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        ...(mode === "artifact" ? {} : { redirect: fileURLToPath(new URL("./auth-redirect.html", import.meta.url)) }),
      } as Record<string, string>,
    },
  },
}));
