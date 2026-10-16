import { test, expect } from "@playwright/test";

const LANG = "Angebot: Hochregallager in Silobauweise mit 4 Gassen und 9.600 Palettenplätzen; 4 Regalbediengeräte; Palettenfördertechnik Vorzone mit 2 Aufgabe- und 2 Abgabestellen sowie Konturen- und Gewichtskontrolle; Lagerverwaltung mit SAP-EWM-Schnittstelle; Materialflussrechner und Visualisierung; Montage, Inbetriebnahme und 4 Wochen Probebetrieb; 3 Tage Schulung für max. 12 Personen. Explizit nicht enthalten: Bauwerk, Fundamente, Sprinkleranlage, Brandschutzkonzept, Netzwerk-Infrastruktur bis zum Schaltschrank, Staplerverkehr in der Vorzone, Datenmigration aus dem Altsystem. Kundenspezifikation fordert zusätzlich bzw. abweichend: ca. 8 % Industriepaletten.";

test("Ampel und mitwachsende Felder: Offenes und Widersprüchliches sticht ins Auge", async ({ page }, info) => {
  const app = {
    id: "ampel-test", name: "Prüfung", bereich: "Test", status: "freigegeben", version: 1,
    steps: [{ id: "s1", key: "bericht", name: "Bericht", prompt: "Schreib aus {{umfang}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Prüfen" }, children: [
      { id: "f1", type: "textarea", props: { key: "umfang", label: "Lieferumfang", rows: 3 } },
      { id: "f2", type: "select", props: { key: "s_umfang", label: "Status Lieferumfang", optionen: ["Sicher", "Unsicher", "Widersprüchlich"] } },
      { id: "f3", type: "textarea", props: { key: "plaetze", label: "Lagerplätze", rows: 3 } },
      { id: "f4", type: "select", props: { key: "s_plaetze", label: "Status Lagerplätze", optionen: ["Sicher", "Unsicher", "Widersprüchlich"] } },
      { id: "f5", type: "select", props: { key: "remote", label: "Remote Service", optionen: ["Ja", "Nein"] } },
      { id: "f6", type: "input", props: { key: "termin", label: "Termin" } },
    ] }, { id: "p2", type: "seite", props: { titel: "Bericht" }, children: [{ id: "o1", type: "output", props: { titel: "Bericht", quelle: "s1" } }] }],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/ampel-test");
  const feld = (k: string) => page.locator(`.o-field[data-key="${k}"]`);
  await page.getByLabel("Lieferumfang", { exact: true }).fill(LANG);
  await page.getByLabel("Status Lieferumfang").selectOption("Widersprüchlich");
  await page.getByLabel("Status Lagerplätze").selectOption("Unsicher");
  await page.getByLabel("Remote Service").selectOption("Nein");
  await page.getByLabel("Termin").fill("31.10.2026 [offen]");
  await expect(feld("s_umfang")).toHaveAttribute("data-ampel", "rot");
  await expect(feld("umfang")).toHaveAttribute("data-ampel", "rot"); // übernimmt die Ampel seines Status-Felds
  await expect(feld("s_plaetze")).toHaveAttribute("data-ampel", "gelb");
  await expect(feld("plaetze")).toHaveAttribute("data-ampel", "gelb");
  await expect(feld("remote")).not.toHaveAttribute("data-ampel"); // Ja/Nein bleibt neutral
  await expect(feld("termin")).toHaveAttribute("data-ampel", "gelb");
  await page.getByLabel("Status Lagerplätze").selectOption("Sicher");
  await expect(feld("s_plaetze")).toHaveAttribute("data-ampel", "gruen");
  // Langer Text: Feld wächst, statt intern zu scrollen
  const ta = page.getByLabel("Lieferumfang", { exact: true });
  const [h, sh] = await ta.evaluate((el) => [el.clientHeight, el.scrollHeight]);
  expect(sh - h).toBeLessThanOrEqual(2);
  expect(h).toBeGreaterThan(90);
  await page.screenshot({ path: `screenshots/${info.project.name}-ampel.png` });
});

test("Ampel-Regeln", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const a = await import("/src/lib/ampel.ts");
    return {
      werte: ["Widersprüchlich", "weicht ab", "Fehlt", "nicht erfüllt", "Unsicher", "zu klären", "Offen", "Sicher", "Bestätigt", "Ja", "Nein", "Hoch", "", "Erfüllt"].map(a.ampelWert),
      text: ["Lieferung [offen]", "Das widerspricht der Spezifikation", "Normaler Text ohne Marke"].map(a.ampelText),
    };
  });
  expect(r.werte).toEqual(["rot", "rot", "rot", "rot", "gelb", "gelb", "gelb", "gruen", "gruen", null, null, null, null, "gruen"]);
  expect(r.text).toEqual(["gelb", "rot", null]);
});

test("Prüfseite: Erklärung unter markierten Feldern, KI bekommt die Anweisung dazu", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const app = {
    id: "ampel-hinweis", name: "Prüfung", bereich: "Test", status: "freigegeben", version: 1,
    steps: [{ id: "s1", key: "lesen", name: "Lesen", format: "json", prompt: "Lies {{datei}}" }, { id: "s2", key: "bericht", name: "Bericht", prompt: "Schreib aus {{umfang}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Datei" }, children: [{ id: "f0", type: "textarea", props: { key: "datei", label: "Text" } }] },
      { id: "p2", type: "seite", props: { titel: "Prüfen" }, children: [
        { id: "f1", type: "textarea", props: { key: "umfang", label: "Lieferumfang", aus: "lesen.umfang" } },
        { id: "f2", type: "select", props: { key: "s_umfang", label: "Status Lieferumfang", aus: "lesen.status_umfang", optionen: ["Sicher", "Unsicher", "Widersprüchlich"] } },
        { id: "f3", type: "select", props: { key: "s_platz", label: "Status Lagerplätze", aus: "lesen.status_platz", optionen: ["Sicher", "Unsicher", "Widersprüchlich"] } },
      ] }, { id: "p3", type: "seite", props: { titel: "Bericht" }, children: [{ id: "o1", type: "output", props: { titel: "Bericht", quelle: "s2" } }] }],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/");
  const r = await page.evaluate(async (a) => {
    const s = await import("/src/lib/sanitize.ts");
    const rq = await import("/src/lib/request.ts");
    const v = await import("/src/lib/vorbelegung.ts");
    const x = s.loadApp(a)!;
    const antwort = JSON.stringify({ umfang: "Angebot ohne Datenmigration", status_umfang: { wert: "Widersprüchlich", hinweis: "Kunde fordert Datenmigration (Spezifikation 4.2), Angebot schließt sie aus." }, status_platz: "Unsicher" });
    return { lesen: rq.buildRequest(x, x.steps[0], {}).system, bericht: rq.buildRequest(x, x.steps[1], {}).system, vb: v.vorbelegungen(x, "lesen", antwort) };
  }, app);
  expect(r.lesen).toContain("Prüfseite: Ist ein Wert unsicher");
  expect(r.bericht).not.toContain("Prüfseite: Ist ein Wert unsicher");
  expect(r.vb?.s_umfang).toMatchObject({ wert: "Widersprüchlich", hinweis: "Kunde fordert Datenmigration (Spezifikation 4.2), Angebot schließt sie aus." });
  // Anzeige: ohne KI-Hinweis steht der Standardhinweis in Ampelfarbe unter dem Feld
  await page.goto("/app/ampel-hinweis");
  await page.getByLabel("Text").fill("x");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter/ }).click();
  await page.getByLabel("Status Lagerplätze").selectOption("Unsicher");
  await expect(page.locator('.o-field[data-key="s_platz"] .o-ampel-hinweis')).toContainText("Prüfen: Nicht eindeutig belegt.");
  await page.getByLabel("Status Lieferumfang").selectOption("Widersprüchlich");
  await expect(page.locator('.o-field[data-key="s_umfang"] .o-ampel-hinweis')).toContainText("Widerspruch: Die Angaben passen nicht zusammen.");
  await page.screenshot({ path: "screenshots/desktop-ampel-hinweis.png" });
  await page.getByLabel("Status Lagerplätze").selectOption("Sicher");
  await expect(page.locator('.o-field[data-key="s_platz"] .o-ampel-hinweis')).toHaveCount(0);
});

test("Ampel zuverlässig: Paare auch bei abweichenden Namen, Begründung als eigener Schlüssel, Überblick oben", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const ST = ["Sicher", "Unsicher", "Widersprüchlich"];
  const app = {
    id: "ampel-paare", name: "Prüfung", bereich: "Test", status: "freigegeben", version: 1,
    steps: [{ id: "s1", key: "lesen", name: "Lesen", format: "json", prompt: "Lies {{datei}}" }, { id: "s2", key: "bericht", name: "Bericht", prompt: "Schreib aus {{kap}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Datei" }, children: [{ id: "f0", type: "textarea", props: { key: "datei", label: "Text" } }] },
      { id: "p2", type: "seite", props: { titel: "Prüfen" }, children: [
        { id: "f1", type: "textarea", props: { key: "kap", label: "Lagerplätze und Kapazitäten", aus: "lesen.kap" } },
        { id: "f2", type: "select", props: { key: "s_kap", label: "Status Lagerplätze", aus: "lesen.status_kap", optionen: ST } },
        { id: "f3", type: "textarea", props: { key: "durchsatz", label: "Durchsatz und Leistung", aus: "lesen.durchsatz" } },
        { id: "f4", type: "select", props: { key: "s_durch", label: "Bewertung", aus: "lesen.status_durch", optionen: ST } },
        { id: "f5", type: "select", props: { key: "remote", label: "Remote Service", optionen: ["Ja", "Nein"] } },
      ] }, { id: "p3", type: "seite", props: { titel: "Bericht" }, children: [{ id: "o1", type: "output", props: { titel: "Bericht", quelle: "s2" } }] }],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/");
  const r = await page.evaluate(async (a) => {
    const s = await import("/src/lib/sanitize.ts");
    const am = await import("/src/lib/ampel.ts");
    const rq = await import("/src/lib/request.ts");
    const v = await import("/src/lib/vorbelegung.ts");
    const x = s.loadApp(a)!;
    const p = am.ampelPaare(x);
    const antwort = JSON.stringify({ kap: "Angebot 9.600, Kunde 9.500 plus Erweiterung", status_kap: "Widersprüchlich", status_kap_hinweis: "Erweiterung um eine Gasse (Spezifikation 2.1) fehlt im Angebot.", status_durch: { wert: "Unsicher", hinweis: "Spitzenlast 200/h nicht belegt." } });
    return { paare: [...p.zuStatus.entries()], nachricht: rq.buildRequest(x, x.steps[0], {}).nachricht, vb: v.vorbelegungen(x, "lesen", antwort) };
  }, app);
  // „Status Lagerplätze“ gehört zu „Lagerplätze und Kapazitäten“; „Bewertung“ steht direkt hinter „Durchsatz“; Ja/Nein ist kein Status
  expect(r.paare).toEqual([["kap", "s_kap"], ["durchsatz", "s_durch"]]);
  expect(r.nachricht).toContain('"status_kap_hinweis", "status_durch_hinweis"');
  expect(r.vb?.s_kap).toMatchObject({ wert: "Widersprüchlich", hinweis: "Erweiterung um eine Gasse (Spezifikation 2.1) fehlt im Angebot." });
  expect(r.vb?.s_durch).toMatchObject({ wert: "Unsicher", hinweis: "Spitzenlast 200/h nicht belegt." });

  await page.goto("/app/ampel-paare");
  await page.getByLabel("Text").fill("x");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter/ }).click();
  await page.getByLabel("Status Lagerplätze").selectOption("Widersprüchlich");
  await page.getByLabel("Bewertung").selectOption("Unsicher");
  const feld = (k: string) => page.locator(`.o-field[data-key="${k}"]`);
  await expect(feld("kap")).toHaveAttribute("data-ampel", "rot");
  await expect(feld("kap")).toHaveAttribute("data-ampel-geerbt", "");
  await expect(feld("durchsatz")).toHaveAttribute("data-ampel", "gelb");
  // Genau eine Erklärung je Paar, unter dem Status-Feld
  await expect(feld("kap").locator(".o-ampel-hinweis")).toHaveCount(0);
  await expect(feld("s_kap").locator(".o-ampel-hinweis")).toHaveCount(1);
  // Überblick oben, Klick führt zum Feld
  const summe = page.locator(".o-ampel-summe");
  await expect(summe).toContainText("Bitte prüfen: 1 Widerspruch, 1 unsicher");
  await expect(summe.getByRole("button", { name: "Durchsatz und Leistung" })).toBeVisible();
  await summe.getByRole("button", { name: "Lagerplätze und Kapazitäten" }).click();
  await expect(page.getByLabel("Status Lagerplätze")).toBeFocused();
  await page.screenshot({ path: "screenshots/desktop-ampel-paare.png" });
  await page.getByLabel("Status Lagerplätze").selectOption("Sicher");
  await page.getByLabel("Bewertung").selectOption("Sicher");
  await expect(summe).toHaveCount(0);
});

test("Mitwachsen gilt auch auf vollen Seiten (Verdichtung deckelt keine Textfelder)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const viele = Array.from({ length: 14 }, (_, i) => ({ id: `f${i}`, type: "textarea", props: { key: `t${i}`, label: `Thema ${i + 1}`, rows: 3 } }));
  const app = { id: "voll", name: "Voll", bereich: "Test", status: "freigegeben", version: 1, steps: [{ id: "s1", key: "b", name: "B", prompt: "{{t0}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Viel" }, children: viele }, { id: "p2", type: "seite", props: { titel: "E" }, children: [{ id: "o", type: "output", props: { titel: "E", quelle: "s1" } }] }] };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/voll");
  const lang = Array.from({ length: 8 }, (_, i) => `Hoch | Punkt ${i + 1} | Angebot weicht ab | klären`).join("\n");
  const ta = page.getByLabel("Thema 14");
  await ta.fill(lang);
  await expect.poll(() => page.locator(".app-frame").getAttribute("data-dicht")).not.toBe("0");
  const [h, sh] = await ta.evaluate((el) => [el.clientHeight, el.scrollHeight]);
  expect(sh - h).toBeLessThanOrEqual(2);
});

test("Ampel: „Bitte prüfen“ bleibt beim Scrollen oben, angesprungene Felder liegen frei darunter", async ({ page }, info) => {
  const ST = ["Sicher", "Unsicher", "Widersprüchlich"];
  const felder = Array.from({ length: 12 }, (_, i) => [
    { id: `t${i}`, type: "textarea", props: { key: `inhalt${i}`, label: `Kapitel ${i + 1}`, rows: 4 } },
    { id: `s${i}`, type: "select", props: { key: `s_inhalt${i}`, label: `Status Kapitel ${i + 1}`, optionen: ST } },
  ]).flat();
  const app = {
    id: "ampel-lang", name: "Prüfung lang", bereich: "Test", status: "freigegeben", version: 1,
    steps: [{ id: "s1", key: "bericht", name: "Bericht", prompt: "Schreib" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Prüfen" }, children: felder },
      { id: "p2", type: "seite", props: { titel: "Bericht" }, children: [{ id: "o1", type: "output", props: { titel: "Bericht", quelle: "s1" } }] }],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/ampel-lang");
  await page.getByLabel("Status Kapitel 1", { exact: true }).selectOption("Widersprüchlich");
  await page.getByLabel("Status Kapitel 12").selectOption("Unsicher");
  const summe = page.locator(".o-ampel-summe");
  await expect(summe).toContainText("Bitte prüfen: 1 Widerspruch, 1 unsicher");
  const blatt = page.locator(".app-inner.innen-scroll");
  await blatt.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  // Nach ganz unten gescrollt: die Leiste steht weiter oben im sichtbaren Bereich
  const oben = await blatt.boundingBox(), leiste = await summe.boundingBox();
  expect(leiste!.y).toBeGreaterThanOrEqual(oben!.y - 1);
  expect(leiste!.y).toBeLessThan(oben!.y + 20);
  await expect(summe).toBeInViewport();
  await page.screenshot({ path: `screenshots/${info.project.name}-ampel-sticky.png` });
  // Sprung zum ersten Kapitel: das Feld liegt unter der Leiste, nicht dahinter
  await summe.getByRole("button", { name: "Kapitel 1", exact: true }).click();
  const ziel = page.getByLabel("Status Kapitel 1", { exact: true });
  await expect(ziel).toBeFocused();
  await expect.poll(async () => { const z = await ziel.boundingBox(), l = await summe.boundingBox(); return z!.y >= l!.y + l!.height; }).toBe(true);
});
