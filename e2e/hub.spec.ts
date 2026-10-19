import { test, expect, type Page } from "@playwright/test";

/** Die Seite selbst darf nie scrollen. */
async function scrolltNicht(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
}

async function bereichWaehlen(page: Page, name: string) {
  const breit = (page.viewportSize()?.width ?? 0) > 900;
  if (breit) await page.getByRole("group", { name: "Bereiche" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  else await page.getByRole("combobox", { name: "Bereich" }).selectOption(name === "Alle Bereiche" ? "Alle" : name);
}

test("Startseite: Kacheln blättern, Bereichsfilter und Suche", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welche Aufgabe");
  // Breit steht die Anzahl neben der Suche, schmal in der Bereichsauswahl
  if ((page.viewportSize()?.width ?? 0) > 900) await expect(page.getByText("11 Applikationen")).toBeVisible();
  else await expect(page.getByRole("combobox", { name: "Bereich" })).toContainText("Alle Bereiche (11)");
  const kacheln = page.locator(".tiles-raster a.tile:not(.tile-new)");
  await expect(kacheln.first()).toBeVisible();
  await scrolltNicht(page);
  await page.screenshot({ path: `screenshots/${info.project.name}-hub.png` });

  // Alle Kacheln über die Seiten zählen
  const pager = page.getByRole("navigation", { name: "Seiten blättern" });
  let summe = await kacheln.count();
  // Auf der letzten Seite gibt es keinen „Weiter“-Knopf mehr (statt eines ausgegrauten)
  while (await pager.getByRole("button", { name: /^Weiter/ }).count()) {
    await pager.getByRole("button", { name: /^Weiter/ }).click();
    await page.waitForTimeout(250);
    summe += await kacheln.count();
  }
  expect(summe).toBe(11);

  await bereichWaehlen(page, "Vertrieb");
  await expect(page.getByRole("heading", { name: "Vertrieb", level: 2 })).toBeVisible();
  await expect(kacheln).toHaveCount(1);

  await bereichWaehlen(page, "Alle Bereiche");
  await page.getByRole("searchbox", { name: "Applikationen durchsuchen" }).fill("Meeting");
  await expect(kacheln).toHaveCount(1);
  await expect(kacheln.first()).toContainText("Meeting-Protokoll");
});

test("Adresse je App: aus dem Namen, alte Links führen weiter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  // Kachel führt auf die Adresse aus dem Namen („Meeting-Protokoll“), nicht auf die ID („protokoll“)
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Applikationen durchsuchen" }).fill("Meeting");
  await page.locator(".tiles-raster a.tile:not(.tile-new)").first().click();
  await expect(page).toHaveURL(/\/meeting-protokoll$/);
  await expect(page.getByRole("heading", { name: "Meeting-Protokoll", level: 1 })).toBeVisible();
  // Direkt aufgerufen, auch mit Umlaut-Ersatz und Bindestrich
  await page.goto("/e-mail-antwort");
  await expect(page.getByRole("heading", { name: "E-Mail-Antwort", level: 1 })).toBeVisible();
  // Alte Links: /app/<id> und die bloße ID landen auf der neuen Adresse
  await page.goto("/app/protokoll");
  await expect(page).toHaveURL(/\/meeting-protokoll$/);
  await page.goto("/protokoll");
  await expect(page).toHaveURL(/\/meeting-protokoll$/);
  // Feste Seiten bleiben, Unbekanntes meldet „nicht gefunden“
  await page.goto("/mein");
  await expect(page).toHaveURL(/\/mein$/);
  await page.goto("/gibt-es-nicht");
  await expect(page.getByText(/nicht gefunden/i).first()).toBeVisible();
});

test("App-Ansicht: Agenten-Team blättert zum Ergebnis", async ({ page }, info) => {
  await page.goto("/app/agenten-team");
  await expect(page.getByRole("heading", { name: "Agenten-Team", level: 1 })).toBeVisible();
  await scrolltNicht(page);
  const mehr = page.getByRole("button", { name: "Weitere Aktionen" });
  if (await mehr.isVisible()) { await mehr.click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }
  else await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await expect(page.getByLabel("Ausgangslage")).not.toHaveValue("");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|Erstellen/ }).click();
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
  // Ein Startweg: kein eigener Ausführen-Knopf, „Ergebnisse erstellen“ ist gesperrt und führt zu den fehlenden Feldern
  await expect(page.getByRole("button", { name: "Ausführen" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|Erstellen/ }).click({ force: true }); // aria-disabled: Playwright hält den Knopf sonst für gesperrt
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
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|^Weiter$|^Erstellen$/ }).click();
  await expect(page.locator(".e-kachel")).toHaveCount(2);
  await expect(page.locator(".e-kachel .status-pill").first()).toHaveText("Simulation");
});

test("App-Ansicht: Weiter erst, wenn die Pflichtfelder der Seite ausgefüllt sind", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/app/serviceangebot");
  const weiter = page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter/ });
  await expect(weiter).toHaveAttribute("aria-disabled", "true");
  await expect(weiter).toHaveAttribute("title", /Bitte zuerst ausfüllen: Service-Checkliste/);
  // Der Grund steht sichtbar über dem Blättern, die Punkte nach vorn sind gesperrt
  await expect(page.locator(".o-sperre")).toContainText("Bitte zuerst ausfüllen: Service-Checkliste");
  const nav = page.getByRole("navigation", { name: "Seiten blättern" });
  await expect(nav.getByRole("button", { name: /^Seite 2:/ })).toBeDisabled();
  await expect(nav.getByRole("button", { name: /^Seite 4:/ })).toBeDisabled();
  await expect(nav.getByRole("button", { name: /^Seite 1:/ })).toBeEnabled();
  // Abschaltbar in den App-Einstellungen
  const r = await page.evaluate(async () => {
    const s = await import("/src/lib/sanitize.ts");
    return [s.loadApp({ id: "x", name: "X", blocks: [], steps: [] })?.pflichtSperre, s.loadApp({ id: "x", name: "X", blocks: [], steps: [], pflichtSperre: false })?.pflichtSperre];
  });
  expect(r).toEqual([true, false]);
});

test("Kreisbezug: Lese-Schritt verlangt nie die Felder, die er selbst vorbelegt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/model.ts");
    const run = await import("/src/lib/runner.ts");
    const s = await import("/src/lib/sanitize.ts");
    const app = s.loadApp({
      id: "k", name: "Kreis", steps: [
        { id: "s1", key: "lesen", name: "Lesen", format: "json", autoAll: true, prompt: "Lies {{angebot}}" },
        { id: "s2", key: "bericht", name: "Bericht", format: "markdown", prompt: "Schreib aus {{umfang}}" },
      ],
      blocks: [
        { id: "p1", type: "seite", props: { titel: "Dokumente" }, children: [{ id: "f1", type: "file", props: { key: "angebot", label: "Angebot", pflicht: true } }] },
        { id: "p2", type: "seite", props: { titel: "Prüfen" }, children: [{ id: "f2", type: "textarea", props: { key: "umfang", label: "Lieferumfang", pflicht: true, aus: "lesen.umfang" } }] },
      ],
    })!;
    const fehlt = run.fehlendePflichtfelder(app, [app.steps[0]], {}, { angebot: { name: "a.docx", size: 1, type: "", text: "Inhalt" } });
    const kreis = s.loadApp({ ...JSON.parse(JSON.stringify(app)), steps: [{ ...app.steps[0], prompt: "Lies {{angebot}} und {{umfang}}" }, app.steps[1]] })!;
    return { nutzer: m.stepsUsing(app, "umfang"), fehlt, warnung: m.appWarnings(kreis).filter((w) => !w.weich).map((w) => w.text) };
  });
  // „umfang“ geht nur an den Bericht, nicht an den Lese-Schritt, der es ausfüllt
  expect(r.nutzer).toEqual([1]);
  expect(r.fehlt).toEqual([]);
  expect(r.warnung.some((t: string) => t.includes("nutzt {{umfang}}, das erst aus dem Ergebnis von „Lesen“ vorbelegt wird"))).toBe(true);
});
