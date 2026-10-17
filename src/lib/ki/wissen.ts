/**
 * Wissensquellen wirksam machen: Vor einem KI-Schritt holt der Hub passende Auszüge aus SharePoint (Copilot Retrieval API)
 * und den Inhalt einzelner Dateien und hängt sie der Anfrage an. So arbeitet die KI mit belegten Inhalten statt mit
 * dem, was sie zufällig findet. Braucht die Copilot-Anmeldung (Sites.Read.All); ohne sie bleiben die Quellen ein Hinweis.
 */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";
import { shareId } from "./vorlagen";
import { officeLink } from "../links";
import type { Quelle } from "../schema";
import { MAX_JE_QUELLE, type WissenAuszug } from "../request";

const GRAPH = `${KI_CONFIG.graph}/v1.0`;
/** Zeichen je Quelle, die höchstens in die Anfrage wandern */
/** Treffer je SharePoint-Bereich (die Retrieval API erlaubt bis 25) */
const MAX_TREFFER = 20;

export type Auszug = WissenAuszug;

export const wissenMoeglich = () => kiModus() === "copilot";

/**
 * Leerzeichen und Klammern in Adressen kodieren: Ein Markdown-Link der KI endet sonst am ersten Leerzeichen oder an der
 * ersten „)“ (Ordner wie „KPSS Templates“ oder „… (CRA) …“ sind in SharePoint üblich).
 */
export const linkSauber = (u: string) => u.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/**
 * Adresse aus einer Bibliotheksansicht („…/Forms/Ansicht.aspx?id=/sites/…/Ordner“) in die direkte Ordner- bzw.
 * Dateiadresse umwandeln; so kopieren viele die Adresse aus dem Browser. Andere Adressen bleiben, wie sie sind.
 */
export function bereichAdresse(url: string): string {
  try {
    const u = new URL(url.trim());
    const id = u.searchParams.get("id");
    if (/sharepoint\.com$/i.test(u.hostname) && id?.startsWith("/")) return `${u.origin}${encodeURI(id)}`;
  } catch { /* keine Adresse */ }
  return url.trim();
}

/** Textdateien, die die Retrieval API nicht auswertet (Markdown, Text, CSV …): der Hub liest sie selbst */
export const TEXT_DATEI = /\.(md|markdown|txt|csv|json|xml|html?|vtt)$/i;
const STOPP = new Set("der die das den dem des ein eine einer eines und oder aber ab an auf aus bei bis für mit nach von vor zu zum zur im in ist sind wird werden wie was wer wo wann gilt gelten welche welcher welches nicht kein keine auch noch nur über unter als dass sich es er sie wir ihr man mal bitte the and for".split(" "));
const FRAGE: Record<string, string[]> = {
  wann: ["datum", "frist", "zeitplan", "termin", "anwendbar", "inkraft"], gilt: ["anwendbar", "geltung", "inkraft"], gelten: ["anwendbar", "geltung"],
  wer: ["verantwort", "rolle", "zuständig"], welche: [], wie: ["prozess", "schritt", "vorgehen"], warum: ["zweck", "ziel"],
};
type TextDatei = { name: string; link: string; text: string };
const ordnerCache = new Map<string, { zeit: number; dateien: TextDatei[] }>();

/** Alle Textdateien eines Ordners (drei Ebenen tief, höchstens 40) bzw. die Datei selbst */
async function textDateien(url: string, token: string, signal?: AbortSignal): Promise<TextDatei[]> {
  const alt = ordnerCache.get(url);
  if (alt && Date.now() - alt.zeit < DATEI_CACHE_MS) return alt.dateien;
  const kopf = { headers: { Authorization: `Bearer ${token}` }, signal };
  type Item = { id: string; name: string; webUrl?: string; size?: number; file?: object; folder?: object; parentReference?: { driveId?: string } };
  const r = await fetch(`${GRAPH}/shares/${shareId(url)}/driveItem?$select=id,name,webUrl,size,file,folder,parentReference`, kopf);
  if (!r.ok) return [];
  const start = (await r.json()) as Item;
  const drive = start.parentReference?.driveId;
  const gefunden: (Item & { drive: string })[] = [];
  if (start.file && TEXT_DATEI.test(start.name) && drive) gefunden.push({ ...start, drive });
  const lauf = async (driveId: string, id: string, tiefe: number) => {
    const k = await fetch(`${GRAPH}/drives/${driveId}/items/${id}/children?$select=id,name,webUrl,size,file,folder&$top=200`, kopf);
    if (!k.ok) return;
    const liste = ((await k.json()) as { value?: Item[] }).value ?? [];
    for (const x of liste) if (x.file && TEXT_DATEI.test(x.name) && (x.size ?? 0) < 2_000_000 && gefunden.length < 40) gefunden.push({ ...x, drive: driveId });
    if (tiefe < 3) for (const x of liste) if (x.folder && gefunden.length < 40) await lauf(driveId, x.id, tiefe + 1);
  };
  if (start.folder && drive) await lauf(drive, start.id, 0);
  const dateien = (await Promise.all(gefunden.map(async (x) => {
    const c = await fetch(`${GRAPH}/drives/${x.drive}/items/${x.id}/content`, kopf).catch(() => null);
    return c?.ok ? { name: x.name, link: x.webUrl ?? "", text: (await c.text()).trim() } : null;
  }))).filter((x): x is TextDatei => !!x?.text);
  ordnerCache.set(url, { zeit: Date.now(), dateien });
  return dateien;
}

/** Abschnitte (an Überschriften getrennt, höchstens etwa 1.800 Zeichen) mit ihrer Überschrift */
function abschnitte(text: string): { titel: string; text: string }[] {
  const out: { titel: string; text: string }[] = [];
  let titel = "", teil: string[] = [];
  const raus = () => { const t = teil.join("\n").trim(); if (t) for (let i = 0; i < t.length; i += 1800) out.push({ titel, text: t.slice(i, i + 1800) }); teil = []; };
  for (const z of text.split(/\r?\n/)) {
    const m = /^#{1,4}\s+(.+)$/.exec(z);
    if (m) { raus(); titel = m[1].trim(); }
    teil.push(z);
  }
  raus();
  return out;
}

/**
 * Text aus Textdateien für die Anfrage: kleine Bestände ganz (bis 24.000 Zeichen), große als die Abschnitte, die
 * am besten zur Frage passen. Jede Stelle nennt ihren Abschnitt, damit die KI ihn als Fundstelle angeben kann.
 */
export function textAuszug(dateien: TextDatei[], suche: string, max = 24_000): string {
  if (!dateien.length) return "";
  const gesamt = dateien.reduce((n, d) => n + d.text.length, 0);
  if (gesamt <= max) return dateien.map((d) => [`Dokument: ${d.name}`, d.link ? `Link: ${linkSauber(d.link)}` : "", d.text].filter(Boolean).join("\n")).join("\n\n");
  const roh = suche.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/);
  // Fragewörter auf das abbilden, wonach in Dokumenten gesucht werden muss („Ab wann gilt …?“ → Datum, Frist, anwendbar)
  const dazu = roh.flatMap((w) => FRAGE[w] ?? []);
  const woerter = [...new Set([...roh.filter((w) => w.length >= 3 && !STOPP.has(w)), ...dazu])];
  const kandidaten = dateien.flatMap((d) => abschnitte(d.text).map((a) => {
    const t = (a.titel + " " + a.text).toLowerCase();
    const punkte = woerter.reduce((n, w) => n + (t.includes(w.slice(0, 7)) ? (a.titel.toLowerCase().includes(w.slice(0, 7)) ? 2 : 1) : 0), 0);
    return { d, a, punkte };
  })).filter((k) => k.punkte > 0).sort((x, y) => y.punkte - x.punkte);
  const je = new Map<TextDatei, string[]>();
  let laenge = 0;
  for (const k of kandidaten) {
    if (laenge + k.a.text.length > max) break;
    const liste = je.get(k.d) ?? [];
    liste.push(`Stelle ${liste.length + 1}${k.a.titel ? ` (Abschnitt „${k.a.titel}“)` : ""}:\n${k.a.text}`);
    je.set(k.d, liste);
    laenge += k.a.text.length;
  }
  return [...je.entries()].map(([d, stellen]) => [`Dokument: ${d.name}`, d.link ? `Link: ${linkSauber(d.link)}` : "", ...stellen].filter(Boolean).join("\n")).join("\n\n");
}

/** Treffer der Copilot Retrieval API für einen SharePoint-Bereich (Website, Bibliothek oder Ordner), ergänzt um die Textdateien darin */
async function sharepointAuszuege(q: Quelle, suche: string, token: string, signal?: AbortSignal, breiter?: string): Promise<Auszug> {
  const url = bereichAdresse(q.url);
  let retrieval = "", fehler = "";
  try {
    retrieval = await retrievalText(url, suche, token, signal);
    if (!retrieval && breiter && breiter !== suche) retrieval = await retrievalText(url, breiter, token, signal);
  } catch (e) { if (signal?.aborted) throw e; fehler = e instanceof Error ? e.message : String(e); }
  const extra = textAuszug(await textDateien(url, token, signal).catch(() => []), suche);
  const text = [retrieval, extra].filter(Boolean).join("\n\n").slice(0, MAX_JE_QUELLE);
  if (!text && fehler) throw new Error(fehler);
  return { titel: q.titel || q.url, url: q.url, text };
}

async function retrievalText(url: string, suche: string, token: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`${GRAPH}/copilot/retrieval`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queryString: suche.slice(0, 1500), dataSource: "sharePoint", filterExpression: `path:"${url}"`, maximumNumberOfResults: MAX_TREFFER, resourceMetadata: ["title"] }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "kein Lesezugriff oder keine Copilot-Lizenz" : r.status === 404 ? "Bereich nicht gefunden" : `HTTP ${r.status}${code ? ` ${code}` : ""}`);
  }
  const j = (await r.json()) as { retrievalHits?: { webUrl?: string; resourceMetadata?: { title?: string }; extracts?: { text?: string }[] }[] };
  // Stellen je Dokument bündeln und nummerieren, damit die KI „Dokument, Stelle“ nennen kann
  const dokumente = new Map<string, { titel: string; link: string; stellen: string[] }>();
  for (const h of j.retrievalHits ?? []) {
    const link = h.webUrl ?? "";
    const titel = h.resourceMetadata?.title || link.split("/").pop()?.replace(/\.[^.]+$/, "") || "Dokument";
    const d = dokumente.get(link || titel) ?? { titel, link, stellen: [] };
    for (const e of h.extracts ?? []) { const t = e.text?.trim(); if (t && !d.stellen.includes(t)) d.stellen.push(t); }
    if (d.stellen.length) dokumente.set(link || titel, d);
  }
  const teile = [...dokumente.values()].map((d) => [`Dokument: ${d.titel}`, d.link ? `Link: ${linkSauber(d.link)}` : "", ...d.stellen.map((t, i) => `Stelle ${i + 1}:\n${t}`)].filter(Boolean).join("\n"));
  return teile.join("\n\n");
}

/** Gelesene Dateien bleiben zehn Minuten im Speicher: Ein Chat fragt sie bei jeder Frage, der Inhalt ändert sich dabei nicht */
const dateiCache = new Map<string, { zeit: number; auszug: Auszug }>();
const DATEI_CACHE_MS = 10 * 60_000;

/** Inhalt einer einzelnen Datei (SharePoint/OneDrive-Adresse), als Text wie bei einem Upload */
async function dateiAuszug(q: Quelle, token: string, signal?: AbortSignal): Promise<Auszug> {
  const alt = dateiCache.get(q.url.trim());
  if (alt && Date.now() - alt.zeit < DATEI_CACHE_MS) return { ...alt.auszug, titel: q.titel || alt.auszug.titel };
  const auszug = await dateiLaden(q, token, signal);
  dateiCache.set(q.url.trim(), { zeit: Date.now(), auszug });
  return auszug;
}

type Element = { name?: string; inhaltUrl: string };
/**
 * Laufwerkselement zu einer Dateiadresse: Freigabe-API für normale Adressen und Freigabelinks; Office-Links
 * (Doc.aspx mit sourcedoc/file) findet die Graph-Suche über Dateiname und Website.
 */
async function dateiFinden(url: string, token: string, signal?: AbortSignal): Promise<Element> {
  const kopf = { headers: { Authorization: `Bearer ${token}` }, signal };
  const office = officeLink(url);
  if (!office) {
    const r = await fetch(`${GRAPH}/shares/${shareId(url)}/driveItem`, kopf);
    if (!r.ok) throw new Error(r.status === 403 ? "kein Lesezugriff" : r.status === 404 ? "Datei nicht gefunden" : `HTTP ${r.status}`);
    const meta = (await r.json()) as { name?: string };
    return { name: meta.name, inhaltUrl: `${GRAPH}/shares/${shareId(url)}/driveItem/content` };
  }
  const r = await fetch(`${GRAPH}/search/query`, {
    method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ entityTypes: ["driveItem"], query: { queryString: `filename:"${office.name.replace(/"/g, "")}" path:"${office.site}"` }, from: 0, size: 10 }] }),
  });
  if (!r.ok) throw new Error(r.status === 403 ? "kein Lesezugriff" : `Suche HTTP ${r.status}`);
  const j = (await r.json()) as { value?: { hitsContainers?: { hits?: { resource?: { id?: string; name?: string; parentReference?: { driveId?: string } } }[] }[] }[] };
  const treffer = (j.value ?? []).flatMap((v) => v.hitsContainers ?? []).flatMap((c) => c.hits ?? []).map((h) => h.resource).filter((x): x is NonNullable<typeof x> => !!x?.id && !!x.parentReference?.driveId);
  const genau = treffer.find((t) => t.name?.toLowerCase() === office.name.toLowerCase()) ?? treffer[0];
  if (!genau) throw new Error(`Datei „${office.name}“ in ${office.site} nicht gefunden`);
  return { name: genau.name ?? office.name, inhaltUrl: `${GRAPH}/drives/${genau.parentReference!.driveId}/items/${genau.id}/content` };
}

async function dateiLaden(q: Quelle, token: string, signal?: AbortSignal): Promise<Auszug> {
  const meta = await dateiFinden(bereichAdresse(q.url), token, signal);
  const inhalt = await fetch(meta.inhaltUrl, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!inhalt.ok) throw new Error(`Download HTTP ${inhalt.status}`);
  const blob = await inhalt.blob();
  const { extractText } = await import("../files");
  const text = await extractText(new File([blob], meta.name || "datei", { type: blob.type }));
  return { titel: q.titel || meta.name || q.url, url: q.url, text: text.slice(0, MAX_JE_QUELLE), quelleTyp: "datei" };
}

/**
 * Auszüge für alle lesbaren Quellen (SharePoint-Bereiche und einzelne Dateien). Webseiten kann der Hub nicht selbst
 * laden; sie bleiben ein Hinweis an die KI. Fehler werden je Quelle vermerkt, der Schritt läuft trotzdem.
 */
/**
 * breiter: Suchtext mit dem Thema der App (Name, Schrittname). Liefert die Suche zur eigentlichen Frage nichts (bei sehr
 * kurzen Fragen wie „was ist der cra“ passiert das), wird einmal damit nachgesucht.
 */
export async function wissenAuszuege(quellen: Quelle[], suche: string, signal?: AbortSignal, breiter?: string): Promise<Auszug[]> {
  const lesbar = quellen.filter((q) => (q.typ === "sharepoint" || q.typ === "datei") && q.url.trim());
  if (!lesbar.length || !wissenMoeglich()) return [];
  const token = await graphToken();
  return Promise.all(lesbar.map(async (q) => {
    try { return q.typ === "datei" ? await dateiAuszug(q, token, signal) : await sharepointAuszuege(q, suche, token, signal, breiter); }
    catch (e) { return { titel: q.titel || q.url, url: q.url, text: "", fehler: e instanceof Error ? e.message : String(e) }; }
  }));
}

/** Text für die Anfrage */
export function auszuegeText(a: Auszug[]): string {
  if (!a.length) return "";
  return "Auszüge aus den hinterlegten Wissensquellen (nur diese Inhalte gelten als belegt). Nutze alle passenden Dokumente und Stellen, nicht nur das erste. Quellenangaben schreibst du als Markdown-Link auf den Link des Dokuments und nennst die Stelle: die Überschrift oder den Abschnitt, unter dem der Inhalt in der Stelle steht, sonst die Nummer der Stelle, z. B. [CRA Q&A, Abschnitt Scope](https://…) oder [CRA Schulung, Stelle 3](https://…). Gib nie die nackte Adresse aus, immer Linktext in eckigen Klammern und Adresse in runden Klammern:\n\n" + a.map((x) =>
    x.fehler ? `### ${x.titel}\n(konnte nicht gelesen werden: ${x.fehler})` : `### ${x.titel}\n${x.text ? `${x.quelleTyp === "datei" ? `Link: ${linkSauber(x.url)}\n` : ""}${x.text}` : "(keine passenden Inhalte gefunden)"}`).join("\n\n");
}
