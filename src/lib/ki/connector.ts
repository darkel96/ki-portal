/**
 * Wissen aus einem Microsoft-Graph-Connector (z. B. Netzlaufwerk über den Connector „Dateifreigabe“): Der Hub fragt die
 * zur Frage passenden Stellen im Namen der angemeldeten Person ab (ExternalItem.Read.All). Microsoft liefert nur, was
 * die Person auch auf dem Laufwerk lesen darf. Erst die Retrieval-API von Copilot (längere Textstellen), sonst die
 * Microsoft-Suche (kurze Zusammenfassungen).
 */
import { KI_CONFIG } from "./config";
import type { Quelle } from "../schema";
import { MAX_BEREICH, type WissenAuszug } from "../request";

type Treffer = { titel: string; url: string; text: string };

/** Pfad vergleichbar machen: „Y:\Projekte\KTE“, „\\server\freigabe\Projekte“ und „file://server/…“ */
const entschluesseln = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
export const pfadNorm = (p: string) => entschluesseln(p).replace(/\\/g, "/").replace(/^file:\/*/i, "").replace(/^[a-z]:/i, "").replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
/** Liegt die Datei im gewünschten Ordner? Ein Laufwerksbuchstabe in der Eingabe zählt nicht (der Connector kennt den Serverpfad) */
export const imOrdner = (url: string, ordner: string) => { const o = pfadNorm(ordner); return !o || pfadNorm(url).includes(o); };
export const gueltigeVerbindung = (id: string) => /^[A-Za-z0-9]{3,32}$/.test(id.trim());

async function post<T>(pfad: string, token: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; daten: T | null; text: string }> {
  const r = await fetch(`${KI_CONFIG.graph}${pfad}`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text().catch(() => "");
  let daten: T | null = null;
  try { daten = text ? (JSON.parse(text) as T) : null; } catch { /* kein JSON */ }
  return { status: r.status, daten, text };
}

type Retrieval = { retrievalHits?: { webUrl?: string; extracts?: { text?: string }[]; resourceMetadata?: { title?: string } }[] };
type Suche = { value?: { hitsContainers?: { hits?: { summary?: string; resource?: { properties?: Record<string, unknown>; webUrl?: string } }[] }[] }[] };

async function abfragen(id: string, frage: string, token: string, signal?: AbortSignal): Promise<Treffer[]> {
  const queryString = frage.replace(/\s+/g, " ").trim().slice(0, 1500) || "*";
  // Retrieval-API (v1.0, sonst beta): Textstellen aus den Dokumenten
  for (const v of ["v1.0", "beta"]) {
    const r = await post<Retrieval>(`/${v}/copilot/retrieval`, token, {
      queryString, dataSource: "externalItem", dataSourceConfiguration: { externalItem: { connections: [{ connectionId: id }] } },
      resourceMetadata: ["title"], maximumNumberOfResults: 20,
    }, signal);
    if (r.status === 200 && r.daten) {
      return (r.daten.retrievalHits ?? []).map((h) => ({ titel: h.resourceMetadata?.title || (h.webUrl ?? "").split(/[\\/]/).pop() || "Dokument", url: h.webUrl ?? "", text: (h.extracts ?? []).map((e) => e.text ?? "").filter(Boolean).join("\n…\n") }));
    }
    if (r.status === 401 || r.status === 403) throw new Error(fehlerText(r.status, r.text));
  }
  // Microsoft-Suche: kurze Zusammenfassungen je Treffer
  const s = await post<Suche>("/v1.0/search/query", token, {
    requests: [{ entityTypes: ["externalItem"], contentSources: [`/external/connections/${id}`], query: { queryString }, from: 0, size: 20, fields: ["title", "url", "fileName", "path"] }],
  }, signal);
  if (s.status !== 200 || !s.daten) throw new Error(fehlerText(s.status, s.text));
  return (s.daten.value?.[0]?.hitsContainers?.[0]?.hits ?? []).map((h) => {
    const p = h.resource?.properties ?? {};
    const url = String(p.url ?? p.path ?? h.resource?.webUrl ?? "");
    return { titel: String(p.title ?? p.fileName ?? (url.split(/[\\/]/).pop() || "Dokument")), url, text: (h.summary ?? "").replace(/<\/?c\d*>|<ddd\/>/g, "") };
  });
}

function fehlerText(status: number, text: string): string {
  const code = /"code"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? "";
  if (status === 401 || status === 403) return "Kein Zugriff auf den Connector. Nötig ist die Berechtigung ExternalItem.Read.All mit Administratorzustimmung; für Copilot muss der Connector außerdem freigegeben sein.";
  if (status === 404 || /NotFound|InvalidConnection/i.test(code)) return "Diesen Connector gibt es nicht. Bitte die Verbindungs-ID im Microsoft 365 Admin Center prüfen.";
  return `Graph antwortet mit Fehler ${status}${code ? ` (${code})` : ""}.`;
}

/**
 * Auszug aus einem Connector: die zur Frage passenden Stellen, optional nur aus einem Ordner (q.filter). Findet die
 * Frage nichts, wird einmal mit dem breiteren Thema der App nachgesucht.
 */
export async function connectorAuszug(q: Quelle, suche: string, token: string, signal?: AbortSignal, breiter?: string): Promise<WissenAuszug> {
  const id = q.url.trim();
  const titel = q.titel || "Netzlaufwerk";
  if (!gueltigeVerbindung(id)) return { titel, url: "", text: "", fehler: "Keine gültige Verbindungs-ID (3 bis 32 Buchstaben und Ziffern, aus dem Microsoft 365 Admin Center).", quelleTyp: "connector" };
  let treffer = (await abfragen(id, suche, token, signal)).filter((t) => imOrdner(t.url, q.filter));
  if (!treffer.length && breiter?.trim() && breiter.trim() !== suche.trim()) treffer = (await abfragen(id, breiter, token, signal)).filter((t) => imOrdner(t.url, q.filter));
  let text = "";
  for (const t of treffer) {
    if (!t.text.trim()) continue;
    const teil = `#### ${t.titel}\nLink: ${t.url}\n${t.text.trim()}\n\n`;
    if (text.length + teil.length > MAX_BEREICH) break;
    text += teil;
  }
  return { titel, url: "", text: text.trim(), quelleTyp: "connector", dateien: treffer.map((t) => t.titel).slice(0, 30), dateienGesamt: treffer.length };
}
