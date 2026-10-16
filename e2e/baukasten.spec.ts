import { test, expect, type Page, type Locator } from "@playwright/test";

/** Zieht mit echter Maus von a nach b (dnd-kit braucht mehrere Bewegungen). */
async function ziehen(page: Page, von: Locator, nach: Locator, oben: boolean | "unten" = false) {
  await nach.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
  const a = (await von.boundingBox())!;
  const b = (await nach.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
  const zy = oben === "unten" ? b.y + b.height - 12 : oben ? b.y + 6 : b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, zy, { steps: 14 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Liste der aktuell gezeigten Seite auf der Fläche */
const seitenListe = (page: Page) => page.locator(".stage .app-inner > .b-list");
const oben = (page: Page) => seitenListe(page).locator(":scope > .b");

test.describe("Baukasten", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "Ziehen und Ablegen wird auf Desktop geprüft; mobil gibt es Klick-zum-Hinzufügen");

  test("Spalten auf die Seite ziehen, Bausteine hinein und umsortieren", async ({ page }, info) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const n = await oben(page).count();
    await ziehen(page, page.getByRole("button", { name: "Spalten hinzufügen" }), seitenListe(page), "unten");
    await expect(oben(page)).toHaveCount(n + 1);

    const links = page.locator('[data-list$=":0"]').first();
    const rechts = page.locator('[data-list$=":1"]').first();
    await ziehen(page, page.getByRole("button", { name: "Auswahlliste hinzufügen" }), rechts);
    await expect(rechts.locator(':scope > .b[aria-label^="Auswahlliste"]')).toHaveCount(1);

    await ziehen(page, rechts.locator(":scope > .b").first(), links, true);
    await expect(links.locator(':scope > .b[aria-label^="Auswahlliste"]')).toHaveCount(1);
    await expect(rechts.locator(":scope > .b")).toHaveCount(0);

    // Ein Container darf nicht in sich selbst landen.
    const spalten = page.locator(".b:has(> .o-cols)").first();
    await ziehen(page, spalten.locator(".b-tag").first().locator(".."), rechts);
    await expect(oben(page)).toHaveCount(n + 1);
    await page.screenshot({ path: `screenshots/${info.project.name}-baukasten.png` });
  });

  test("Seiten: neue Seite anlegen und Baustein auf einen Seiten-Reiter ziehen", async ({ page }) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const reiter = page.getByRole("group", { name: "Seiten der Applikation" }).getByRole("button", { name: /Ergebnis/ }).filter({ has: page.locator(".s-no") });
    await expect(page.locator(".s-tab")).toHaveCount(2);
    const n = await oben(page).count();
    await ziehen(page, oben(page).first(), reiter);
    // Die Fläche wechselt auf Seite 2, dort liegt jetzt auch der verschobene Baustein.
    await expect(page.locator(".s-tab").nth(1)).toHaveAttribute("aria-current", "page");
    await expect(oben(page)).toHaveCount(2);
    await page.locator(".s-tab").first().click();
    await expect(oben(page)).toHaveCount(n - 1);

    await page.getByRole("button", { name: "Seite" }).filter({ hasText: "Seite" }).last().click();
    await expect(page.locator(".s-tab")).toHaveCount(3);
    await expect(page.locator(".s-tab").nth(1)).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Titel der Seite")).toBeVisible();
  });

  test("Rückgängig nach dem Löschen", async ({ page }) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const n = await oben(page).count();
    await oben(page).first().click();
    await page.getByRole("button", { name: "Löschen" }).first().click();
    await expect(oben(page)).toHaveCount(n - 1);
    await page.getByRole("button", { name: "Rückgängig (Strg+Z)" }).click();
    await expect(oben(page)).toHaveCount(n);
  });

  test("KI-Ablauf: Agenten-Team anlegen", async ({ page }, info) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
    await page.getByRole("button", { name: "Agenten-Team" }).last().click();
    await expect(page.getByRole("region", { name: /Schritt 2: Agenten-Team/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Agenten/ }).click();
    await expect(page.getByLabel("Name von Agent 1")).toHaveValue("Planer");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `screenshots/${info.project.name}-ki-ablauf.png` });
  });
});

test("Baukasten mobil: Baustein per Klick hinzufügen", async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 800, "nur mobil");
  await page.goto("/baukasten");
  await oben(page).first().waitFor();
  const n = await page.locator(".b").count();
  await page.getByRole("button", { name: "Bausteine", exact: true }).click();
  await page.getByRole("button", { name: "Hinweis hinzufügen" }).click();
  // Nach dem Hinzufügen zeigt der Baukasten wieder die Fläche.
  await expect(seitenListe(page)).toBeVisible();
  await expect(page.locator(".b")).toHaveCount(n + 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `screenshots/${info.project.name}-baukasten.png` });
});

test("Applikation aus Datei importieren: wird ein neuer, ungespeicherter Entwurf", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const app = { id: "fremd-1", name: "Reisekosten prüfen", status: "freigegeben", version: 7, erstelltVon: "kollege@firma.de", blocks: [{ id: "f1", type: "textarea", props: { key: "beleg", label: "Beleg" } }], steps: [{ id: "s1", key: "pruefung", name: "Prüfung", prompt: "Prüfe {{beleg}}" }] };
  await page.goto("/neu");
  await page.getByLabel("Exportierte Applikation auswählen").setInputFiles({ name: "reisekosten.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(app)) });
  await expect(page).toHaveURL(/\/baukasten$/);
  await expect(page.getByLabel("Name der Applikation")).toHaveValue("Reisekosten prüfen");
  // Ungespeichert: Punkt am Speichern-Knopf
  await expect(page.getByRole("button", { name: /Speichern \(ungespeicherte Änderungen\)/ })).toBeVisible();
  await page.getByRole("button", { name: /^Speichern/ }).first().click();
  await expect(page).toHaveURL(/\/app\//);
  expect(page.url()).not.toContain("fremd-1");
  // Kaputte Datei: verständliche Meldung, kein Wechsel
  await page.goto("/neu");
  await page.getByLabel("Exportierte Applikation auswählen").setInputFiles({ name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from("{nicht json") });
  await expect(page.getByText("Die Datei ist beschädigt oder keine exportierte Applikation.")).toBeVisible();
  await expect(page).toHaveURL(/\/neu$/);
});

test("Grundgerüste: ohne offene Punkte, öffnen im Baukasten mit geführtem Start", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const g = await import("/src/lib/gerueste.ts");
    const m = await import("/src/lib/model.ts");
    return g.GERUESTE.map((x) => ({ id: x.id, harte: m.appWarnings(x.bauen()).filter((w) => !w.weich).map((w) => w.text) }));
  });
  expect(r.length).toBe(5);
  for (const x of r) expect(x.harte, x.id).toEqual([]);
  await page.goto("/neu");
  await page.getByRole("button", { name: /Datei lesen → prüfen → Bericht/ }).click();
  await expect(page).toHaveURL(/\/baukasten$/);
  await expect(page.getByLabel("Name der Applikation")).toHaveValue("Datei prüfen und berichten");
  const f = page.getByRole("navigation", { name: "So entsteht deine Applikation" });
  await expect(f.getByRole("button", { name: /Eingaben anlegen \(erledigt\)/ })).toBeVisible();
  await expect(f.locator('[aria-current="step"]')).toContainText("Vorschau testen");
  await f.getByRole("button", { name: /Vorschau testen/ }).click();
  await expect(page.getByRole("button", { name: /Vorschau beenden|Zurück/ }).first()).toBeVisible();
  await expect(f.locator('[aria-current="step"]')).toContainText("Speichern");
  await f.getByRole("button", { name: "Hilfe ausblenden" }).click();
  await expect(f).toHaveCount(0);
});

test("KI-Assistent: Vorschläge nie angeschnitten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  for (const w of [1440, 1100]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/baukasten");
    const box = page.locator(".ai-sugg");
    await expect(box).toBeVisible();
    const r = await box.evaluate((el) => { const b = el.getBoundingClientRect(); return [...el.querySelectorAll("button")].map((x) => { const c = x.getBoundingClientRect(); return { sichtbar: c.top < b.bottom - 1, ganz: c.right <= b.right + 0.5 }; }); });
    expect(r.filter((x) => x.sichtbar).length).toBeGreaterThan(0);
    for (const x of r) if (x.sichtbar) expect(x.ganz).toBe(true);
  }
});
