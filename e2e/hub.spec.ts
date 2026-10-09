import { test, expect, type Page } from "@playwright/test";

/** Die Seite selbst darf nie scrollen. */
async function scrolltNicht(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
}

async function bereichWaehlen(page: Page, name: string) {
  const breit = (page.viewportSize()?.width ?? 0) > 900;
  if (breit) await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  else await page.getByRole("combobox", { name: "Bereich" }).selectOption(name === "Alle Bereiche" ? "Alle" : name);
}

test("Startseite: Kacheln blättern, Bereichsfilter und Suche", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welche Aufgabe");
  await expect(page.getByText("9 Applikationen")).toBeVisible();
  const kacheln = page.locator(".tiles-raster a.tile:not(.tile-new)");
  await expect(kacheln.first()).toBeVisible();
  await scrolltNicht(page);
  await page.screenshot({ path: `screenshots/${info.project.name}-hub.png` });

  // Alle Kacheln über die Seiten zählen
  const pager = page.getByRole("navigation", { name: "Seiten blättern" });
  let summe = await kacheln.count();
  while (await pager.getByRole("button", { name: /^Weiter/ }).isEnabled().catch(() => false)) {
    await pager.getByRole("button", { name: /^Weiter/ }).click();
    await page.waitForTimeout(250);
    summe += await kacheln.count();
  }
  expect(summe).toBe(9);

  await bereichWaehlen(page, "Vertrieb");
  await expect(page.getByRole("heading", { name: "Vertrieb", level: 2 })).toBeVisible();
  await expect(kacheln).toHaveCount(1);

  await bereichWaehlen(page, "Alle Bereiche");
  await page.getByRole("searchbox", { name: "Applikationen durchsuchen" }).fill("Protokoll");
  await expect(kacheln).toHaveCount(1);
  await expect(kacheln.first()).toContainText("Meeting-Protokoll");
});

test("App-Ansicht: Agenten-Team blättert zum Ergebnis", async ({ page }, info) => {
  await page.goto("/app/agenten-team");
  await expect(page.getByRole("heading", { name: "Agenten-Team", level: 1 })).toBeVisible();
  await scrolltNicht(page);
  const mehr = page.getByRole("button", { name: "Weitere Aktionen" });
  if (await mehr.isVisible()) { await mehr.click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }
  else await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await expect(page.getByLabel("Ausgangslage")).not.toHaveValue("");
  await page.getByRole("button", { name: "Ausführen" }).click();
  // Nach dem Start läuft alles durch; die Ergebnisse stehen als Kacheln in der Übersicht.
  await expect(page.getByLabel("Ausgangslage")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ergebnisse" })).toBeVisible();
  const kachel = page.locator(".e-kachel").first();
  await expect(kachel).toContainText("Verlauf und Ergebnis");
  await expect(kachel.locator(".status-pill")).toHaveText("Simulation");
  await expect(page.getByRole("navigation", { name: "Seiten blättern" })).toContainText("2 von 2");
  await scrolltNicht(page);
  await page.screenshot({ path: `screenshots/${info.project.name}-app.png` });
  await kachel.click();
  await expect(page.locator(".o-out pre.code").first()).toContainText("Ausgangslage");
  await page.getByRole("button", { name: "Alle Ergebnisse" }).click();
  await expect(page.locator(".e-kachel")).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück" }).click();
  await expect(page.getByLabel("Ausgangslage")).not.toHaveValue("");
});

test("App-Ansicht: Pflichtfelder werden markiert", async ({ page }) => {
  await page.goto("/app/mail-antwort");
  await page.getByRole("button", { name: "Ausführen" }).click();
  await expect(page.getByText("Bitte ausfüllen.").first()).toBeVisible();
  await expect(page.getByLabel(/Eingegangene E-Mail/)).toHaveAttribute("aria-invalid", "true");
});

test("Neue Applikation: ohne KI-Anbindung geht es in den Baukasten", async ({ page }, info) => {
  await page.goto("/neu");
  await expect(page.getByRole("heading", { name: "Was soll die Applikation tun?" })).toBeVisible();
  await scrolltNicht(page);
  await page.screenshot({ path: `screenshots/${info.project.name}-neu.png` });
  await page.getByRole("link", { name: "Im Baukasten selbst bauen" }).click();
  await expect(page).toHaveURL(/\/baukasten$/);
});

test("App-Ansicht: Weiter auf der letzten Eingabeseite erstellt alle Ergebnisse", async ({ page }) => {
  await page.goto("/app/stellenanzeige");
  await expect(page.getByRole("heading", { name: "Stellenanzeige", level: 1 })).toBeVisible();
  const mehr = page.getByRole("button", { name: "Weitere Aktionen" });
  if (await mehr.isVisible()) { await mehr.click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }
  else await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|^Weiter$/ }).click();
  await expect(page.locator(".e-kachel")).toHaveCount(2);
  await expect(page.locator(".e-kachel .status-pill").first()).toHaveText("Simulation");
});
