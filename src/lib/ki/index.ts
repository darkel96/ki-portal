/**
 * Einzige Stelle, an der der Hub die KI anspricht. Gilt für alle Applikationen.
 * Ist die zentrale Azure-Anwendung nicht konfiguriert, läuft der Hub im Simulationsmodus:
 * Statt einer Antwort wird die Anfrage angezeigt, die gesendet würde.
 */
import { combinedMessage, type KiRequest } from "../request";
import { copilotKonfiguriert } from "./config";
import { copilotFragen } from "./copilot";
import { claudeFragen, imClaudeViewer } from "./claudeTest";

export type KiModus = "copilot" | "claude-test" | "simulation";
/** Copilot hat Vorrang; als Artifact auf claude.ai antwortet ersatzweise Claude; sonst Simulation. */
export const kiModus = (): KiModus => (copilotKonfiguriert() ? "copilot" : imClaudeViewer() ? "claude-test" : "simulation");

export class KiSimulation extends Error {
  constructor(public req: KiRequest | { nachricht: string }) { super("simulation"); }
}

/** Sendet eine neutrale Anfrage. Wirft KiSimulation, wenn keine KI angebunden ist. */
export async function kiSenden(req: KiRequest, signal?: AbortSignal): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation(req);
  if (modus === "claude-test") return claudeFragen(combinedMessage(req), { signal, modell: req.modell });
  const dateien = req.wissensquellen.filter((q) => q.typ === "datei" && q.url).map((q) => q.url);
  return copilotFragen(combinedMessage(req), { web: req.websuche, dateien, signal });
}

/** Freie Anfrage (KI-Assistent, Moderation im Agenten-Team). */
export async function kiFragen(text: string, signal?: AbortSignal): Promise<string> {
  const modus = kiModus();
  if (modus === "simulation") throw new KiSimulation({ nachricht: text });
  if (modus === "claude-test") return claudeFragen(text, { signal });
  return copilotFragen(text, { signal });
}

/** Liest ein JSON-Objekt aus einer KI-Antwort (auch wenn Text davor oder danach steht). */
export function jsonAus(text: string): unknown {
  const t = String(text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const src = fence ? fence[1] : t;
  const a = src.indexOf("{"), b = src.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Die Antwort enthält kein JSON.");
  return JSON.parse(src.slice(a, b + 1));
}
