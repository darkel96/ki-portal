import { test, expect, type Page } from "@playwright/test";

/** Menüpunkt in der App-Leiste: breit im Menü „Voreinstellungen“, schmal im Menü „Weitere Aktionen“. */
async function menue(page: Page, punkt: RegExp) {
  const breit = (page.viewportSize()?.width ?? 0) > 640;
  await page.getByRole("button", { name: breit ? /^Voreinstellungen/ : "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: punkt }).click();
}

test("Mein Hub: Voreinstellung, Auftrag, Ausführen und Verlauf", async ({ page }, info) => {
  await page.goto("/app/stellenanzeige");
  await expect(page.getByRole("heading", { name: "Stellenanzeige", level: 1 })).toBeVisible();
  const breit = (page.viewportSize()?.width ?? 0) > 640;
  if (breit) await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  else { await page.getByRole("button", { name: "Weitere Aktionen" }).click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }

  // Eingaben als Voreinstellung speichern
  await menue(page, /als Voreinstellung speichern/);
  await page.getByLabel("Name der Voreinstellung").fill("Buchhaltung Augsburg");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  // Felder leeren und über die Voreinstellung wieder laden
  await page.getByLabel(/^Position/).fill("");
  await menue(page, /Buchhaltung Augsburg/);
  await expect(page.getByLabel(/^Position/)).not.toHaveValue("");

  // Auftrag anlegen
  await menue(page, /Regelmäßig ausführen/);
  await page.getByLabel("Name des Auftrags").fill("Wöchentliche Stellenanzeige");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  // In Mein Hub ausführen
  await page.goto("/mein");
  await expect(page.getByRole("heading", { name: "Mein Hub" })).toBeVisible();
  await expect(page.locator(".mh-karte")).toContainText("Stellenanzeige");
  await expect(page.locator(".mh-vorlagen")).toContainText("Buchhaltung Augsburg");
  await page.getByRole("tab", { name: /Aufträge/ }).click();
  await expect(page.locator(".mh-karte")).toContainText("jeden Montag um 07:00 Uhr");
  await page.getByRole("button", { name: "Jetzt ausführen" }).click();
  await page.getByRole("tab", { name: /Verlauf/ }).click();
  const lauf = page.locator(".mh-lauf").first();
  await expect(lauf).toContainText("Wöchentliche Stellenanzeige");
  await expect(lauf.locator(".status-pill")).toHaveText("fertig");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `screenshots/${info.project.name}-meinhub.png` });
  await lauf.click();
  await expect(page.locator(".mh-detail .o-out")).toContainText("Sachbearbeitung");
});

test("Mein Hub: letztes Ergebnis aus der App, Voreinstellung umbenennen und löschen", async ({ page }) => {
  await page.goto("/app/stellenanzeige");
  await expect(page.getByRole("heading", { name: "Stellenanzeige", level: 1 })).toBeVisible();
  const breit = (page.viewportSize()?.width ?? 0) > 640;
  if (breit) await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  else { await page.getByRole("button", { name: "Weitere Aktionen" }).click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }
  await menue(page, /als Voreinstellung speichern/);
  await page.getByLabel("Name der Voreinstellung").fill("Alt");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  // Direkt in der App ausführen: landet als letztes Ergebnis in Mein Hub
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|^Weiter$/ }).click();
  await expect(page.locator(".e-kachel")).toHaveCount(2);
  await menue(page, /Letztes Ergebnis ansehen/);
  await expect(page.locator(".mh-detail")).toContainText("Stellenanzeige");

  await page.getByRole("tab", { name: /Meine Apps/ }).click();
  await expect(page.locator(".mh-letzter")).toContainText("Letztes Ergebnis");
  await page.getByRole("button", { name: "Voreinstellungen verwalten" }).click();
  const feld = page.getByLabel("Name der Voreinstellung Alt");
  await feld.fill("Neu benannt");
  await feld.press("Enter");
  await expect(page.locator(".vl-liste")).toBeVisible();
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page.getByRole("button", { name: "Wirklich löschen" }).click();
  await expect(page.locator(".vl-liste")).toHaveCount(0);
  await page.getByRole("button", { name: "Fertig" }).click();
  await expect(page.locator(".mh-vorlagen")).not.toContainText("Neu benannt");
});
