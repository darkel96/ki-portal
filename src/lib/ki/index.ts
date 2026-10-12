/**
 * Einzige Stelle, an der der Hub die KI anspricht. Gilt für alle Applikationen.
 * Ist die zentrale Azure-Anwendung nicht konfiguriert, läuft der Hub im Simulationsmodus:
 * Statt einer Antwort wird die Anfrage angezeigt, die gesendet würde.
 */
import { combinedMessage, type KiRequest } from "../request";
import { copilotKonfiguriert } from "./config";
import { copilotFragen } from "./copilot";
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
export async function kiSenden(req: KiRequest, signal?: AbortSignal, onTeil?: (text: string) => void): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation(req);
  if (modus === "claude-test") return claudeFragen(combinedMessage(req), { signal, modell: req.modell });
  if (modus === "claude-api") return claudeApiFragen(combinedMessage(req), { signal, modell: req.modell, onTeil });
  const dateien = req.wissensquellen.filter((q) => q.typ === "datei" && q.url).map((q) => q.url);
  return copilotFragen(combinedMessage(req), { web: req.websuche, dateien, signal, onTeil });
}

/** Freie Anfrage (KI-Assistent, Moderation im Agenten-Team). */
export async function kiFragen(text: string, signal?: AbortSignal, onTeil?: (text: string) => void): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation({ nachricht: text });
  if (modus === "claude-test") return claudeFragen(text, { signal });
  if (modus === "claude-api") return claudeApiFragen(text, { signal, onTeil });
  return copilotFragen(text, { signal, onTeil });
}

/**
 * Liest das erste vollständige JSON-Objekt aus einer KI-Antwort, auch wenn Text davor oder danach steht
 * oder die KI das Objekt doppelt liefert (Klammern werden gezählt, Zeichenketten übersprungen).
 */
export function jsonAus(text: string): unknown {
  const t = String(text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const src = fence ? fence[1] : t;
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
