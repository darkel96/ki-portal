/**
 * Einzige Stelle, an der der Hub die KI anspricht. Gilt für alle Applikationen.
 * Ist die zentrale Azure-Anwendung nicht konfiguriert, läuft der Hub im Simulationsmodus:
 * Statt einer Antwort wird die Anfrage angezeigt, die gesendet würde.
 */
import { combinedMessage, type KiRequest } from "../request";
import { copilotKonfiguriert } from "./config";
import { copilotFragen } from "./copilot";
export { GespraechVerfallen } from "./copilot";
import { claudeFragen, imClaudeViewer } from "./claudeTest";
import { apiSchluessel, claudeApiFragen } from "./claudeApi";

export type KiModus = "copilot" | "claude-test" | "claude-api" | "simulation";
/** Copilot hat Vorrang; als Artifact auf claude.ai antwortet ersatzweise Claude; mit eigenem API-Schlüssel (Testseite) ebenfalls Claude; sonst Simulation. */
export const kiModus = (): KiModus =>
  copilotKonfiguriert() ? "copilot" : imClaudeViewer() ? "claude-test" : apiSchluessel() ? "claude-api" : "simulation";

export class KiSimulation extends Error {
  constructor(public req: KiRequest | { nachricht: string }) { super("simulation"); }
}

/**
 * Sendet eine neutrale Anfrage. Wirft KiSimulation, wenn keine KI angebunden ist.
 * onTeil bekommt den bisher geschriebenen Text, solange die Antwort entsteht (Copilot und eigener Schlüssel).
 */
export type Gespraech = { gespraech?: string; onGespraech?: (id: string) => void };
export async function kiSenden(req: KiRequest, signal?: AbortSignal, onTeil?: (text: string) => void, gespraech: Gespraech = {}): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation(req);
  if (modus === "claude-test") return claudeFragen(combinedMessage(req), { signal, modell: req.modell });
  if (modus === "claude-api") return claudeApiFragen(combinedMessage(req), { signal, modell: req.modell, onTeil, bilder: req.bilder });
  const dateien = req.wissensquellen.filter((q) => q.typ === "datei" && q.url).map((q) => q.url);
  if (req.bilder?.length) {
    // Copilot sieht Bilder nur als Datei: erst nach OneDrive, dann als Adresse mitgeben
    const { bildNachOneDrive } = await import("./onedrive");
    for (const b of req.bilder) dateien.push(await bildNachOneDrive(b.name, b.daten, signal));
  }
  return copilotFragen(combinedMessage(req), { web: req.websuche, dateien, signal, onTeil, ...gespraech });
}

/** Freie Anfrage (KI-Assistent, Moderation im Agenten-Team). json: Antwort soll JSON sein, Copilot liefert sie unverändert. */
export async function kiFragen(text: string, signal?: AbortSignal, onTeil?: (text: string) => void, opts: { json?: boolean } = {}): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation({ nachricht: text });
  if (modus === "claude-test") return claudeFragen(text, { signal });
  if (modus === "claude-api") return claudeApiFragen(text, { signal, onTeil });
  return copilotFragen(text, { signal, onTeil, json: opts.json });
}

/**
 * Liest das erste vollständige JSON-Objekt aus einer KI-Antwort, auch wenn Text davor oder danach steht
 * oder die KI das Objekt doppelt liefert (Klammern werden gezählt, Zeichenketten übersprungen).
 * Ein Codeblock zählt nur, wenn er vor dem JSON beginnt, es also umschließt: Steht er erst darin (eine Antwort mit
 * Ablaufdiagramm ```mermaid in einer Zeichenkette, z. B. in der Lernschicht), wäre sonst das Diagramm als JSON gelesen worden.
 */
export function jsonAus(text: string): unknown {
  try { return objektAus(String(text)); }
  catch (e) {
    // Typische Fehler der KI reparieren und noch einmal lesen; klappt das nicht, gilt die ursprüngliche Meldung
    try { return objektAus(jsonReparieren(String(text))); }
    catch { throw e instanceof SyntaxError ? new Error(`Die KI hat fehlerhaftes JSON geliefert (${e.message}). Starte erneut.`) : e; }
  }
}

function objektAus(t: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const umschliesst = !!fence && (t.indexOf("{") < 0 || fence.index < t.indexOf("{"));
  const src = fence && umschliesst ? fence[1] : t;
  const a = src.indexOf("{");
  if (a < 0) throw new Error("Die Antwort enthält kein JSON.");
  let tiefe = 0, inText = false, esc = false;
  for (let i = a; i < src.length; i++) {
    const c = src[i];
    if (inText) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inText = false; continue; }
    if (c === '"') inText = true;
    else if (c === "{") tiefe++;
    else if (c === "}" && --tiefe === 0) return JSON.parse(src.slice(a, i + 1));
  }
  throw new Error("Die Antwort enthält kein vollständiges JSON. Starte erneut.");
}

/**
 * Häufige Fehler in JSON von der KI beheben: deutsche Anführungszeichen mit geradem Schlusszeichen („Wort"),
 * unmaskierte Anführungszeichen mitten in Texten, Zeilenumbrüche und Tabs in Zeichenketten, Komma vor } oder ].
 * Ein " in einer Zeichenkette gilt nur als Ende, wenn danach , } ] oder : folgt.
 */
export function jsonReparieren(roh: string): string {
  const s = roh.replace(/„([^"„“\n]{0,300})"/g, "„$1“");
  let out = "", inText = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (!inText) { if (c === '"') inText = true; out += c; continue; }
    if (esc) { esc = false; out += c; continue; }
    if (c === "\\") { esc = true; out += c; continue; }
    if (c === "\n") { out += "\\n"; continue; }
    if (c === "\r") continue;
    if (c === "\t") { out += "\\t"; continue; }
    if (c === '"') {
      const danach = /^\s*(\S)/.exec(s.slice(i + 1, i + 40))?.[1];
      if (danach === undefined || /[,}\]:]/.test(danach)) { inText = false; out += c; }
      else out += '\\"';
      continue;
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
