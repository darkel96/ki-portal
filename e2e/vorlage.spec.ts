import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as d from "docx";
import JSZip from "jszip";

const ERGEBNIS = `# Projektübergabe Brennecke

## Projektdaten
| Feld | Wert |
|---|---|
| Kunde | Brennecke Logistik |
| Auftrag | **AN-2026-1187** |

## Offene Punkte
- Abnahme Fördertechnik
- Schulung [offen]

1. Kickoff
2. Abnahme`;

test("Vorlage: Word-Ergebnis im Design der Vorlage", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  // Eigene Vorlage: Kopfzeile mit Firmenname, Deckblatt mit {{titel}}, Platzhalter {{inhalt}}, Schluss
  const vorlage = new d.Document({
    sections: [{
      headers: { default: new d.Header({ children: [new d.Paragraph("KSCA Kopfzeile {{datum}}")] }) },
      children: [
        new d.Paragraph({ children: [new d.TextRun("Deckblatt "), new d.TextRun({ text: "{{titel}}", bold: true })] }),
        new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun("Beispielüberschrift")] }),
        new d.Paragraph("{{inhalt}}"),
        new d.Paragraph("Freigabe: Unterschrift"),
      ],
    }],
  });
  const eigene = (await d.Packer.toBuffer(vorlage)).toString("base64");
  const angebot = readFileSync("testdaten/Angebot_Brennecke_AN-2026-1187.docx").toString("base64");
  const r = await page.evaluate(async ({ md, vorlagen }) => {
    const dok = await import("/src/lib/dokument.ts");
    const b64 = async (blob: Blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const meta = { titel: "Übergabe", app: "Projektübergabe" };
    const out: string[] = [];
    for (const v of vorlagen) out.push(await b64(await dok.dateiErzeugen("docx", md, { ...meta, vorlage: v })));
    return out;
  }, { md: ERGEBNIS, vorlagen: [eigene, angebot, Buffer.from("kein zip").toString("base64")] });

  const lesen = async (b64: string, name: string) => {
    const buf = Buffer.from(b64, "base64");
    writeFileSync(`screenshots/dateien/${name}.docx`, buf);
    const z = await JSZip.loadAsync(buf);
    const xml = await z.file("word/document.xml")!.async("string");
    const kopf = await Promise.all(Object.keys(z.files).filter((p) => /word\/header\d*\.xml$/.test(p)).map((p) => z.file(p)!.async("string")));
    const ok = await page.evaluate((x) => !new DOMParser().parseFromString(x, "application/xml").getElementsByTagName("parsererror").length, xml);
    return { ok, xml, text: xml.replace(/<[^>]+>/g, ""), kopf: kopf.join(" ").replace(/<[^>]+>/g, "") };
  };
  mkdirSync("screenshots/dateien", { recursive: true });
  const mitMarke = await lesen(r[0], "vorlage-eigene");
  const echt = await lesen(r[1], "vorlage-angebot");
  const kaputt = await lesen(r[2], "vorlage-kaputt");

  // Platzhalter: Inhalt genau an der Marke, Deckblatt und Schluss bleiben, Titel und Datum ersetzt
  expect(mitMarke.ok).toBe(true);
  expect(mitMarke.text).toContain("Deckblatt Projektübergabe Brennecke");
  expect(mitMarke.text).toContain("Brennecke Logistik");
  expect(mitMarke.text).toContain("Freigabe: Unterschrift");
  expect(mitMarke.text).not.toContain("{{");
  expect(mitMarke.text.indexOf("Beispielüberschrift")).toBeLessThan(mitMarke.text.indexOf("Projektdaten"));
  expect(mitMarke.text.indexOf("Abnahme Fördertechnik")).toBeLessThan(mitMarke.text.indexOf("Freigabe"));
  expect(mitMarke.kopf).toMatch(/KSCA Kopfzeile \d/);
  // „## Projektdaten“ ist das erste Kapitel: Formatvorlage der ersten Überschrift der Vorlage
  expect(mitMarke.xml).toMatch(/<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Projektdaten/);
  expect(mitMarke.xml).toContain("<w:tbl>");

  // Echte Firmenvorlage ohne Marke: Text der Vorlage weg, Inhalt und Seitenformat bleiben
  expect(echt.ok).toBe(true);
  expect(echt.text).toContain("Projektübergabe Brennecke");
  expect(echt.text).toContain("Abnahme Fördertechnik");
  expect(echt.text).not.toContain("Sehr geehrter Herr Albers");
  expect(echt.xml).toContain("<w:sectPr");

  // Kaputte Vorlage: Word im Hub-Design statt Fehler
  expect(kaputt.ok).toBe(true);
  expect(kaputt.text).toContain("Abnahme Fördertechnik");
});

test("Vorlage: Aufbau geht an die KI, die Word-Datei nie", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const s = await import("/src/lib/sanitize.ts");
    const rq = await import("/src/lib/request.ts");
    const as = await import("/src/lib/assistant.ts");
    const roh = (vorlage: unknown, format = "markdown") => ({ id: "v", name: "V", blocks: [], steps: [{ id: "s1", key: "bericht", name: "Bericht", format, prompt: "Schreib den Bericht.", vorlage }] });
    const app = s.loadApp(roh({ name: "Protokoll.docx", text: "# Übergabeprotokoll\n## Projektdaten\n| Feld | Wert |", docx: "UEsDBA==" }))!;
    const req = rq.buildRequest(app, app.steps[0], {});
    const json = s.loadApp(roh({ name: "x", text: "# Aufbau", docx: "" }, "json"))!;
    return {
      system: req.system,
      jsonSystem: rq.buildRequest(json, json.steps[0], {}).system,
      kaputt: s.loadApp(roh({ name: "x", text: "Aufbau", docx: "<script>" }))!.steps[0].vorlage,
      leer: s.loadApp(roh({ name: "x", text: "", docx: "" }))!.steps[0].vorlage,
      ohne: s.loadApp(roh(undefined))!.steps[0].vorlage,
      assistent: as.assistPrompt(app, "Mach es schöner", "alles"),
    };
  });
  expect(r.system).toContain("Vorlage für Aufbau und Stil („Protokoll.docx“)");
  expect(r.system).toContain("## Projektdaten");
  expect(r.system).toContain("[offen]");
  expect(r.jsonSystem).not.toContain("Vorlage für Aufbau");
  expect(r.kaputt).toEqual({ name: "x", text: "Aufbau", docx: "" });
  expect(r.leer).toBeNull();
  expect(r.ohne).toBeNull();
  expect(r.assistent).toContain("Übergabeprotokoll");
  expect(r.assistent).not.toContain("UEsDBA");
});

test("Vorlage im Editor hochladen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/baukasten?kopie=protokoll");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: "Feineinstellungen" }).first().click();
  await expect(page.getByRole("button", { name: "Beispieldatei hochladen" })).toBeVisible();
  await page.getByLabel("Vorlage hochladen").setInputFiles("testdaten/Angebot_Brennecke_AN-2026-1187.docx");
  await expect(page.getByText("Angebot_Brennecke_AN-2026-1187.docx")).toBeVisible();
  await expect(page.getByText("Aufbau und Word-Design")).toBeVisible();
  const aufbau = page.getByLabel("Aufbau, den die KI übernimmt");
  await expect(aufbau).toHaveValue(/Lieferumfang/);
  await page.screenshot({ path: `screenshots/${info.project.name}-vorlage.png` });
  // Die Anfrage-Vorschau zeigt den Aufbau als Teil der Anweisung
  await page.getByRole("tab", { name: "Technische Vorschau" }).click();
  await expect(page.locator("pre.ki-code")).toContainText("Vorlage für Aufbau und Stil");
  await page.getByRole("button", { name: "Vorlage entfernen" }).click();
  await expect(page.getByRole("button", { name: "Beispieldatei hochladen" })).toBeVisible();
});

test("Copilot-Strom: jedes Paket hält die Verbindung wach", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const n = await page.evaluate(async () => {
    const c = await import("/src/lib/ki/copilot.ts");
    const conv = (t: string) => `data: ${JSON.stringify({ id: "c1", messages: [{ text: "F" }, { text: t }] })}\n\n`;
    const res = new Response(new ReadableStream({ start(ctl) { const e = new TextEncoder(); ["A", "AB", "ABC", "ABCD"].forEach((t) => ctl.enqueue(e.encode(conv(t)))); ctl.close(); } }), { headers: { "content-type": "text/event-stream" } });
    let wach = 0;
    await c.streamLesen(res, "F", () => {}, 0, {}, () => { wach++; });
    return wach;
  });
  expect(n).toBeGreaterThanOrEqual(4);
});
