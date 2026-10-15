import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const person = (page: Page, p: { id: string; name: string; email: string } | null) =>
  page.addInitScript((v) => { if (v) localStorage.setItem("kihub-testnutzer", JSON.stringify(v)); else localStorage.removeItem("kihub-testnutzer"); }, p);

test("Rechte: ohne Berechtigung kein Baukasten, kein Assistent, keine Verwaltung", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await person(page, { id: "u1", name: "Max Muster", email: "max.muster@firma.de" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welche Aufgabe/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Baukasten" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Verwaltung" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Neue Applikation" })).toHaveCount(0);
  await page.goto("/baukasten");
  await expect(page.getByRole("heading", { name: "Dafür fehlt dir das Recht." })).toBeVisible();
  await page.goto("/neu");
  await expect(page.getByRole("heading", { name: "Dafür fehlt dir das Recht." })).toBeVisible();
  await page.goto("/verwaltung");
  await expect(page.getByRole("heading", { name: "Dafür fehlt dir das Recht." })).toBeVisible();
  // In der App: kein Bearbeiten, kein Kopieren in den Baukasten
  await page.goto("/app/protokoll");
  await expect(page.getByRole("button", { name: /Baukasten/ })).toHaveCount(0);
  // Die Anmeldung wurde in der Liste vermerkt
  const anm = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-anmeldungen") || "[]"));
  expect(anm[0]?.email).toBe("max.muster@firma.de");
  // Die Anmeldung schreibt nie die Rechte selbst (sonst überschreiben gleichzeitige Anmeldungen die Verwaltung)
  expect(await page.evaluate(() => localStorage.getItem("kihub-rechte"))).toBeNull();
});

test("Rechte: Verwaltung vergibt Rechte, Baukasten zeigt Personen je App", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  // Vorher hat sich Max angemeldet (eigene Anmeldung, noch ohne Rechte)
  await page.addInitScript(() => localStorage.setItem("kihub-anmeldungen", JSON.stringify([{ id: "u1", name: "Max Muster", email: "max.muster@firma.de", zuletzt: "2026-10-13T10:00:00.000Z" }])));
  await person(page, { id: "a1", name: "Dario Keller", email: "dario.keller@koerber.com" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Verwaltung" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Baukasten" })).toBeVisible();
  await page.getByRole("link", { name: "Verwaltung" }).click();
  await expect(page.getByRole("heading", { name: "Personen und Rechte" })).toBeVisible();
  // Feste Verwaltung: alle Rechte, nicht änderbar
  await expect(page.getByRole("checkbox", { name: "Verwaltung für Dario Keller", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Verwaltung für Dario Keller", exact: true })).toBeDisabled();
  // Max bekommt Baukasten und KI-Assistent
  await page.getByRole("checkbox", { name: "Baukasten für Max Muster" }).check();
  await page.getByRole("checkbox", { name: "KI-Assistent für Max Muster" }).check();
  // Eine weitere Person vormerken
  await page.getByLabel("E-Mail-Adresse einer Person").fill("erika@firma.de");
  await page.getByRole("button", { name: "Person vormerken" }).click();
  await expect(page.getByRole("checkbox", { name: "Baukasten für erika@firma.de" })).toBeVisible();
  await page.getByRole("button", { name: "Rechte speichern" }).click();
  await expect(page.getByText("Rechte gespeichert.")).toBeVisible();
  const stand = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-rechte") || "{}"));
  expect(stand.nutzer.find((n: { email: string }) => n.email === "max.muster@firma.de").rechte.sort()).toEqual(["assistent", "bauen"]);
  expect(stand.nutzer.some((n: { email: string }) => n.email === "erika@firma.de")).toBe(true);
  // Gemeinsamer Speicher: noch keiner eingerichtet, „In diesem Browser verwenden“ erst nach erfolgreicher Prüfung
  await expect(page.getByRole("heading", { name: "Gemeinsamer Speicher" })).toBeVisible();
  await expect(page.getByText(/liegen nur in diesem Browser/)).toBeVisible();
  await expect(page.getByRole("button", { name: "In diesem Browser verwenden" })).toBeDisabled();
  await page.screenshot({ path: "screenshots/desktop-verwaltung.png", fullPage: true });
  // Im Baukasten: Freigabe-Reiter mit Personen je App
  await page.goto("/baukasten?kopie=protokoll");
  await page.getByRole("tab", { name: "Freigabe", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Max Muster max.muster@firma.de" }).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Max Muster max.muster@firma.de" }).first().check();
  await expect(page.getByText(/Ohne Auswahl darf jede Person mit Baukasten-Recht/)).toBeVisible();
});

test("Rechte: Max darf nach der Vergabe bauen, aber nicht verwalten; fremde App nur mit Eintrag", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript(() => {
    localStorage.setItem("kihub-rechte", JSON.stringify({ nutzer: [{ id: "u1", name: "Max Muster", email: "max.muster@firma.de", zuletzt: "", rechte: ["bauen"] }] }));
    // Eine App von Dario, nur er darf bearbeiten; Nutzung für alle
    localStorage.setItem("kihub-apps-v3", JSON.stringify([{ id: "app-dario", v: 2, typ: "baukasten", name: "Darios App", bereich: "Allgemein", beschreibung: "Test", erstelltVon: "dario.keller@koerber.com", rechte: { bearbeiten: [], nutzen: [] },
      blocks: [{ id: "s1", type: "section", props: { bg: "", pad: "m", border: true }, children: [{ id: "h1", type: "heading", props: { text: "Darios App", level: 1, align: "left", color: "" } }] }], steps: [], status: "entwurf", version: 1, geaendert: "2026-10-13T10:00:00.000Z" }]));
  });
  await person(page, { id: "u1", name: "Max Muster", email: "max.muster@firma.de" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Baukasten" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verwaltung" })).toHaveCount(0);
  await page.goto("/app/app-dario");
  await expect(page.getByRole("heading", { name: "Darios App", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Im Baukasten bearbeiten" })).toHaveCount(0);
  await page.goto("/baukasten/app-dario");
  await expect(page.getByRole("heading", { name: "Dafür fehlt dir das Recht." })).toBeVisible();
  // Eigene neue App bauen geht
  await page.goto("/baukasten");
  await expect(page.getByRole("heading", { name: "Applikation", exact: true })).toBeVisible();
});

test("Speicher: Konfiguration aus dem Browser hat Vorrang, Personenliste führt Rechte und Anmeldungen zusammen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const sp = await import("/src/lib/speicher.ts");
    const re = await import("/src/lib/rechte.ts");
    const vorher = await sp.speicherKonfig();
    sp.browserOrdnerSetzen("https://firma.sharepoint.com/sites/KI/Freigegebene Dokumente/KI-Hub");
    const nachher = await sp.speicherKonfig();
    sp.browserOrdnerSetzen(null);
    const zurueck = await sp.speicherKonfig();
    const liste = re.personenListe({ nutzer: [{ id: "", name: "", email: "Erika@firma.de", zuletzt: "", rechte: ["bauen"] }] },
      [{ id: "e1", name: "Erika M.", email: "erika@firma.de", zuletzt: "2026-10-14T08:00:00Z" }, { id: "m1", name: "Max", email: "max@firma.de", zuletzt: "2026-10-14T09:00:00Z" }]);
    return { vorher, nachher, zurueck, liste };
  });
  expect(r.vorher).toEqual({ art: "lokal" });
  expect(r.nachher).toEqual({ art: "sharepoint", ordner: "https://firma.sharepoint.com/sites/KI/Freigegebene Dokumente/KI-Hub", quelle: "browser" });
  expect(r.zurueck).toEqual({ art: "lokal" });
  expect(r.liste).toEqual([
    { id: "e1", name: "Erika M.", email: "Erika@firma.de", zuletzt: "2026-10-14T08:00:00Z", rechte: ["bauen"] },
    { id: "m1", name: "Max", email: "max@firma.de", zuletzt: "2026-10-14T09:00:00Z", rechte: [] },
  ]);
});

test("Rechte: feste Rechte aus der Hub-Konfiguration gelten in jedem Browser", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.route("**/hub-config.json", (r) => r.fulfill({ json: { speicher: { ordner: "" }, rechte: { "Max.Muster@firma.de": ["bauen", "assistent", "unsinn"] } } }));
  await person(page, { id: "u1", name: "Max Muster", email: "max.muster@firma.de" });
  await page.goto("/");
  // Ohne Eintrag im Browser-Speicher: Baukasten ja, Verwaltung nein
  await expect(page.getByRole("link", { name: "Baukasten" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verwaltung" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("kihub-rechte"))).toBeNull();
  // Die Verwaltung sieht die Person mit festen, nicht abwählbaren Rechten
  await person(page, { id: "a1", name: "Dario Keller", email: "dario.keller@koerber.com" });
  await page.goto("/verwaltung");
  await expect(page.getByText("Fest in der Hub-Konfiguration: Baukasten, KI-Assistent")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Baukasten für (Max Muster|max\.muster@firma\.de)$/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^Freigeben für (Max Muster|max\.muster@firma\.de)$/ })).toBeEnabled();
});

test("Hub-Konfiguration: Rouven Lips darf Baukasten und KI-Assistent", () => {
  const cfg = JSON.parse(readFileSync("public/hub-config.json", "utf8"));
  expect(cfg.rechte["rouven.lips@koerber.com"]).toEqual(["bauen", "assistent"]);
});
