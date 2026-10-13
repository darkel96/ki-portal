/**
 * Vorlagen aus SharePoint für Dateipakete: Ordner per Microsoft Graph auflisten (nur lesen) und einzelne
 * Dateien herunterladen, damit sie unverändert in ein ZIP wandern. Braucht die Copilot-Anmeldung
 * (Berechtigung Sites.Read.All); ohne sie gibt es keine Liste und keine Kopien.
 */
import { graphToken } from "./auth";
import { kiModus } from "./index";

export type Vorlage = { pfad: string; groesse: number };

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Ordner, die nie als Vorlagenquelle gelten */
const ARCHIV = /^(_?archiv|archive|alt|old|_alt)\b/i;
const MAX_DATEIEN = 400;

/** Freigabe-Kennung einer SharePoint-/OneDrive-Adresse für die Graph-API „shares“ (funktioniert für jede Adresse, die die Person öffnen darf). */
export function shareId(url: string): string {
  const b64 = btoa(unescape(encodeURIComponent(url.trim()))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

export const vorlagenMoeglich = () => kiModus() === "copilot";

async function graphGet(url: string, token: string, signal?: AbortSignal): Promise<Response> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "Kein Lesezugriff auf diesen SharePoint-Ordner." : r.status === 404 ? "Der SharePoint-Ordner wurde nicht gefunden. Adresse prüfen." : `SharePoint antwortet mit HTTP ${r.status}${code ? ` (${code})` : ""}.`);
  }
  return r;
}

/** Alle Dateien unterhalb des Ordners (Pfade relativ zum Ordner, mit /), ohne Archivordner; höchstens 400. */
export async function vorlagenAuflisten(ordnerUrl: string, signal?: AbortSignal): Promise<Vorlage[]> {
  const token = await graphToken();
  const basis = `${GRAPH}/shares/${shareId(ordnerUrl)}/driveItem`;
  const out: Vorlage[] = [];
  const lesen = async (unter: string, tiefe: number) => {
    let url: string | undefined = `${basis}${unter ? `:/${unter.split("/").map(encodeURIComponent).join("/")}:` : ""}/children?$select=name,size,folder,file&$top=200`;
    while (url && out.length < MAX_DATEIEN) {
      const j = (await (await graphGet(url, token, signal)).json()) as { value?: { name: string; size?: number; folder?: unknown; file?: unknown }[]; "@odata.nextLink"?: string };
      for (const e of j.value ?? []) {
        const pfad = unter ? `${unter}/${e.name}` : e.name;
        if (e.folder) { if (tiefe < 4 && !ARCHIV.test(e.name)) await lesen(pfad, tiefe + 1); }
        else if (!/^~\$|^\./.test(e.name)) out.push({ pfad, groesse: e.size ?? 0 });
        if (out.length >= MAX_DATEIEN) break;
      }
      url = j["@odata.nextLink"];
    }
  };
  await lesen("", 0);
  return out.sort((a, b) => a.pfad.localeCompare(b.pfad, "de"));
}

/** Eine Datei aus dem Vorlagenordner herunterladen (unverändert, als Blob). */
export async function vorlageLaden(ordnerUrl: string, pfad: string, signal?: AbortSignal): Promise<Blob> {
  const token = await graphToken();
  const url = `${GRAPH}/shares/${shareId(ordnerUrl)}/driveItem:/${pfad.split("/").map(encodeURIComponent).join("/")}:/content`;
  // Graph leitet auf eine vorab freigegebene Adresse weiter; fetch folgt ihr (ohne den Token, den braucht sie nicht)
  const r = await graphGet(url, token, signal);
  return r.blob();
}

/** Text für den Prompt: die Vorlagenliste, die Copilot zum Kopieren nutzen darf. */
export function vorlagenText(liste: Vorlage[], titel: string): string {
  if (!liste.length) return `Vorlagenordner „${titel}“: keine Dateien gefunden.`;
  return `Vorlagen im Ordner „${titel}“ (Pfad relativ zum Ordner; genau so als "quelle" in "kopien" verwenden):\n${liste.map((v) => `- ${v.pfad}`).join("\n")}`;
}
