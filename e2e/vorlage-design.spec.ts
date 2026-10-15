import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import * as d from "docx";
import JSZip from "jszip";

/** Firmenvorlage wie in der Praxis: eigene Stilnamen statt „Überschrift 1“, Text von Hand formatiert, farbige Tabellenkopfzeile, gebänderte Zeilen, eigene Aufzählungszeichen */
async function firmenvorlage(): Promise<string> {
  const zelle = (t: string, fill: string, kopf = false) => new d.TableCell({
    shading: { type: d.ShadingType.CLEAR, color: "auto", fill },
    children: [new d.Paragraph({ children: [new d.TextRun({ text: t, bold: kopf, color: kopf ? "FFFFFF" : "1F2A44", font: "Arial", size: 18 })] })],
  });
  const doc = new d.Document({
    styles: {
      paragraphStyles: [
        { id: "KSCAKapitel", name: "KSCA Kapitel", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 30, bold: true, color: "003366" }, paragraph: { outlineLevel: 0, spacing: { before: 360, after: 120 } } },
        { id: "KSCAUnterkapitel", name: "KSCA Unterkapitel", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 24, bold: true, color: "E87722" }, paragraph: { outlineLevel: 1, spacing: { before: 240, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "punkte", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "■", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } }, run: { color: "E87722" } } }] },
        { reference: "zahlen", levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: "%1)", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1700, left: 1300, right: 1300, bottom: 1400 } } },
      headers: { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: "KÖRBER · KSCA", bold: true, color: "003366", font: "Arial" })] })] }) },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ children: [new d.TextRun({ text: "Vertraulich · Seite ", size: 16, color: "808080" }), new d.TextRun({ children: [d.PageNumber.CURRENT], size: 16, color: "808080" })] })] }) },
      children: [
        new d.Paragraph({ children: [new d.TextRun({ text: "Projektübergabeprotokoll", font: "Arial", size: 44, bold: true, color: "003366" })] }),
        new d.Paragraph({ style: "KSCAKapitel", children: [new d.TextRun("1. Projektdaten")] }),
        new d.Paragraph({ spacing: { after: 160, line: 300 }, children: [new d.TextRun({ text: "Dieser Absatz zeigt den Fließtext der Firmenvorlage mit Arial in Dunkelblau und großzügigem Zeilenabstand.", font: "Arial", size: 20, color: "1F2A44" })] }),
        new d.Paragraph({ spacing: { after: 160, line: 300 }, children: [new d.TextRun({ text: "Noch ein Absatz im gleichen Stil, damit der Hub erkennt, welches Format der Fließtext hat.", font: "Arial", size: 20, color: "1F2A44" })] }),
        new d.Paragraph({ style: "KSCAUnterkapitel", children: [new d.TextRun("1.1 Beteiligte")] }),
        new d.Paragraph({ numbering: { reference: "punkte", level: 0 }, children: [new d.TextRun({ text: "Projektleitung", font: "Arial", size: 20 })] }),
        new d.Paragraph({ numbering: { reference: "zahlen", level: 0 }, children: [new d.TextRun({ text: "Erster Schritt", font: "Arial", size: 20 })] }),
        new d.Table({ rows: [
          new d.TableRow({ tableHeader: true, children: [zelle("Feld", "003366", true), zelle("Wert", "003366", true)] }),
          new d.TableRow({ children: [zelle("Kunde", "FFFFFF"), zelle("Muster GmbH", "FFFFFF")] }),
          new d.TableRow({ children: [zelle("Auftrag", "EEF3F8"), zelle("A-1", "EEF3F8")] }),
          new d.TableRow({ children: [zelle("Summe", "FFFFFF"), zelle("1", "FFFFFF")] }),
        ] }),
      ],
    }],
  });
  return (await d.Packer.toBuffer(doc)).toString("base64");
}

const ERGEBNIS = `# Projektübergabe Brennecke

## Projektdaten
Die Anlage geht nach erfolgreicher Abnahme in den Service über. Offene Punkte stehen unten.

| Feld | Wert |
|---|---|
| Kunde | Brennecke Logistik |
| Auftrag | AN-2026-1187 |
| Standort | Lohne |

### Beteiligte
- Projektleitung: Anna Berger
- Service: Tom Kraus

## Nächste Schritte
1. Abnahme Fördertechnik
2. Schulung planen

1. Zweite Liste beginnt wieder bei eins`;

test("Vorlage: Design der Firmenvorlage wird vollständig übernommen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const vorlage = await firmenvorlage();
  const b64 = await page.evaluate(async ({ md, vorlage }) => {
    const dok = await import("/src/lib/dokument.ts");
    const blob: Blob = await dok.dateiErzeugen("docx", md, { titel: "Übergabe", app: "Projektübergabe", vorlage });
    const u = new Uint8Array(await blob.arrayBuffer()); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  }, { md: ERGEBNIS, vorlage });
  mkdirSync("screenshots/dateien", { recursive: true });
  writeFileSync("screenshots/dateien/vorlage-firma-original.docx", Buffer.from(vorlage, "base64"));
  writeFileSync("screenshots/dateien/vorlage-firma-ergebnis.docx", Buffer.from(b64, "base64"));
  const z = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = await z.file("word/document.xml")!.async("string");
  const num = await z.file("word/numbering.xml")!.async("string");
  const absaetze = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  const mit = (t: string) => absaetze.find((p) => p.replace(/<[^>]+>/g, "").includes(t)) ?? "";

  // Beispieltexte der Vorlage sind weg
  expect(xml).not.toContain("Dieser Absatz zeigt");
  expect(xml).not.toContain("Muster GmbH");
  // Titel im Format der großen Titelzeile der Vorlage (44 halbe Punkt, fett, dunkelblau)
  expect(mit("Projektübergabe Brennecke")).toContain('w:val="44"');
  expect(mit("Projektdaten")).toContain('w:val="KSCAKapitel"');
  // Vorlage nummeriert Kapitel nicht selbst: Text bleibt
  expect(mit("Beteiligte")).toContain('w:val="KSCAUnterkapitel"');
  // Fließtext: Schrift, Farbe, Größe und Zeilenabstand der Vorlage
  const text = mit("Die Anlage geht");
  expect(text).toContain('w:ascii="Arial"');
  expect(text).toContain('w:val="1F2A44"');
  expect(text).toContain('w:line="300"');
  // Aufzählung mit dem Aufzählungszeichen der Vorlage, Nummerierung je Liste neu bei 1
  expect(mit("Projektleitung: Anna")).toContain("<w:numPr>");
  const nummern = ["Abnahme Fördertechnik", "Schulung planen", "Zweite Liste"].map((t) => mit(t).match(/<w:numId w:val="(\d+)"/)?.[1]);
  expect(nummern[0]).toBe(nummern[1]);
  expect(nummern[2]).not.toBe(nummern[0]);
  expect(num).toContain(`<w:num w:numId="${nummern[2]}"`);
  expect(num).toContain("<w:startOverride w:val=\"1\"/>");
  // Tabelle: Kopfzeile dunkelblau mit weißer fetter Schrift, Datenzeilen abwechselnd weiß/hellblau
  const tabelle = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0];
  const zeilen = [...tabelle.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
  expect(zeilen[0]).toContain('w:fill="003366"');
  expect(zeilen[0]).toContain('w:val="FFFFFF"');
  expect(zeilen[0]).toContain("<w:b/>");
  expect(zeilen[1]).toContain('w:fill="FFFFFF"');
  expect(zeilen[2]).toContain('w:fill="EEF3F8"');
  expect(zeilen[3]).toContain('w:fill="FFFFFF"');
  // Seitenränder und Kopfzeile der Vorlage
  expect(xml).toContain('w:top="1700"');
  const kopf = (await Promise.all(Object.keys(z.files).filter((p) => /header\d*\.xml$/.test(p)).map((p) => z.file(p)!.async("string")))).join("");
  expect(kopf).toContain("KÖRBER · KSCA");
  // Gültiges XML
  expect(await page.evaluate((x) => !new DOMParser().parseFromString(x, "application/xml").getElementsByTagName("parsererror").length, xml)).toBe(true);
});
