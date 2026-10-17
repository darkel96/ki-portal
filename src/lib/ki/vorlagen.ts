/**
 * Vorlagen aus SharePoint für Dateipakete: Ordner per Microsoft Graph auflisten (nur lesen) und einzelne
 * Dateien herunterladen, damit sie unverändert in ein ZIP wandern. Braucht die Copilot-Anmeldung
 * (Berechtigung Sites.Read.All); ohne sie gibt es keine Liste und keine Kopien.
 *
 * Adresse des Ordners wie im Browser, z. B.
 *   https://koerbergroup.sharepoint.com/sites/aberle-doc/Prozessdokumente/Service/Vorlagen und Formblätter
 * Aufgelöst wird wie in der Serviceangebote-App: Website → Bibliothek (Name oder Adressende) → Pfad im Laufwerk.
 * Andere Adressen (Freigabelinks, OneDrive) gehen über die Graph-API „shares“.
 */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";

export type Vorlage = { pfad: string; groesse: number; hash?: string; doppelt?: string };

const GRAPH = `${KI_CONFIG.graph}/v1.0`;
/** Ordner mit „Archiv“ im Namen werden nie als Quelle genutzt */
const ARCHIV = /archiv|archive/i;
const MAX_DATEIEN = 400;

export const vorlagenMoeglich = () => kiModus() === "copilot";

/** Freigabe-Kennung einer Adresse für die Graph-API „shares“ */
export function shareId(url: string): string {
  const b64 = btoa(unescape(encodeURIComponent(url.trim()))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

async function graphJson<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "Kein Lesezugriff auf diesen SharePoint-Ordner." : r.status === 404 ? "Der SharePoint-Ordner wurde nicht gefunden. Adresse prüfen." : `SharePoint antwortet mit HTTP ${r.status}${code ? ` (${code})` : ""}.`);
  }
  return (await r.json()) as T;
}

export type Ort = { basis: string };
const enc = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** Graph-Adresse des Ordners: über Website und Bibliothek (SharePoint-Adresse) oder als Freigabe (alles andere). */
export async function ordnerAufloesen(url: string, token: string, signal?: AbortSignal): Promise<Ort> {
  let u: URL | null = null;
  try { u = new URL(url.trim()); } catch { /* keine vollständige Adresse */ }
  const m = u && /sharepoint\.com$/i.test(u.hostname) ? /^\/(sites|teams)\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(decodeURIComponent(u.pathname)) : null;
  if (u && m) {
    const [, art, site, bibliothek, rest = ""] = m;
    const s = await graphJson<{ id: string }>(`${GRAPH}/sites/${u.hostname}:/${art}/${encodeURIComponent(site)}`, token, signal);
    const drives = await graphJson<{ value: { id: string; name: string; webUrl: string }[] }>(`${GRAPH}/sites/${s.id}/drives?$select=id,name,webUrl`, token, signal);
    const d = drives.value.find((x) => x.name === bibliothek) ?? drives.value.find((x) => decodeURIComponent(x.webUrl).replace(/\/$/, "").toLowerCase().endsWith(`/${bibliothek.toLowerCase()}`));
    if (!d) throw new Error(`Die Bibliothek „${bibliothek}“ gibt es auf dieser SharePoint-Website nicht.`);
    const pfad = rest.replace(/\/$/, "");
    return { basis: pfad ? `${GRAPH}/drives/${d.id}/root:/${enc(pfad)}:` : `${GRAPH}/drives/${d.id}/root` };
  }
  return { basis: `${GRAPH}/shares/${shareId(url)}/driveItem` };
}

/** Graph-Adresse eines Unterpfads: an einen Pfad-Ort („root:/a/b:“) wird angehängt, an ein Element („driveItem“, „root“) mit Doppelpunkt angefügt */
export function unterordner(ort: Ort, unter: string): string {
  if (!unter) return ort.basis;
  return ort.basis.endsWith(":") ? `${ort.basis.slice(0, -1)}/${enc(unter)}:` : `${ort.basis}:/${enc(unter)}:`;
}

/** Alle Dateien unterhalb des Ordners (Pfade relativ zum Ordner, mit /), ohne Archivordner und Sperrdateien; höchstens 400. */
export async function vorlagenAuflisten(ordnerUrl: string, signal?: AbortSignal): Promise<Vorlage[]> {
  const token = await graphToken();
  const ort = await ordnerAufloesen(ordnerUrl, token, signal);
  const out: Vorlage[] = [];
  type Eintrag = { name: string; size?: number; folder?: unknown; file?: { hashes?: { quickXorHash?: string } } };
  type Seite = { value?: Eintrag[]; "@odata.nextLink"?: string };
  const lesen = async (unter: string, tiefe: number): Promise<void> => {
    let url: string | undefined = `${unterordner(ort, unter)}/children?$select=name,size,folder,file&$top=200`;
    while (url && out.length < MAX_DATEIEN) {
      const j: Seite = await graphJson<Seite>(url, token, signal);
      for (const e of j.value ?? []) {
        const pfad = unter ? `${unter}/${e.name}` : e.name;
        if (e.folder) { if (tiefe < 5 && !ARCHIV.test(e.name)) await lesen(pfad, tiefe + 1); }
        else if (!/^~\$|^\./.test(e.name)) out.push({ pfad, groesse: e.size ?? 0, hash: e.file?.hashes?.quickXorHash });
        if (out.length >= MAX_DATEIEN) break;
      }
      url = j["@odata.nextLink"];
    }
  };
  await lesen("", 0);
  // Gleiche Dateinamen in mehreren Ordnern: inhaltsgleich (gleicher Hash) zählt einmal, sonst als „mehrfach, unterschiedlich“ markieren
  const nachName = new Map<string, Vorlage[]>();
  for (const v of out) { const n = v.pfad.split("/").pop()!.toLowerCase(); nachName.set(n, [...(nachName.get(n) ?? []), v]); }
  const liste: Vorlage[] = [];
  for (const gruppe of nachName.values()) {
    if (gruppe.length === 1) { liste.push(gruppe[0]); continue; }
    const hashes = new Set(gruppe.map((v) => v.hash));
    if (!hashes.has(undefined) && hashes.size === 1) liste.push({ ...gruppe.sort((a, b) => a.pfad.localeCompare(b.pfad, "de"))[0], doppelt: `${gruppe.length}× vorhanden, inhaltsgleich` });
    else gruppe.forEach((v) => liste.push({ ...v, doppelt: `${gruppe.length}× vorhanden mit unterschiedlichem Inhalt, nicht kopieren` }));
  }
  return liste.sort((a, b) => a.pfad.localeCompare(b.pfad, "de"));
}

/** Eine Datei aus dem Vorlagenordner herunterladen (unverändert, als Blob). */
export async function vorlageLaden(ordnerUrl: string, pfad: string, signal?: AbortSignal): Promise<Blob> {
  const token = await graphToken();
  const ort = await ordnerAufloesen(ordnerUrl, token, signal);
  const url = `${unterordner(ort, pfad)}/content`;
  // Graph leitet auf eine vorab freigegebene Adresse weiter; fetch folgt ihr
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!r.ok) throw new Error(r.status === 404 ? "nicht gefunden" : `HTTP ${r.status}`);
  return r.blob();
}

/** Text für den Prompt: die Vorlagenliste, die Copilot zum Kopieren nutzen darf. */
export function vorlagenText(liste: Vorlage[], titel: string): string {
  if (!liste.length) return `Vorlagenordner „${titel}“: keine Dateien gefunden.`;
  return `Vorlagen im Ordner „${titel}“ (Pfad relativ zum Ordner; genau so als "quelle" in "kopien" verwenden):\n${liste.map((v) => `- ${v.pfad}${v.doppelt ? ` (${v.doppelt})` : ""}`).join("\n")}`;
}
