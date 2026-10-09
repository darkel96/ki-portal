import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5174", trace: "retain-on-failure", locale: "de-DE" },
  webServer: { command: "npx vite --port 5174 --strictPort", url: "http://localhost:5174", reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "mobil", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
