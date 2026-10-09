import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BEISPIEL = `# Zusammenfassung Projektbesprechung

## Teilnehmende
- Anna Berger (Leitung)
- Tom Kraus
  - Vertretung für Einkauf

## Ergebnisse
Das Team hat sich auf **drei Prioritäten** für das *dritte Quartal* geeinigt.

1. Lieferanten bewerten
2. Prüfprotokolle vereinheitlichen
3. Schulung planen

## Aufgaben
| Aufgabe | Verantwortlich | Termin | Aufwand (h) |
|---|---|---|---|
| Lieferantenliste prüfen | Tom Kraus | 15.10.2026 | 12,5 |
| Vorlage Prüfprotokoll | Anna Berger | 22.10.2026 | 8 |

---

Nächster Termin: 29.10.2026`;

test("Ergebnis als PDF, Word, Excel und PowerPoint erzeugen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const ergebnis = await page.evaluate(async (md) => {
    const dok = await import("/src/lib/dokument.ts");
    const out: Record<string, string> = {};
    for (const art of dok.DATEI_ARTEN) {
      const blob: Blob = await dok.dateiErzeugen(art, md, { titel: "Besprechung", app: "Transkript-Zusammenfassung" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out[art] = btoa(bin);
    }
    // HTML statt Markdown (so hatte die KI früher geantwortet) wird ebenfalls verstanden
    out.htmlBloecke = String(dok.dokumentAus("<!DOCTYPE html><html><body><h1>Titel</h1><p>Text <b>fett</b></p><ul><li>A</li></ul></body></html>").length);
    out.wunsch = String(dok.dateiWunsch("Bitte als PowerPoint ausgeben"));
    return out;
  }, BEISPIEL);
  mkdirSync("screenshots/dateien", { recursive: true });
  for (const art of ["pdf", "docx", "xlsx", "pptx"]) {
    const buf = Buffer.from(ergebnis[art], "base64");
    writeFileSync(`screenshots/dateien/beispiel.${art}`, buf);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, art === "pdf" ? 4 : 2).toString("latin1")).toBe(art === "pdf" ? "%PDF" : "PK");
  }
  expect(ergebnis.htmlBloecke).toBe("3");
  expect(ergebnis.wunsch).toBe("pptx");
});
