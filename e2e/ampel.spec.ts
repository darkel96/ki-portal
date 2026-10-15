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
