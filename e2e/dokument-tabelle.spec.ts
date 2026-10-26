import { test, expect } from "@playwright/test";
import JSZip from "jszip";

/** Breite Tabellen in PDF und Word: nichts ragt über den Rand, Spalten nach Inhalt, normale Wörter bleiben ganz */
const MD = `# Thema analysieren

## Offene Punkte und Maßnahmen

| Priorität | Was ist offen / konkrete Maßnahme | Zuständige Person oder Organisation | Fällig bis | Quelle | Status |
|---|---|---|---|---|---|
| 1 – kritisch | TGW-Fernzugriff auf SCM und Komponenten hinter dem Edge Gateway funktionsfähig herstellen. Vor allem muss TGW das konkrete Fehlerbild einschließlich benötigter Ziele/Ports benennen. | Technische Prüfung laut Anfrage: [Kai Zemke](https://teams.microsoft.com/l/chat/1). Gesamtverantwortung nicht eindeutig belegbar. | nicht dokumentiert, „schnellstmöglich“ gefordert | [E-Mail: AW: KTE: TGW Remotezugriffe auf Kundenanlage KTE E01-100741](https://outlook.office.com/mail/1) | offen |
| 2 – hoch | TGW-ZTNA-/Remotezugang einschließlich Accounts und Zugangsweg abschließend klären. | [Kai Zemke](https://teams.microsoft.com/l/chat/1) wurde um technische Prüfung gebeten | 30.10.2026 | Teams-Chat | in Arbeit |
`;

test("Breite Tabelle: PDF bleibt im Satzspiegel, Word mit Spaltenbreiten nach Inhalt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (md) => {
    const dok = await import("/src/lib/dokument.ts");
    const b64 = async (blob: Blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const meta = { titel: "Thema analysieren", app: "Themen-Briefing" };
    return {
      pdf: await b64(await dok.dateiErzeugen("pdf", md, meta)),
      docx: await b64(await dok.dateiErzeugen("docx", md, meta)),
      normal: dok.tabelleNormal(["a", "b", "c"], [["1"], ["1", "2", "3", "4"]]),
      umbruch: [dok.umbrechbar("Gesamtverantwortung"), dok.umbrechbar("https://x.sharepoint.com/sites/A/Lists/Pipeline/DispForm.aspx").includes("​")],
    };
  }, MD);
  expect(r.normal).toEqual([["1", "", ""], ["1", "2", "3 | 4"]]);
  expect(r.umbruch).toEqual(["Gesamtverantwortung", true]);
  // PDF: rechter Rand des Texts innerhalb der Seite (A4 595 pt, Rand 56 pt); „Gesamtverantwortung“ bleibt ein Stück
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(r.pdf, "base64")) }).promise;
  const seite = await doc.getPage(1);
  const items = (await seite.getTextContent()).items as { str: string; width: number; transform: number[] }[];
  const rechts = Math.max(...items.map((i) => i.transform[4]! + i.width));
  expect(rechts).toBeLessThanOrEqual(595 - 56 + 1);
  expect(items.map((i) => i.str).join("|")).toContain("Gesamtverantwortung");
  expect(items.some((i) => i.str === "30.10.2026")).toBe(true);
  // Word: feste Spaltenbreiten, die schmale Spalte „Priorität“ schmaler als „Was ist offen“
  const z = await JSZip.loadAsync(Buffer.from(r.docx, "base64"));
  const xml = await z.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:type="fixed"');
  const spalten = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
  expect(spalten).toHaveLength(6);
  expect(spalten[0]!).toBeLessThan(spalten[1]!);
});
