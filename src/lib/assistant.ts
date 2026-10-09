/** KI-Assistent im Baukasten: baut die aktuelle App nach einem Wunsch um. */
import type { App } from "./schema";
import { blockSchemaForPrompt } from "./schema";
import { clone, walk } from "./model";
import { applyScope, sanitizeApp, type AssistScope } from "./sanitize";
import { jsonAus, kiFragen } from "./ki";

export function assistPrompt(app: App, wunsch: string, scope: AssistScope): string {
  const ctxApp = clone({ name: app.name, bereich: app.bereich, beschreibung: app.beschreibung, theme: app.theme, blocks: app.blocks, steps: app.steps });
  walk(ctxApp.blocks, (b) => {
    if (b.type === "image") b.props.src = b.props.src ? "[bild]" as never : "";
    if ("keyAuto" in b.props) delete (b.props as { keyAuto?: boolean }).keyAuto;
  });
  const regel = scope === "ui" ? "Ändere nur Oberfläche und Design (blocks, theme). Gib steps exakt unverändert zurück."
    : scope === "design" ? "Ändere nur das Aussehen: theme sowie die props align, color, size, level, bg, pad, border, stil, tone. Struktur, Texte und steps bleiben unverändert."
    : "Du darfst Oberfläche, Design und KI-Ablauf ändern. Ist die Applikation noch ein leerer Entwurf, baue sie nach dem Wunsch komplett neu auf.";
  return `Du bist der KI-Assistent eines No-Code-Baukastens für KI-Applikationen in einem internen Firmenportal. Du änderst die Definition einer Applikation nach dem Wunsch der Person.

## Aufbau einer Applikation
- "blocks": Baum der Oberfläche. Die oberste Ebene besteht NUR aus Seiten ({"type": "seite", "props": {"titel"}, "children": [...]}). Die App blättert zwischen den Seiten, niemand soll scrollen müssen: Jede Seite muss auf einen Bildschirm passen (höchstens etwa 5 Eingabefelder oder ein Ergebnis je Seite). Üblich: eine oder mehrere Eingabeseiten mit Überschrift, kurzer Erklärung und Eingaben (der KI-Button auf der letzten Eingabeseite startet alle Schritte), danach je KI-Schritt eine eigene Seite nur mit seinem Ergebnis. Seiten ohne Eingaben und Buttons erscheinen in der App automatisch als Kacheln einer Ergebnisübersicht; der ganze Ablauf läuft in einem Durchgang. Deshalb gehören alle Eingaben, auch die für spätere Schritte, auf Eingabeseiten vor den Ergebnissen.
- Jeder Block: {"id", "type", "props"}.
- "steps": KI-Ablauf, läuft nacheinander. Jeder Schritt: {"id", "name", "key", "art", "rolle", "wissen", "prompt", "modell", "format", "datei", "autoAll", "web", "quellen", "bedingung", "team"}.
  - art "prompt": ein Prompt. art "team": mehrere Agenten lösen die Aufgabe gemeinsam; dann "team": {"ziel", "maxRunden" (2–20), "moderation", "agenten": [{"id", "name", "rolle"}]} mit 2 bis 6 Agenten, "prompt" ist die Startsituation.
  - format: "markdown" | "text" | "json" | "dateien" ("dateien" erzeugt ein Dateipaket, das als ZIP heruntergeladen werden kann).
  - datei: "" | "pdf" | "docx" | "xlsx" | "pptx" | "wunsch". Soll am Ende ein fertiges Dokument stehen (PDF, Word, Excel, PowerPoint), setze datei entsprechend; der Hub erzeugt die Datei selbst aus dem Markdown-Ergebnis. Lass die KI niemals HTML zum Ausdrucken erzeugen. "wunsch" nimmt die Datei-Art, die in Aufgabe oder Eingaben genannt wird (z. B. über eine Auswahlliste „Ausgabe als“ mit PDF, Word, Excel, PowerPoint).
  - bedingung: null oder {"feld": key einer Eingabe, "op": "gleich"|"ungleich"|"gefuellt"|"leer", "wert"}.
- "theme": {"accent": "#RRGGBB" oder "", "bg": "#RRGGBB" oder "", "font": "sans"|"serif"|"display"|"mono", "radius": "s"|"m"|"l", "width": "s"|"m"|"l"}

## Blocktypen und ihre props
${blockSchemaForPrompt()}

## Regeln
- Behalte die ids bestehender Blöcke und Schritte bei. Neue bekommen kurze ids wie "n1", "n2".
- In Prompts setzt du Eingaben mit {{key}} ein und Ergebnisse früherer Schritte mit {{key des Schritts}}. Für ein Datei-Feld gibt es zusätzlich {{key_name}} (Dateiname), {{key_titel}} (Dateiname ohne Endung) und {{key_datum}} (Datum der Datei); andere erfundene Platzhalter gibt es nicht.
- Jede wichtige Eingabe kommt in mindestens einem Prompt vor. Es gibt mindestens einen KI-Button, jeder Schritt hat ein Ergebnis-Element (output mit quelle = id des Schritts).
- Gute Gestaltung: klare Überschrift, kurze Erklärung, zusammengehörige Eingaben in einem Bereich, Ergebnisse gut sichtbar. Farben nur als #RRGGBB, ruhig und geschäftlich.
- Texte auf Deutsch, sachlich, für Mitarbeitende einer Firma.
- ${regel}
- Ändere nur, was der Wunsch verlangt oder was dafür nötig ist.

## Aktuelle Applikation
${JSON.stringify(ctxApp)}

## Wunsch der Person
"""${wunsch}"""

Antworte nur mit einem JSON-Objekt dieser Form:
{"zusammenfassung": "ein bis zwei Sätze, was du geändert hast", "app": {"name", "bereich", "beschreibung", "theme", "blocks", "steps"}}`;
}

export async function assistentAnwenden(app: App, wunsch: string, scope: AssistScope, signal?: AbortSignal): Promise<{ app: App; zusammenfassung: string }> {
  const bilder = new Map<string, string>();
  walk(app.blocks, (b) => { if (b.type === "image") bilder.set(b.id, b.props.src); });
  const roh = jsonAus(await kiFragen(assistPrompt(app, wunsch, scope), signal)) as { zusammenfassung?: unknown; app?: unknown };
  if (!roh || typeof roh !== "object" || !roh.app) throw new Error("Die Antwort der KI war unvollständig. Versuch es noch einmal oder formuliere den Wunsch kürzer.");
  const next = applyScope(sanitizeApp(roh.app, app), app, scope);
  walk(next.blocks, (b) => { if (b.type === "image") b.props.src = bilder.get(b.id) ?? ""; });
  return { app: next, zusammenfassung: String(roh.zusammenfassung ?? "Änderungen übernommen.").slice(0, 300) };
}
