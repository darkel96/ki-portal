/**
 * Wissensquellen wirksam machen: Vor einem KI-Schritt holt der Hub passende Auszüge aus SharePoint (Copilot Retrieval API)
 * und den Inhalt einzelner Dateien und hängt sie der Anfrage an. So arbeitet die KI mit belegten Inhalten statt mit
 * dem, was sie zufällig findet. Braucht die Copilot-Anmeldung (Sites.Read.All); ohne sie bleiben die Quellen ein Hinweis.
 */
import { graphToken } from "./auth";
import { kiModus } from "./index";
import { shareId } from "./vorlagen";
import type { Quelle } from "../schema";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Zeichen je Quelle, die höchstens in die Anfrage wandern */
const MAX_JE_QUELLE = 12_000;
const MAX_TREFFER = 8;

export type Auszug = { titel: string; url: string; text: string; fehler?: string };

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
  const teile: string[] = [];
  for (const h of j.retrievalHits ?? []) {
    const text = (h.extracts ?? []).map((e) => e.text?.trim()).filter(Boolean).join("\n");
    if (text) teile.push(`[${h.resourceMetadata?.title || h.webUrl || "Dokument"}]${h.webUrl ? ` ${h.webUrl}` : ""}\n${text}`);
  }
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
async function dateiLaden(q: Quelle, token: string, signal?: AbortSignal): Promise<Auszug> {
  const r = await fetch(`${GRAPH}/shares/${shareId(q.url)}/driveItem`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!r.ok) throw new Error(r.status === 403 ? "kein Lesezugriff" : r.status === 404 ? "Datei nicht gefunden" : `HTTP ${r.status}`);
  const meta = (await r.json()) as { name?: string; "@microsoft.graph.downloadUrl"?: string };
  const inhalt = await fetch(`${GRAPH}/shares/${shareId(q.url)}/driveItem/content`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!inhalt.ok) throw new Error(`Download HTTP ${inhalt.status}`);
  const blob = await inhalt.blob();
  const { extractText } = await import("../files");
  const text = await extractText(new File([blob], meta.name || "datei", { type: blob.type }));
  return { titel: q.titel || meta.name || q.url, url: q.url, text: text.slice(0, MAX_JE_QUELLE) };
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
  return "Auszüge aus den hinterlegten Wissensquellen (nur diese Inhalte gelten als belegt):\n\n" + a.map((x) =>
    x.fehler ? `### ${x.titel}\n(konnte nicht gelesen werden: ${x.fehler})` : `### ${x.titel}\n${x.text || "(keine passenden Inhalte gefunden)"}`).join("\n\n");
}
