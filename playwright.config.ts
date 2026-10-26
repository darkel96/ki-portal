import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5174", trace: "retain-on-failure", locale: "de-DE" },
  webServer: [
    { command: "npx vite --port 5174 --strictPort", url: "http://localhost:5174", reuseExistingServer: true, timeout: 120_000 },
    // Hub-Dienst im Testmodus (Copilot-Attrappe) für die Tests zu Hintergrund-Läufen und Aufträgen
    { command: "npm run build:server && HUB_TESTMODUS=1 HUB_PORT=8787 HUB_GIT_REPO=test/hub HUB_GIT_TOKEN=test-git HUB_GIT_API=http://localhost:8787/attrappe/github HUB_DATEN=test-results/dienst-daten HUB_ATTRAPPE_MS=1500 HUB_ZEITPLAN_MS=3000 HUB_LERNEN_MS=3000 node server/dist/index.mjs", url: "http://localhost:8787/api/dienst", reuseExistingServer: true, timeout: 240_000 },
  ],
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "mobil", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
