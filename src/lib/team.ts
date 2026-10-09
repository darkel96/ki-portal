/**
 * Agenten-Team: Mehrere Agenten lösen eine Aufgabe gemeinsam.
 * Eine Moderation entscheidet in jeder Runde, wer als Nächstes spricht und wann das Ziel erreicht ist.
 * Jeder Aufruf ist eine normale Anfrage an die zentrale KI-Anbindung; der Verlauf wird jedes Mal mitgegeben.
 */
import type { App, Step } from "./schema";
import { fill } from "./model";
import { FORMAT_HINT, buildRequest, type FileInfo, type KiRequest } from "./request";
import { jsonAus, kiSenden } from "./ki";

export type Beitrag = { agent: string; auftrag: string; text: string; runde: number };
export type TeamUpdate =
  | { art: "moderation"; runde: number; naechster: string; auftrag: string; begruendung: string }
  | { art: "beitrag"; beitrag: Beitrag }
  | { art: "fertig"; ergebnis: string; begruendung: string; runden: number };

const MAX_VERLAUF = 14_000;

function verlaufText(verlauf: Beitrag[]): string {
  if (!verlauf.length) return "(noch keine Beiträge)";
  let text = verlauf.map((b) => `[Runde ${b.runde}] ${b.agent}:\n${b.text}`).join("\n\n");
  if (text.length > MAX_VERLAUF) text = "… (ältere Beiträge gekürzt)\n\n" + text.slice(text.length - MAX_VERLAUF);
  return text;
}

function anfrage(base: KiRequest, system: string, nachricht: string, schritt: string): KiRequest {
  return { ...base, schritt, system, nachricht };
}

export async function teamAusfuehren(opts: {
  app: App; step: Step; ctx: Record<string, string>; files?: Record<string, FileInfo>;
  signal?: AbortSignal; onUpdate: (u: TeamUpdate) => void; onRequest?: (req: KiRequest) => void;
}): Promise<string> {
  const { app, step, ctx, files, signal, onUpdate, onRequest } = opts;
  const team = step.team;
  if (!team || team.agenten.length < 2) throw new Error("Das Agenten-Team braucht mindestens zwei Agenten.");
  const base = buildRequest(app, step, ctx, files);
  const aufgabe = base.nachricht;
  const ziel = fill(team.ziel, ctx);
  const wissen = fill(step.wissen, ctx);
  const agentenListe = team.agenten.map((a) => `- ${a.name}: ${a.rolle || "ohne feste Rolle"}`).join("\n");
  const namen = team.agenten.map((a) => a.name);
  const verlauf: Beitrag[] = [];

  const moderationSystem = [
    `Du moderierst ein Team von KI-Agenten in der Applikation „${app.name}“ eines internen KI-Hubs. Antworte auf Deutsch.`,
    "Du arbeitest selbst nicht inhaltlich mit. Du entscheidest, wer als Nächstes spricht, gibst einen klaren Auftrag und erkennst, wann das Ziel erreicht ist.",
    "Regeln: Lass jeden Agenten passend zu seiner Rolle beitragen. Vermeide Wiederholungen. Beende, sobald das Ziel erreicht ist, spätestens wenn keine neuen Erkenntnisse mehr kommen.",
    team.moderation,
    wissen ? `Hintergrundwissen:\n${wissen}` : "",
  ].filter(Boolean).join("\n\n");

  for (let runde = 1; runde <= team.maxRunden + 1; runde++) {
    if (signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
    const letzte = runde > team.maxRunden;
    const nachricht = [
      `Aufgabe und Ausgangslage:\n${aufgabe}`,
      `Ziel:\n${ziel}`,
      `Agenten:\n${agentenListe}`,
      `Bisheriger Verlauf:\n${verlaufText(verlauf)}`,
      letzte
        ? `Die maximale Rundenzahl ist erreicht. Fasse jetzt das bestmögliche Endergebnis zusammen.\nAntworte nur mit JSON: {"status": "fertig", "begruendung": "ein Satz", "ergebnis": "vollständiges Endergebnis"}`
        : `Runde ${runde} von höchstens ${team.maxRunden}. Antworte nur mit JSON, entweder\n{"status": "weiter", "naechster": "${namen[0]}", "auftrag": "konkrete Anweisung an diesen Agenten", "begruendung": "ein Satz"}\noder, wenn das Ziel erreicht ist,\n{"status": "fertig", "begruendung": "ein Satz", "ergebnis": "vollständiges Endergebnis"}\n"naechster" muss einer dieser Namen sein: ${namen.join(", ")}.`,
      `Format des Endergebnisses: ${FORMAT_HINT[step.format]}`,
    ].join("\n\n");
    const modReq = anfrage(base, moderationSystem, nachricht, `${step.name}: Moderation`);
    onRequest?.(modReq);
    const roh = await kiSenden(modReq, signal);
    let entscheidung: { status?: string; naechster?: string; auftrag?: string; begruendung?: string; ergebnis?: unknown };
    try {
      entscheidung = jsonAus(roh) as typeof entscheidung;
    } catch {
      entscheidung = { status: letzte ? "fertig" : "weiter", naechster: namen[(runde - 1) % namen.length], auftrag: roh.slice(0, 600), ergebnis: roh };
    }
    if (entscheidung.status === "fertig" || letzte) {
      const ergebnis = typeof entscheidung.ergebnis === "string" ? entscheidung.ergebnis : JSON.stringify(entscheidung.ergebnis ?? "", null, 2);
      onUpdate({ art: "fertig", ergebnis, begruendung: String(entscheidung.begruendung ?? ""), runden: runde - 1 });
      return ergebnis;
    }
    const agent = team.agenten.find((a) => a.name === entscheidung.naechster) ?? team.agenten[(runde - 1) % team.agenten.length];
    const auftrag = String(entscheidung.auftrag ?? "Bring die Aufgabe einen Schritt weiter.");
    onUpdate({ art: "moderation", runde, naechster: agent.name, auftrag, begruendung: String(entscheidung.begruendung ?? "") });

    const agentSystem = [
      `Du bist „${agent.name}“ in einem Team von KI-Agenten in der Applikation „${app.name}“. Antworte auf Deutsch.`,
      `Deine Rolle: ${agent.rolle || "Unterstütze das Team."}`,
      `Die anderen im Team:\n${team.agenten.filter((a) => a !== agent).map((a) => `- ${a.name}: ${a.rolle}`).join("\n")}`,
      "Arbeite den Auftrag der Moderation konkret ab. Beziehe dich auf frühere Beiträge, wenn es hilft, und sprich andere Agenten direkt an, wenn du etwas von ihnen brauchst. Höchstens 250 Wörter.",
      wissen ? `Hintergrundwissen:\n${wissen}` : "",
    ].filter(Boolean).join("\n\n");
    const agentReq = anfrage(base, agentSystem, [`Aufgabe:\n${aufgabe}`, `Ziel des Teams:\n${ziel}`, `Bisheriger Verlauf:\n${verlaufText(verlauf)}`, `Dein Auftrag jetzt:\n${auftrag}`].join("\n\n"), `${step.name}: ${agent.name}`);
    onRequest?.(agentReq);
    const text = await kiSenden(agentReq, signal);
    const beitrag = { agent: agent.name, auftrag, text, runde };
    verlauf.push(beitrag);
    onUpdate({ art: "beitrag", beitrag });
  }
  return "";
}
