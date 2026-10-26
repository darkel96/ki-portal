/**
 * Copilot-Attrappe für den Testmodus: antwortet wie die Graph-Schnittstelle, nur mit erfundenem Text und einstellbarer
 * Verzögerung. Damit lassen sich Läufe und Aufträge ohne Microsoft-Konto durchspielen (auch in den Tests).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DateiSpeicher } from "./speicher";
import { UMGEBUNG } from "./umgebung";

let n = 0;
/** Dateien der GitHub-Attrappe: Pfad im Repository → Inhalt, Sha-Zähler, letzte Commit-Nachricht */
const github = new Map<string, { inhalt: string; sha: number; nachricht: string }>();
const warten = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Gesendete Mails und Teams-Nachrichten nacheinander ins Protokoll (gleichzeitige Zustellungen überschreiben sich sonst) */
let protokoll: Promise<void> = Promise.resolve();
function protokollieren(speicher: DateiSpeicher, eintrag: unknown): Promise<void> {
  protokoll = protokoll.then(async () => {
    const bisher = (await speicher.lesen<unknown[]>("attrappe-post.json")) ?? [];
    await speicher.schreiben("attrappe-post.json", [...bisher, eintrag]);
  }).catch((e) => console.error("[Hub-Dienst] Attrappe:", e));
  return protokoll;
}

function antwortZu(frage: string): string {
  const kern = frage.replace(/\s+/g, " ").trim().slice(0, 90);
  if (/"vorschlaege": \[\{"art"/.test(frage)) return JSON.stringify({ zusammenfassung: "Attrappe: Mehrere Rückfragen zum Begriff SBOM, eine Frage ohne Fundstelle.", vorschlaege: [
    { art: "glossar", text: "SBOM (Software Bill of Materials): Stückliste aller Softwarebestandteile eines Produkts.", begruendung: "Mehrere Rückmeldungen fragten, was SBOM bedeutet.", belege: 2 },
    { art: "faq", frage: "Was ist eine SBOM?", antwort: "Eine SBOM ist die Stückliste aller Softwarebestandteile eines Produkts. Quelle: [CRA FAQ, SBOM](https://firma.sharepoint.com/sites/cra/FAQ.md)", begruendung: "Zweimal als hilfreich bewertet.", belege: 2 },
    { art: "quelle", text: "Unterlage ergänzen: Übersicht der Meldefristen nach Art. 14 CRA.", begruendung: "Eine Frage dazu blieb ohne Fundstelle.", belege: 1 },
  ] });
  if (/Antworte nur mit gültigem JSON in dieser Form: \{"hinweis"/.test(frage)) return JSON.stringify({ hinweis: "Paket der Attrappe", dateien: [{ pfad: "Attrappe/Ergebnis.md", inhalt: `# Ergebnis\n\nAttrappe zu: ${kern}` }] });
  if (/Antworte nur mit gültigem JSON/.test(frage)) return JSON.stringify({ attrappe: true, hinweis: `Attrappe zu: ${kern}` });
  // Frage nach einem Diagramm: Antwort mit Mermaid-Block (für die Tests der Zustellung mit Bild)
  if (/Diagramm-Test/.test(frage)) return `## Ablauf der Attrappe\n\n\`\`\`mermaid\nflowchart TD\n  A[Anfrage] --> B{Geprüft?}\n  B -->|Ja| C[Freigabe]\n  B -->|Nein| A\n\`\`\`\n\nAufgabe: ${kern}`;
  return `## Ergebnis der Attrappe\n\nDiese Antwort stammt aus dem Testmodus des Hub-Dienstes, nicht von Copilot.\n\nAufgabe: ${kern} …`;
}

export async function attrappe(req: IncomingMessage, res: ServerResponse, pfad: string, body: unknown, speicher: DateiSpeicher): Promise<void> {
  const json = (status: number, wert: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(wert)); };
  // GitHub-Contents-API im Speicher (für die Tests: Dienst schreibt Hub-Daten mit seinem Token)
  const gh = /^\/github\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(pfad);
  if (gh) {
    const datei = gh[1]!;
    if (req.headers.authorization !== "Bearer test-git") return json(401, { message: "Bad credentials" });
    const d = github.get(datei);
    if (req.method === "GET") {
      if (!d) return json(404, { message: "Not Found" });
      if (/raw/.test(String(req.headers.accept))) { res.writeHead(200, { "Content-Type": "text/plain" }); res.end(d.inhalt); return; }
      return json(200, { content: Buffer.from(d.inhalt, "utf8").toString("base64"), sha: `sha${d.sha}`, encoding: "base64" });
    }
    if (req.method === "PUT") {
      const b = body as { content: string; sha?: string; message: string };
      if (d && b.sha !== `sha${d.sha}`) return json(409, { message: "Conflict" });
      github.set(datei, { inhalt: Buffer.from(b.content, "base64").toString("utf8"), sha: (d?.sha ?? 0) + 1, nachricht: b.message });
      return json(200, { content: { sha: `sha${(d?.sha ?? 0) + 1}` } });
    }
  }
  if (req.method === "POST" && pfad === "/github-setzen") {
    const b = body as { datei: string; inhalt: unknown };
    github.set(b.datei, { inhalt: JSON.stringify(b.inhalt), sha: (github.get(b.datei)?.sha ?? 0) + 1, nachricht: "Testdaten" });
    return json(200, { ok: true });
  }
  if (req.method === "GET" && pfad === "/github-dateien") return json(200, Object.fromEntries([...github].map(([k, v]) => [k, { inhalt: JSON.parse(v.inhalt), nachricht: v.nachricht }])));
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
    await protokollieren(speicher, { zeit: new Date().toISOString(), nachricht: body });
    res.writeHead(202); res.end();
    return;
  }
  if (req.method === "GET" && pfad === "/post") return json(200, (await speicher.lesen<unknown[]>("attrappe-post.json")) ?? []);
  if (req.method === "GET" && pfad === "/v1.0/me") return json(200, { id: "me-test", displayName: "Testperson", mail: "test@test.local", userPrincipalName: "test@test.local" });
  // Eigene E-Mails, Teams-Nachrichten und Termine als Wissensquellen (Zeitraum ab jetzt zurück)
  const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000).toISOString();
  if (req.method === "GET" && /^\/v1\.0\/me\/mailFolders\/[^/]+$/.test(pfad)) return json(200, { id: `ordner-${pfad.split("/").pop()}` });
  if (req.method === "GET" && pfad === "/v1.0/me/messages") return json(200, { value: [
    { id: "a1", subject: "KTE: Freigabe Pflichtenheft", from: { emailAddress: { name: "Anna Berger", address: "anna@test.local" } }, toRecipients: [{ emailAddress: { name: "Testperson" } }], receivedDateTime: vor(2), bodyPreview: "Das Pflichtenheft KTE ist freigegeben.", body: { contentType: "text", content: "Hallo,\n\ndas Pflichtenheft KTE ist freigegeben, Umsetzung startet Montag.\n\nAnna" }, webLink: "https://outlook.test/a1", parentFolderId: "inbox" },
    { id: "a2", subject: "Kantinenplan", from: { emailAddress: { name: "Verwaltung" } }, receivedDateTime: vor(1), bodyPreview: "Der Kantinenplan für nächste Woche.", body: { contentType: "text", content: "Der Kantinenplan für nächste Woche hängt an." }, webLink: "https://outlook.test/a2", parentFolderId: "inbox" },
  ] });
  if (req.method === "GET" && /^\/v1\.0\/me\/chats\/[^/]+\/messages$/.test(pfad)) return json(200, { value: [{ id: "c1", messageType: "message", createdDateTime: vor(1), from: { user: { displayName: "Anna Berger" } }, body: { contentType: "html", content: "<p>KTE: Termin mit dem Kunden steht, Donnerstag 10 Uhr.</p>" } }] });
  if (req.method === "GET" && pfad === "/v1.0/me/joinedTeams") return json(200, { value: [] });
  if (req.method === "GET" && pfad === "/v1.0/me/calendarView") return json(200, { value: [{ subject: "KTE Abstimmung", start: { dateTime: vor(3).replace(/Z$/, "") }, end: { dateTime: vor(3).replace(/Z$/, "") }, organizer: { emailAddress: { name: "Anna Berger" } } }] });
  // Teams: der Chat mit sich selbst (ein Mitglied), neue Chats mit einer Person, Nachrichten
  if (req.method === "GET" && pfad === "/v1.0/me/chats") return json(200, { value: [{ id: "19:me-test_me-test@unq.gbl.spaces", chatType: "oneOnOne", members: [{ email: "test@test.local", userId: "me-test", displayName: "Testperson" }], lastMessagePreview: { createdDateTime: vor(30) } }, { id: "chat-anna", chatType: "oneOnOne", webUrl: "https://teams.test/chat-anna", members: [{ email: "test@test.local", userId: "me-test", displayName: "Testperson" }, { email: "anna@test.local", userId: "anna", displayName: "Anna Berger" }], lastMessagePreview: { createdDateTime: vor(1) } }] });
  if (req.method === "POST" && pfad === "/v1.0/chats") return json(201, { id: `chat-${++n}`, chatType: "oneOnOne" });
  const nachricht = /^\/v1\.0\/chats\/([^/]+)\/messages$/.exec(pfad);
  if (req.method === "POST" && nachricht) {
    await protokollieren(speicher, { zeit: new Date().toISOString(), chat: decodeURIComponent(nachricht[1]!), nachricht: body });
    return json(201, { id: `msg-${++n}` });
  }
  json(404, { error: { message: `Die Attrappe kennt ${req.method} ${pfad} nicht.` } });
}
