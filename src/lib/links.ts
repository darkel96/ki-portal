/**
 * SharePoint-Adressen in Fragen und Quellen: Office-Links (Doc.aspx) erkennen und Dateilinks aus einem Text als
 * Wissensquellen ableiten. Reine Helfer ohne Netz, deshalb auch im Test direkt prüfbar.
 */
import type { Quelle } from "./schema";

/** Datei- und Websitename aus einem Office-Link (…/_layouts/15/Doc.aspx?sourcedoc=…&file=Name.docx, auch /:w:/r/…) */
export function officeLink(url: string): { name: string; site: string } | null {
  try {
    const u = new URL(url.trim());
    if (!/sharepoint\.com$/i.test(u.hostname) || !/\/_layouts\/\d+\/doc\.aspx$/i.test(u.pathname)) return null;
    const name = u.searchParams.get("file")?.trim();
    const m = /\/(sites|teams)\/([^/]+)/i.exec(u.pathname);
    return name && m ? { name, site: `${u.origin}/${m[1]}/${m[2]}` } : null;
  } catch { return null; }
}

/** SharePoint-Links in einer Frage: Der Experte liest diese Dateien direkt, auch ohne Treffer in der Suche */
export function linkQuellen(text: string): Quelle[] {
  const aus: Quelle[] = [];
  for (const m of text.match(/https?:\/\/[^\s<>"„“]+/g) ?? []) {
    const url = m.replace(/[.,;:)!?]+$/, "");
    try {
      const u = new URL(url);
      if (!/sharepoint\.com$/i.test(u.hostname)) continue;
      // Auch Bibliotheksansichten („…/Forms/…aspx?id=/sites/…/Datei.md“): der Dateiname steht dann im Parameter id
      const datei = u.searchParams.get("file") || (u.searchParams.get("id")?.split("/").pop() ?? "") || decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? "");
      const titel = /\.(docx?|xlsx?|pptx?|pdf|txt|md|markdown|csv)$/i.test(datei) ? datei : "";
      if (titel && !aus.some((q) => q.url === url)) aus.push({ typ: "datei", titel, url, tage: 7, filter: "" });
    } catch { /* keine Adresse */ }
  }
  return aus;
}
