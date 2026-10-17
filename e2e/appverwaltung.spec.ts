import { test, expect } from "@playwright/test";

/** Apps verwalten: Vorlage übernehmen (gleiche ID), sperren und entsperren, Vorlage aus dem Hub nehmen und wieder einblenden */
test("Vorlage übernehmen: bearbeitete Fassung ersetzt das Original unter derselben ID", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/app/cra-experte");
  await page.getByRole("button", { name: "Vorlage übernehmen und bearbeiten" }).click();
  await expect(page).toHaveURL(/\/baukasten\/cra-experte$/);
  await page.getByRole("button", { name: /^Speichern/ }).click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  await page.goto("/app/cra-experte");
  await expect(page.getByRole("button", { name: "Im Baukasten bearbeiten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sperren" })).toBeVisible();
  const apps = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-apps-v3") || "[]") as { id: string }[]);
  expect(apps.map((a) => a.id)).toContain("cra-experte");
  // Übersicht zeigt die App nur einmal
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Fachexperte Cyber Resilience Act/ })).toHaveCount(1);
});

test("Sperren: nur Bearbeitende sehen die App, Verwaltung listet alle Apps", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const app = { id: "sperr-app", name: "Sperrtest", bereich: "Allgemein", status: "freigegeben", version: 1, steps: [], erstelltVon: "chef@firma.de",
    blocks: [{ id: "p1", type: "seite", props: { titel: "Start" }, children: [{ id: "t1", type: "text", props: { text: "Inhalt der App", size: "m", align: "left", color: "" } }] }] };
  // Nur beim ersten Laden setzen: Nach dem Sperren soll der gespeicherte Stand das erneute Laden überleben
  await page.addInitScript((a) => { if (!localStorage.getItem("kihub-apps-v3")) localStorage.setItem("kihub-apps-v3", JSON.stringify([a])); }, app);
  await page.goto("/app/sperr-app");
  await page.getByRole("button", { name: "Sperren" }).click();
  await expect(page.getByText("Diese Applikation ist gesperrt.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entsperren" })).toBeVisible();
  await expect(page.getByText("Inhalt der App")).toBeVisible();   // Bearbeitende sehen sie weiter
  // Eine Person ohne Rechte sieht nur den Hinweis
  await page.evaluate(() => localStorage.setItem("kihub-testnutzer", JSON.stringify({ id: "u1", name: "Max Muster", email: "max.muster@firma.de" })));
  await page.reload();
  await expect(page.getByText("Diese Applikation ist gesperrt.")).toBeVisible();
  await expect(page.getByText("Inhalt der App")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("kihub-testnutzer"));
  // Verwaltung: Tabelle mit Status, Entsperren, Vorlage aus dem Hub nehmen und wieder einblenden
  await page.goto("/verwaltung");
  const zeile = page.locator(".rv-apps tr", { hasText: "Sperrtest" });
  await expect(zeile).toContainText("Gesperrt");
  await zeile.getByRole("button", { name: "Entsperren" }).click();
  await expect(zeile).toContainText("Freigegeben");
  const vorlage = page.locator(".rv-apps tr", { hasText: "Meeting-Protokoll" }).first();
  await vorlage.getByRole("button", { name: "Aus dem Hub nehmen" }).click();
  await vorlage.getByRole("button", { name: "Wirklich aus dem Hub nehmen" }).click();
  await expect(page.locator(".rv-apps tr", { hasText: "Meeting-Protokoll" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Meeting-Protokoll/ })).toHaveCount(0);
  await page.goto("/verwaltung");
  await page.getByRole("button", { name: /Meeting-Protokoll.*wieder einblenden/ }).click();
  await expect(page.locator(".rv-apps tr", { hasText: "Meeting-Protokoll" })).toHaveCount(1);
  // Löschen der eigenen App mit Rückfrage
  const z2 = page.locator(".rv-apps tr", { hasText: "Sperrtest" });
  await z2.getByRole("button", { name: "Löschen" }).click();
  await z2.getByRole("button", { name: "Wirklich löschen" }).click();
  await expect(page.locator(".rv-apps tr", { hasText: "Sperrtest" })).toHaveCount(0);
});
