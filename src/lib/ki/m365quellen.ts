/**
 * Wissensquellen aus Microsoft 365 der angemeldeten Person: eigene E-Mails, Teams-Chats und -Kanäle, Termine eines
 * Zeitraums. Der Hub liest sie vor dem KI-Schritt über Microsoft Graph und gibt sie als Auszüge mit (je Nachricht mit
 * Link, damit die KI sie als Quelle nennen kann). Ohne Copilot-Anmeldung kommen Beispiele, damit sich eine App prüfen lässt.
 */
import { M365_QUELLEN, type Quelle } from "../schema";
import { MAX_BEREICH, type WissenAuszug } from "../request";
import { graphErreichbar, graphGet } from "./graph";
import { nachrichtLaden, nachrichtenSeit } from "./postfach";

const G = "https://graph.microsoft.com/";
const SCOPES = { mail: [`${G}Mail.Read`], teams: [`${G}Chat.Read`, `${G}ChannelMessage.Read.All`, `${G}Team.ReadBasic.All`, `${G}Channel.ReadBasic.All`], kalender: [`${G}Calendars.Read`] };
/** Zeichen je Nachricht bzw. Termin, damit viele Nachrichten in den Platz passen */
const JE_NACHRICHT = 1500;
const JE_CHAT_ZEILE = 400;

export const istM365Quelle = (q: Quelle) => M365_QUELLEN.has(q.typ);

/** Bezeichnung, wenn die Quelle keinen Titel hat */
export function quelleTitel(q: Quelle): string {
  if (q.titel.trim()) return q.titel.trim();
  if (q.typ === "mail") return `Meine E-Mails der letzten ${q.tage} Tage`;
  if (q.typ === "teams") return `Meine Teams-Nachrichten der letzten ${q.tage} Tage`;
  if (q.typ === "kalender") return `Mein Kalender (${q.tage} Tage zurück und voraus)`;
  return q.titel || q.url;
}

const woerter = (filter: string) => filter.split(/[,;]+/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
const passt = (text: string, w: string[]) => !w.length || w.some((x) => text.toLowerCase().includes(x));
const datum = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const kurz = (s: string, n: number) => { const t = s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); return t.length > n ? `${t.slice(0, n)} …` : t; };
export const htmlZuText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Blöcke bis zur Platzgrenze aneinanderhängen */
function bisGrenze(kopf: string, bloecke: string[]): string {
  let text = kopf, n = 0;
  for (const b of bloecke) { if (text.length + b.length + 2 > MAX_BEREICH) break; text += `\n\n${b}`; n++; }
  return n < bloecke.length ? `${text}\n\n(${bloecke.length - n} weitere Nachrichten passen nicht mehr in den Auszug)` : text;
}
const filterText = (q: Quelle) => (q.filter.trim() ? ` zum Filter „${q.filter.trim()}“` : "");

type GraphMail = { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: { emailAddress?: { name?: string; address?: string } }[]; receivedDateTime?: string; bodyPreview?: string; body?: { contentType?: string; content?: string }; webLink?: string; parentFolderId?: string };
const person = (p?: { emailAddress?: { name?: string; address?: string } }) => p?.emailAddress?.name || p?.emailAddress?.address || "";

async function mailAuszug(q: Quelle, signal?: AbortSignal): Promise<WissenAuszug> {
  const ab = new Date(Date.now() - q.tage * 86_400_000);
  const w = woerter(q.filter);
  const bloecke: string[] = [];
  let gesamt = 0;
  if (!graphErreichbar()) {
    const liste = await nachrichtenSeit(q.tage, signal);
    gesamt = liste.length;
    for (const n of liste.slice(0, 30)) {
      const voll = await nachrichtLaden(n.id, signal);
      if (!passt(`${voll.betreff} ${voll.von} ${voll.text}`, w)) continue;
      bloecke.push(`Dokument: E-Mail: ${voll.betreff}\nLink: https://outlook.office.com/mail/beispiel/${n.id}\nVon: ${voll.von} · An: ${voll.an.join(", ")} · Datum: ${datum(voll.empfangen)}\n${kurz(voll.text, JE_NACHRICHT)}`);
    }
    return { titel: `${quelleTitel(q)} (Beispielpostfach)`, url: "", quelleTyp: q.typ, text: bisGrenze(`${gesamt} E-Mails im Zeitraum, ${bloecke.length} davon passend${filterText(q)}.`, bloecke) };
  }
  // Gelöschte, Junk und Entwürfe weglassen; Gesendete bleiben (eigene Zusagen gehören zum Stand)
  const weg = new Set((await Promise.all(["deleteditems", "junkemail", "drafts"].map(async (x) => { try { return (await graphGet<{ id: string }>(`/v1.0/me/mailFolders/${x}?$select=id`, SCOPES.mail, signal)).id; } catch { return ""; } }))).filter(Boolean));
  let pfad: string | null = `/v1.0/me/messages?$filter=receivedDateTime ge ${ab.toISOString()}&$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,webLink,parentFolderId`;
  while (pfad && gesamt < 300) {
    const j: { value: GraphMail[]; "@odata.nextLink"?: string } = await graphGet(pfad, SCOPES.mail, signal, 'outlook.body-content-type="text"');
    for (const m of j.value) {
      if (weg.has(m.parentFolderId ?? "")) continue;
      gesamt++;
      const text = m.body?.contentType?.toLowerCase() === "html" ? htmlZuText(m.body.content ?? "") : m.body?.content ?? m.bodyPreview ?? "";
      if (!passt(`${m.subject ?? ""} ${person(m.from)} ${text}`, w)) continue;
      bloecke.push(`Dokument: E-Mail: ${m.subject?.trim() || "(kein Betreff)"}\nLink: ${m.webLink ?? ""}\nVon: ${person(m.from)} · An: ${(m.toRecipients ?? []).map(person).filter(Boolean).join(", ")} · Datum: ${datum(m.receivedDateTime ?? "")}\n${kurz(text, JE_NACHRICHT)}`);
    }
    pfad = j["@odata.nextLink"] ?? null;
  }
  return { titel: quelleTitel(q), url: "", quelleTyp: q.typ, text: bisGrenze(`${gesamt} E-Mails im Zeitraum, ${bloecke.length} davon passend${filterText(q)}.`, bloecke) };
}

type GraphChat = { id: string; topic?: string | null; chatType?: string; webUrl?: string; members?: { displayName?: string }[]; lastMessagePreview?: { createdDateTime?: string } };
type GraphChatMsg = { id: string; messageType?: string; createdDateTime?: string; from?: { user?: { displayName?: string } | null; application?: { displayName?: string } | null }; body?: { contentType?: string; content?: string }; webUrl?: string };

const chatName = (c: GraphChat) => c.topic || (c.members ?? []).map((m) => m.displayName).filter(Boolean).join(", ") || "Chat";
const absender = (m: GraphChatMsg) => m.from?.user?.displayName || m.from?.application?.displayName || "Unbekannt";
function chatZeilen(msgs: GraphChatMsg[], ab: Date, w: string[]): string[] {
  return msgs.filter((m) => (m.messageType ?? "message") === "message" && Date.parse(m.createdDateTime ?? "") >= ab.getTime())
    .map((m) => ({ m, text: kurz(htmlZuText(m.body?.content ?? ""), JE_CHAT_ZEILE) }))
    .filter(({ m, text }) => text && passt(`${absender(m)} ${text}`, w))
    .sort((a, b) => (a.m.createdDateTime ?? "").localeCompare(b.m.createdDateTime ?? ""))
    .map(({ m, text }) => `[${datum(m.createdDateTime ?? "")}] ${absender(m)}: ${text}`);
}

async function teamsAuszug(q: Quelle, signal?: AbortSignal): Promise<WissenAuszug> {
  const ab = new Date(Date.now() - q.tage * 86_400_000);
  const w = woerter(q.filter);
  if (!graphErreichbar()) {
    const bsp = [
      `Dokument: Teams-Chat mit Anna Berger\nLink: https://teams.microsoft.com/l/chat/beispiel-1\n[${datum(new Date(Date.now() - 2 * 86_400_000).toISOString())}] Anna Berger: Kannst du das CRA Attest für Linie 3 bis Freitag freigeben?\n[${datum(new Date(Date.now() - 2 * 86_400_000 + 3_600_000).toISOString())}] Du: Schaue ich heute an, Rückmeldung bis morgen.`,
      `Dokument: Teams-Kanal Projekt Nordhafen › Allgemein\nLink: https://teams.microsoft.com/l/channel/beispiel-2\n[${datum(new Date(Date.now() - 4 * 86_400_000).toISOString())}] Sales-Service: Angebot Nordhafen ist raus, Kunde meldet sich nächste Woche.`,
    ].filter((b) => passt(b, w));
    return { titel: `${quelleTitel(q)} (Beispiel)`, url: "", quelleTyp: q.typ, text: bisGrenze(`${bsp.length} Unterhaltungen mit Nachrichten im Zeitraum${filterText(q)}.`, bsp) };
  }
  const bloecke: string[] = [];
  const hinweise: string[] = [];
  // Chats: nur die mit neuen Nachrichten im Zeitraum, höchstens 20
  try {
    const chats = await graphGet<{ value: GraphChat[] }>(`/v1.0/me/chats?$expand=members,lastMessagePreview&$top=50`, SCOPES.teams, signal);
    const neu = chats.value.filter((c) => Date.parse(c.lastMessagePreview?.createdDateTime ?? "") >= ab.getTime()).slice(0, 20);
    const teile = await Promise.all(neu.map(async (c) => {
      try {
        const msgs = await graphGet<{ value: GraphChatMsg[] }>(`/v1.0/me/chats/${encodeURIComponent(c.id)}/messages?$top=50`, SCOPES.teams, signal);
        const zeilen = chatZeilen(msgs.value, ab, w);
        return zeilen.length ? `Dokument: Teams-Chat mit ${chatName(c)}\nLink: ${c.webUrl ?? ""}\n${zeilen.join("\n")}` : "";
      } catch (e) { hinweise.push(`Chat „${chatName(c)}“: ${e instanceof Error ? e.message : String(e)}`); return ""; }
    }));
    bloecke.push(...teile.filter(Boolean));
  } catch (e) { hinweise.push(`Chats konnten nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`); }
  // Kanäle der eigenen Teams: höchstens 5 Teams mit je 6 Kanälen
  try {
    const teams = await graphGet<{ value: { id: string; displayName?: string }[] }>(`/v1.0/me/joinedTeams`, SCOPES.teams, signal);
    for (const t of teams.value.slice(0, 5)) {
      const kanaele = await graphGet<{ value: { id: string; displayName?: string; webUrl?: string }[] }>(`/v1.0/teams/${encodeURIComponent(t.id)}/channels?$select=id,displayName,webUrl`, SCOPES.teams, signal);
      const teile = await Promise.all(kanaele.value.slice(0, 6).map(async (k) => {
        try {
          const msgs = await graphGet<{ value: GraphChatMsg[] }>(`/v1.0/teams/${encodeURIComponent(t.id)}/channels/${encodeURIComponent(k.id)}/messages?$top=30`, SCOPES.teams, signal);
          const zeilen = chatZeilen(msgs.value, ab, w);
          return zeilen.length ? `Dokument: Teams-Kanal ${t.displayName ?? "Team"} › ${k.displayName ?? "Kanal"}\nLink: ${k.webUrl ?? ""}\n${zeilen.join("\n")}` : "";
        } catch (e) { hinweise.push(`Kanal „${k.displayName ?? ""}“: ${e instanceof Error ? e.message : String(e)}`); return ""; }
      }));
      bloecke.push(...teile.filter(Boolean));
    }
  } catch (e) { hinweise.push(`Kanäle konnten nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`); }
  const kopf = `${bloecke.length} Unterhaltungen mit Nachrichten im Zeitraum${filterText(q)}.${hinweise.length ? ` Hinweise: ${[...new Set(hinweise)].slice(0, 3).join(" ")}` : ""}`;
  return { titel: quelleTitel(q), url: "", quelleTyp: q.typ, text: bisGrenze(kopf, bloecke) };
}

type GraphTermin = { subject?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; organizer?: { emailAddress?: { name?: string; address?: string } }; attendees?: { emailAddress?: { name?: string; address?: string } }[]; location?: { displayName?: string }; bodyPreview?: string; isCancelled?: boolean; webLink?: string };
const terminZeile = (t: GraphTermin) => {
  const start = t.start?.dateTime ? datum(t.start.dateTime.replace(/\.\d+$/, "")) : "";
  const ende = t.end?.dateTime ? new Date(t.end.dateTime.replace(/\.\d+$/, "")).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
  const leute = (t.attendees ?? []).map(person).filter(Boolean);
  return `- ${start}${ende ? `–${ende}` : ""}: ${t.subject?.trim() || "(ohne Betreff)"}${t.isCancelled ? " (abgesagt)" : ""} · Organisation: ${person(t.organizer) || "–"}${leute.length ? ` · ${leute.length} Teilnehmende: ${leute.slice(0, 8).join(", ")}${leute.length > 8 ? " …" : ""}` : ""}${t.location?.displayName ? ` · Ort: ${t.location.displayName}` : ""}${t.bodyPreview?.trim() ? `\n  ${kurz(t.bodyPreview, 200)}` : ""}${t.webLink ? `\n  Link: ${t.webLink}` : ""}`;
};

async function kalenderAuszug(q: Quelle, signal?: AbortSignal): Promise<WissenAuszug> {
  const jetzt = Date.now();
  const von = new Date(jetzt - q.tage * 86_400_000), bis = new Date(jetzt + q.tage * 86_400_000);
  if (!graphErreichbar()) {
    const t = (tage: number, h: number) => { const d = new Date(jetzt + tage * 86_400_000); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const bsp: GraphTermin[] = [
      { subject: "Lenkungskreis CRA", start: { dateTime: t(-3, 14) }, end: { dateTime: t(-3, 15) }, organizer: { emailAddress: { name: "Anna Berger" } }, attendees: [{ emailAddress: { name: "Dario Keller" } }, { emailAddress: { name: "Thomas Bothmann" } }] },
      { subject: "Kundentermin Nordhafen", start: { dateTime: t(-1, 9) }, end: { dateTime: t(-1, 10) }, organizer: { emailAddress: { name: "Sales-Service" } }, location: { displayName: "Teams" } },
      { subject: "Teamrunde", start: { dateTime: t(1, 10) }, end: { dateTime: t(1, 11) }, organizer: { emailAddress: { name: "Dario Keller" } } },
      { subject: "Audit-Vorbereitung ISO 27001", start: { dateTime: t(4, 13) }, end: { dateTime: t(4, 15) }, organizer: { emailAddress: { name: "Produktsicherheit" } } },
    ];
    return { titel: `${quelleTitel(q)} (Beispiel)`, url: "", quelleTyp: q.typ, text: kalenderText(bsp, jetzt) };
  }
  const j = await graphGet<{ value: GraphTermin[] }>(`/v1.0/me/calendarView?startDateTime=${von.toISOString()}&endDateTime=${bis.toISOString()}&$orderby=start/dateTime&$top=100&$select=subject,start,end,organizer,attendees,location,bodyPreview,isCancelled,webLink`, SCOPES.kalender, signal, 'outlook.timezone="Europe/Berlin"');
  return { titel: quelleTitel(q), url: "", quelleTyp: q.typ, text: kalenderText(j.value, jetzt) };
}
function kalenderText(termine: GraphTermin[], jetzt: number): string {
  const zeit = (t: GraphTermin) => Date.parse((t.start?.dateTime ?? "").replace(/\.\d+$/, ""));
  const vergangen = termine.filter((t) => zeit(t) < jetzt), kommend = termine.filter((t) => zeit(t) >= jetzt);
  return [`${termine.length} Termine im Zeitraum.`, `Vergangene Termine (${vergangen.length}):`, ...(vergangen.length ? vergangen.map(terminZeile) : ["- keine"]), "", `Kommende Termine (${kommend.length}):`, ...(kommend.length ? kommend.map(terminZeile) : ["- keine"])].join("\n").slice(0, MAX_BEREICH);
}

/** Auszug zu einer Microsoft-365-Quelle; Fehler landen im Auszug, der Schritt läuft weiter */
export async function m365Auszug(q: Quelle, signal?: AbortSignal): Promise<WissenAuszug> {
  try {
    if (q.typ === "mail") return await mailAuszug(q, signal);
    if (q.typ === "teams") return await teamsAuszug(q, signal);
    if (q.typ === "kalender") return await kalenderAuszug(q, signal);
    throw new Error("Unbekannte Quelle.");
  } catch (e) {
    return { titel: quelleTitel(q), url: "", quelleTyp: q.typ, text: "", fehler: e instanceof Error ? e.message : String(e) };
  }
}

/** Platzhalter wie {{thema}} im Filter durch Eingaben ersetzen */
export function filterAufloesen(q: Quelle, werte: Record<string, unknown>): Quelle {
  if (!istM365Quelle(q) || !q.filter.includes("{{")) return q;
  return { ...q, filter: q.filter.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_m, k: string) => String(werte[k] ?? "").trim()) };
}
