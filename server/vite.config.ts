/**
 * Baut den Hub-Dienst als eine Node-Datei (server/dist/index.mjs). Die Ablauf-Logik kommt unverändert aus src/lib;
 * nur Anmeldung, Konfiguration und der claude.ai-Testmodus werden durch Server-Fassungen ersetzt.
 */
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";

const wurzel = fileURLToPath(new URL("..", import.meta.url));
const ERSATZ: Record<string, string> = {
  "src/lib/ki/auth.ts": "server/src/alias/auth.ts",
  "src/lib/ki/config.ts": "server/src/alias/config.ts",
  "src/lib/ki/claudeTest.ts": "server/src/alias/claudeTest.ts",
};

const ersatz: Plugin = {
  name: "hub-dienst-ersatz",
  enforce: "pre",
  async resolveId(source, importer, opts) {
    const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
    if (!r) return null;
    const id = r.id.replace(/\\/g, "/");
    for (const [von, nach] of Object.entries(ERSATZ)) if (id.endsWith(von)) return join(wurzel, nach);
    return r;
  },
};

export default defineConfig({
  root: wurzel,
  plugins: [ersatz],
  resolve: { alias: { "@": join(wurzel, "src") } },
  build: {
    ssr: "server/src/index.ts",
    outDir: "server/dist",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: "index.mjs", format: "es" } },
  },
  ssr: { noExternal: true, target: "node" },
});
