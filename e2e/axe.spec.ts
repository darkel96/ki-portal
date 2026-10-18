import { test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Barrierefreiheit (axe-core, WCAG 2.1 A/AA) für die Kernseiten.
 * Läuft nur auf Wunsch: AUDIT=1 npx playwright test e2e/axe.spec.ts
 */
test.skip(!process.env.AUDIT, "nur mit AUDIT=1");

const SEITEN: [string, string][] = [["hub", "/"], ["app-serviceangebot", "/app/serviceangebot"], ["app-chat", "/app/cra-experte"], ["mein", "/mein"], ["neu", "/neu"], ["baukasten", "/baukasten?kopie=serviceangebot"], ["agenten", "/agenten"], ["verwaltung", "/verwaltung"]];

test("axe", async ({ page }, info) => {
  test.setTimeout(240_000);
  const alle: Record<string, unknown> = {};
  for (const [name, pfad] of SEITEN) {
    await page.goto(pfad); await page.waitForTimeout(800);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    alle[name] = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target, html: n.html.slice(0, 160), summary: n.failureSummary?.slice(0, 200) })), anzahl: v.nodes.length }));
  }
  const fs = await import("node:fs");
  fs.mkdirSync("screenshots/audit", { recursive: true });
  fs.writeFileSync(`screenshots/audit/axe-${info.project.name}.json`, JSON.stringify(alle, null, 2));
});
