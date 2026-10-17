/**
 * Copilot-Attrappe für den Testmodus: antwortet wie die Graph-Schnittstelle, nur mit erfundenem Text und einstellbarer
 * Verzögerung. Damit lassen sich Läufe und Aufträge ohne Microsoft-Konto durchspielen (auch in den Tests).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DateiSpeicher } from "./speicher";
import { UMGEBUNG } from "./umgebung";

let n = 0;
const warten = (ms: number) => new Promise((r) => setTimeout(r, ms));

function antwortZu(frage: string): string {
  const kern = frage.replace(/\s+/g, " ").trim().slice(0, 90);
  if (/"vorschlaege": \[\{"art"/.test(frage)) return JSON.stringify({ zusammenfassung: "Attrappe: Mehrere Rückfragen zum Begriff SBOM, eine Frage ohne Fundstelle.", vorschlaege: [
    { art: "glossar", text: "SBOM (Software Bill of Materials): Stückliste aller Softwarebestandteile eines Produkts.", begruendung: "Mehrere Rückmeldungen fragten, was SBOM bedeutet.", belege: 2 },
    { art: "faq", text: "Unterlage ergänzen: Übersicht der Meldefristen nach Art. 14 CRA.", begruendung: "Eine Frage dazu blieb ohne Fundstelle.", belege: 1 },
  ] });
  if (/Antworte nur mit gültigem JSON in dieser Form: \{"hinweis"/.test(frage)) return JSON.stringify({ hinweis: "Paket der Attrappe", dateien: [{ pfad: "Attrappe/Ergebnis.md", inhalt: `# Ergebnis\n\nAttrappe zu: ${kern}` }] });
  if (/Antworte nur mit gültigem JSON/.test(frage)) return JSON.stringify({ attrappe: true, hinweis: `Attrappe zu: ${kern}` });
  return `## Ergebnis der Attrappe\n\nDiese Antwort stammt aus dem Testmodus des Hub-Dienstes, nicht von Copilot.\n\nAufgabe: ${kern} …`;
}

export async function attrappe(req: IncomingMessage, res: ServerResponse, pfad: string, body: unknown, speicher: DateiSpeicher): Promise<void> {
  const json = (status: number, wert: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(wert)); };
  if (req.method === "POST" && pfad === "/beta/copilot/conversations") return json(201, { id: `att-${++n}` });
  const chat = /^\/beta\/copilot\/conversations\/([^/]+)\/(chat|chatOverStream)$/.exec(pfad);
  if (req.method === "POST" && chat) {
    const frage = String((body as { message?: { text?: string } })?.message?.text ?? "");
    const antwort = antwortZu(frage);
    if (chat[2] === "chat") { await warten(UMGEBUNG.attrappeMs); return json(200, { id: chat[1], messages: [{ text: frage }, { text: antwort }] }); }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const stufen = 3;
    for (let i = 1; i <= stufen; i++) {
      await warten(UMGEBUNG.attrappeMs / stufen);
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id: chat[1], messages: [{ text: frage }, { text: antwort.slice(0, Math.ceil((antwort.length * i) / stufen)) }] })}\n\n`);
    }
    res.end();
    return;
  }
  if (req.method === "POST" && pfad === "/v1.0/me/sendMail") {
    const bisher = (await speicher.lesen<unknown[]>("attrappe-post.json")) ?? [];
    await speicher.schreiben("attrappe-post.json", [...bisher, { zeit: new Date().toISOString(), nachricht: body }]);
    res.writeHead(202); res.end();
    return;
  }
  if (req.method === "GET" && pfad === "/post") return json(200, (await speicher.lesen<unknown[]>("attrappe-post.json")) ?? []);
  if (req.method === "GET" && pfad === "/v1.0/me") return json(200, { displayName: "Testperson", mail: "test@test.local" });
  json(404, { error: { message: `Die Attrappe kennt ${req.method} ${pfad} nicht.` } });
}
