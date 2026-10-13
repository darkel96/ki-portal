import { test, type Page } from "@playwright/test";

/**
 * Screenshot-Audit: fotografiert alle Seiten und Zustände in Desktop- und Handy-Ansicht nach screenshots/audit/.
 * Läuft nur auf Wunsch: AUDIT=1 npx playwright test e2e/audit.spec.ts
 */
test.skip(!process.env.AUDIT, "nur mit AUDIT=1");

async function shot(page: Page, name: string, p: string, full = false) {
  try { await page.screenshot({ path: `screenshots/audit/${p}-${name}.png`, fullPage: full }); } catch (e) { console.log("shot failed", name, e); }
}
const klick = async (page: Page, f: () => Promise<void>) => { try { await f(); await page.waitForTimeout(400); } catch (e) { console.log("klick failed", String(e).slice(0, 160)); } };
const T = { timeout: 4000 };

test("audit", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  await page.goto("/"); await page.waitForTimeout(600);
  await shot(page, "01-hub", p, true);
  await klick(page, () => page.locator(".ki-pill").click(T)); await shot(page, "02-kimenue", p); await page.keyboard.press("Escape");
  for (const id of ["serviceangebot", "cra-experte", "protokoll", "agenten-team", "angebotsvergleich"]) {
    await page.goto(`/app/${id}`); await page.waitForTimeout(600); await shot(page, `03-app-${id}`, p, true);
  }
  // Serviceangebot: Seite 2, 3
  await page.goto("/app/serviceangebot"); await page.waitForTimeout(500);
  await klick(page, () => page.getByRole("button", { name: "Details" }).click(T)); await shot(page, "04-app-details", p, true);
  await page.goto("/mein"); await page.waitForTimeout(600); await shot(page, "05-mein-apps", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Aufträge/ }).click(T)); await shot(page, "05-mein-auftraege", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Verlauf/ }).click(T)); await shot(page, "05-mein-verlauf", p, true);
  await page.goto("/neu"); await page.waitForTimeout(600); await shot(page, "06-neu", p, true);
  await page.goto("/baukasten?kopie=serviceangebot"); await page.waitForTimeout(800); await shot(page, "07-bk-oberflaeche", p);
  await klick(page, () => page.locator(".b[data-bid]").nth(1).click(T));
  await shot(page, "07-bk-block-gewaehlt", p);
  await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T)); await shot(page, "08-bk-ki", p);
  await klick(page, () => page.getByRole("tab", { name: "Wissen" }).first().click(T)); await shot(page, "08-bk-ki-wissen", p);
  await klick(page, () => page.getByRole("tab", { name: "Technische Vorschau" }).click(T)); await shot(page, "08-bk-ki-vorschau", p);
  await klick(page, () => page.getByRole("tab", { name: "Oberfläche" }).click(T));
  await klick(page, () => page.getByRole("button", { name: /Vorschau testen|Vorschau/ }).first().click(T)); await shot(page, "09-bk-vorschau", p);
  await klick(page, () => page.getByRole("button", { name: /Vorschau beenden|Zurück/ }).first().click(T));
  for (const t of ["Gestaltung", "Wissen", "Freigabe", "App"]) {
    await klick(page, () => page.getByRole("tab", { name: t, exact: true }).first().click(T)); await shot(page, `10-bk-app-${t}`, p);
  }
  await klick(page, () => page.getByRole("button", { name: /Exportieren/ }).click(T)); await shot(page, "11-bk-export", p); await page.keyboard.press("Escape");
  await klick(page, () => page.getByRole("link", { name: "Applikationen" }).click(T)); await shot(page, "12-bk-verwerfen", p); await page.keyboard.press("Escape");
  await page.goto("/gibtsnicht"); await page.waitForTimeout(400); await shot(page, "13-404", p);
});

test("audit2", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  // Ergebnisse (Simulation): Meeting-Protokoll
  const menue = async (name: RegExp) => {
    if (p === "mobil") { await klick(page, () => page.getByRole("button", { name: "Weitere Aktionen" }).click(T)); await klick(page, () => page.getByRole("menuitem", { name }).click(T)); }
    else await klick(page, () => page.getByRole("button", { name }).first().click(T));
  };
  await page.goto("/app/protokoll"); await page.waitForTimeout(500);
  await menue(/Beispieldaten einsetzen/);
  await klick(page, () => page.getByRole("button", { name: /Ergebnisse erstellen|Erstellen/ }).first().click(T));
  await page.waitForTimeout(800); await shot(page, "20-ergebnis-uebersicht", p, true);
  await klick(page, () => page.getByText("Öffnen", { exact: true }).first().click(T));
  await page.waitForTimeout(500); await shot(page, "21-ergebnis-detail", p, true);
  // Mein Hub mit Inhalt
  await page.goto("/app/angebot"); await page.waitForTimeout(500);
  await menue(/Zu Mein Hub/);
  await page.goto("/app/protokoll"); await page.waitForTimeout(400);
  await menue(/Zu Mein Hub/);
  await page.goto("/mein"); await page.waitForTimeout(600); await shot(page, "22-mein-mit-inhalt", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Verlauf/ }).click(T)); await shot(page, "22-mein-verlauf-inhalt", p, true);
  // Baukasten: Feld gewählt, App-Einstellungen, Panels auf dem Handy
  await page.goto("/baukasten?kopie=protokoll"); await page.waitForTimeout(800);
  if (p === "mobil") {
    await klick(page, () => page.getByRole("button", { name: "Bausteine" }).click(T)); await shot(page, "23-bk-bausteine", p);
    await klick(page, () => page.getByRole("button", { name: "Fläche" }).click(T));
  }
  await klick(page, () => page.locator(".b[data-bid]").filter({ hasText: "Besprechungsnotizen" }).first().click(T));
  if (p === "mobil") await klick(page, () => page.getByRole("button", { name: "Eigenschaften" }).click(T));
  await shot(page, "24-bk-feld", p, p === "mobil");
  await klick(page, () => page.getByRole("button", { name: "App-Einstellungen" }).click(T));
  for (const t of ["Gestaltung", "Wissen", "Freigabe"]) {
    await klick(page, () => page.getByRole("tab", { name: t, exact: true }).first().click(T)); await shot(page, `25-bk-app-${t}`, p, p === "mobil");
  }
  if (p === "mobil") {
    await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T));
    await klick(page, () => page.getByRole("button", { name: /Prüfung und Vorschau/ }).click(T)); await shot(page, "26-bk-ki-pruefung", p, true);
  }
});
