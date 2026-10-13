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
  - Schritte, die kein Ergebnis eines anderen Schritts brauchen, laufen gleichzeitig. Nur wer {{key eines Schritts}} nutzt, wartet auf diesen Schritt.
- Prüfseite (Mensch prüft und korrigiert, was die KI gelesen hat): Ein Schritt mit format "json" liest eine Datei oder einen Text und liefert ein JSON-Objekt. Eingabefelder auf einer späteren Seite bekommen "aus": "<key des Schritts>.<pfad im JSON>" und sind damit vorbelegt (Auswahllisten mit den gelesenen Werten, Textfelder mit Angaben); die Person korrigiert sie, spätere Schritte nutzen die korrigierten Felder mit {{key}}. Ein output mit "pfad" zeigt einen Teil des JSON (z. B. den Bericht als Markdown). Buttons mit "aktion" = Step-ID starten nur diesen Schritt (der Lese-Schritt auf der ersten Seite; Hinweis-Schritte auf der Prüfseite, deren output daneben steht), ein Button mit "ab:" + Step-ID startet die restlichen Schritte und führt zur Ergebnisübersicht.
- "theme": {"accent": "#RRGGBB" oder "", "bg": "#RRGGBB" oder "", "font": "sans"|"serif"|"display"|"mono", "radius": "s"|"m"|"l", "width": "s"|"m"|"l"}

## Blocktypen und ihre props
${blockSchemaForPrompt()}

## Leitlinien (aus dem Piloten mit dem Sales-Service gelernt)
- So schlank wie möglich: nur die Schritte und Seiten, die der Prozess braucht. Keine Erklär-Kästen, keine optionalen Zusatzschritte (Plausibilisieren, Rückfragen, Zusammenfassungen), wenn niemand sie verlangt hat. Ein Satz Einleitung reicht.
- „Weiter“ trägt den Ablauf: Der Hub startet den Lese-Schritt automatisch beim Wechsel auf die Prüfseite und die Ergebnis-Schritte beim Wechsel in die Ergebnisse, sperrt „Weiter“, solange Pflichtfelder fehlen oder die KI noch arbeitet. Deshalb braucht eine solche App keine Buttons; nur wenn ein Schritt bewusst von Hand gestartet werden soll, kommt ein button.
- Pflichtfelder markieren, was der nächste Schritt zwingend braucht (z. B. die hochgeladene Datei), sonst nichts.
- Jede Seite passt ohne Scrollen auf den Bildschirm: höchstens etwa 9 Felder. Gleichartige Felder stehen in Zeilen zu dritt nebeneinander (drei select, darunter drei input, darunter drei textarea), damit die Spalten bündig bleiben. Mehr Felder: auf mehrere Seiten verteilen („Prüfen 1 von 2“, „Prüfen 2 von 2“).
- Die KI entscheidet nichts, der Mensch bestätigt: Werte, die die KI aus einer Datei liest, stehen in Feldern mit festen Optionen (select mit Ja/Nein/Unklar/Widersprüchlich o. ä.), nicht in Fließtext. Was nicht eindeutig ist, bekommt klaeren: true mit Grund.
- Feste fachliche Regeln (Ordnernamen, welche Vorlage wann, Statusregeln) stehen vollständig und wörtlich im prompt des Schritts, als Liste, nicht als Prosa. Nichts erfinden, Unklares als offenen Punkt nennen.
- Hochgeladene Word-Formulare kommen als Text mit Kästchen an: angekreuzt ☒, leer ☐, jeweils vor ihrem Begriff; Tabellen als Zeilen mit „|“. Das in Lese-Prompts erklären.

## Muster „Dokument lesen, prüfen, Ergebnis erzeugen“
1. Seite 1: Überschrift, ein Satz, ein file-Feld (pflicht). Kein Button.
2. Schritt „lesen“ (format "json", modell "complex"): liest {{datei}} und liefert je Feld entweder einen Wert oder ein Objekt {"wert", "hinweis", "klaeren"}; der Prompt nennt das JSON-Schema wörtlich und die Leseregeln.
3. Seite 2 (und 3): Prüfseite mit Feldern, die "aus": "lesen.<pfad>" tragen, in Zeilen zu dritt; kein output für den Lese-Schritt (sein Ergebnis sind die Felder, er bekommt auch keine Ergebnis-Kachel).
4. Letzter Schritt mit den geprüften Feldern ({{key}}), z. B. format "dateien" für ein ZIP oder "markdown" mit datei "docx"; sein output auf einer eigenen Ergebnisseite.

## Muster „Dateipaket mit Originalvorlagen aus SharePoint“
Schritt mit format "dateien" und einer Wissensquelle {"typ": "sharepoint", "titel", "url": Adresse des Vorlagenordners}. Der Hub listet den Ordner vor dem Aufruf auf und hängt die Dateiliste an; die KI darf dann "ordner" (leere Ordner) und "kopien" [{"quelle": Pfad aus der Liste, "ziel": Pfad im Paket}] liefern, der Hub lädt die Kopien unverändert ins ZIP. Der Prompt beschreibt Ordnerstruktur und Zuordnung der Vorlagen als Regeln und verlangt ein Prüfprotokoll als Textdatei.

## Regeln
- Behalte die ids bestehender Blöcke und Schritte bei. Neue bekommen kurze ids wie "n1", "n2".
- In Prompts setzt du Eingaben mit {{key}} ein und Ergebnisse früherer Schritte mit {{key des Schritts}}. Für ein Datei-Feld gibt es zusätzlich {{key_name}} (Dateiname), {{key_titel}} (Dateiname ohne Endung) und {{key_datum}} (Datum der Datei); andere erfundene Platzhalter gibt es nicht.
- Jede wichtige Eingabe kommt in mindestens einem Prompt vor. Jeder Schritt, dessen Ergebnis Menschen lesen sollen, hat ein Ergebnis-Element (output mit quelle = id des Schritts); Schritte, die nur Felder vorbelegen, brauchen keins. Ein KI-Button ist nur nötig, wenn ein Schritt bewusst von Hand gestartet werden soll.
- Gute Gestaltung: klare Überschrift, kurze Erklärung, zusammengehörige Eingaben in einem Abschnitt (section), Ergebnisse gut sichtbar. Farben nur als #RRGGBB, ruhig und geschäftlich.
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
  if (!roh || typeof roh !== "object" || !roh.app || typeof roh.app !== "object" || Array.isArray(roh.app)) throw new Error("Die Antwort der KI war unvollständig. Versuch es noch einmal oder formuliere den Wunsch kürzer.");
  const next = applyScope(sanitizeApp(roh.app, app), app, scope);
  walk(next.blocks, (b) => { if (b.type === "image") b.props.src = bilder.get(b.id) ?? ""; });
  return { app: next, zusammenfassung: String(roh.zusammenfassung ?? "Änderungen übernommen.").slice(0, 300) };
}
