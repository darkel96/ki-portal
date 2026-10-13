/**
 * Wissensquellen wirksam machen: Vor einem KI-Schritt holt der Hub passende Auszüge aus SharePoint (Copilot Retrieval API)
 * und den Inhalt einzelner Dateien und hängt sie der Anfrage an. So arbeitet die KI mit belegten Inhalten statt mit
 * dem, was sie zufällig findet. Braucht die Copilot-Anmeldung (Sites.Read.All); ohne sie bleiben die Quellen ein Hinweis.
 */
import { graphToken } from "./auth";
import { kiModus } from "./index";
import { shareId } from "./vorlagen";
import { officeLink } from "../links";
import type { Quelle } from "../schema";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Zeichen je Quelle, die höchstens in die Anfrage wandern */
const MAX_JE_QUELLE = 40_000;
/** Treffer je SharePoint-Bereich (die Retrieval API erlaubt bis 25) */
const MAX_TREFFER = 20;

export type Auszug = { titel: string; url: string; text: string; fehler?: string; quelleTyp?: Quelle["typ"] };

export const wissenMoeglich = () => kiModus() === "copilot";

/** Treffer der Copilot Retrieval API für einen SharePoint-Bereich (Website, Bibliothek oder Ordner) */
async function sharepointAuszuege(q: Quelle, suche: string, token: string, signal?: AbortSignal): Promise<Auszug> {
  const r = await fetch(`${GRAPH}/copilot/retrieval`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queryString: suche.slice(0, 1500), dataSource: "sharePoint", filterExpression: `path:"${q.url.trim()}"`, maximumNumberOfResults: MAX_TREFFER, resourceMetadata: ["title"] }),
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
  const teile = [...dokumente.values()].map((d) => [`Dokument: ${d.titel}`, d.link ? `Link: ${d.link}` : "", ...d.stellen.map((t, i) => `Stelle ${i + 1}:\n${t}`)].filter(Boolean).join("\n"));
  return { titel: q.titel || q.url, url: q.url, text: teile.join("\n\n").slice(0, MAX_JE_QUELLE) };
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
  const meta = await dateiFinden(q.url, token, signal);
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
export async function wissenAuszuege(quellen: Quelle[], suche: string, signal?: AbortSignal): Promise<Auszug[]> {
  const lesbar = quellen.filter((q) => (q.typ === "sharepoint" || q.typ === "datei") && q.url.trim());
  if (!lesbar.length || !wissenMoeglich()) return [];
  const token = await graphToken();
  return Promise.all(lesbar.map(async (q) => {
    try { return q.typ === "datei" ? await dateiAuszug(q, token, signal) : await sharepointAuszuege(q, suche, token, signal); }
    catch (e) { return { titel: q.titel || q.url, url: q.url, text: "", fehler: e instanceof Error ? e.message : String(e) }; }
  }));
}

/** Text für die Anfrage */
export function auszuegeText(a: Auszug[]): string {
  if (!a.length) return "";
  return "Auszüge aus den hinterlegten Wissensquellen (nur diese Inhalte gelten als belegt). Nutze alle passenden Dokumente und Stellen, nicht nur das erste. Quellenangaben schreibst du als Markdown-Link auf den Link des Dokuments und nennst die Stelle: die Überschrift oder den Abschnitt, unter dem der Inhalt in der Stelle steht, sonst die Nummer der Stelle, z. B. [CRA Q&A, Abschnitt Scope](https://…) oder [CRA Schulung, Stelle 3](https://…). Gib nie die nackte Adresse aus, immer Linktext in eckigen Klammern und Adresse in runden Klammern:\n\n" + a.map((x) =>
    x.fehler ? `### ${x.titel}\n(konnte nicht gelesen werden: ${x.fehler})` : `### ${x.titel}\n${x.text ? `${x.quelleTyp === "datei" ? `Link: ${x.url}\n` : ""}${x.text}` : "(keine passenden Inhalte gefunden)"}`).join("\n\n");
}
