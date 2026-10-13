import type { DateiArt } from "./dokument";
/** Dateipakete (Ausgabeformat „dateien“): prüfen, als Baum zeigen, als ZIP packen. */
export type Paket = {
  hinweis: string;
  dateien: { pfad: string; inhalt: string }[];
  /** Leere Ordner, die im ZIP angelegt werden (z. B. die Standardstruktur eines Angebots) */
  ordner: string[];
  /** Unveränderte Kopien aus dem Vorlagenordner: quelle = Pfad im Ordner, ziel = Pfad im ZIP */
  kopien: { quelle: string; ziel: string }[];
  /** Adresse des Vorlagenordners (SharePoint), aus dem die Kopien geladen werden */
  vorlagenUrl?: string;
};

export function cleanPath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").split("/")
    .map((s) => s.trim().replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+$/, "_"))
    .filter(Boolean).join("/").slice(0, 240);
}

export function parsePaket(text: string): Paket | null {
  const t = String(text ?? ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1)) as { hinweis?: unknown; dateien?: unknown; ordner?: unknown; kopien?: unknown };
    const dateien = (Array.isArray(o.dateien) ? o.dateien : [])
      .map((f: { pfad?: unknown; inhalt?: unknown }) => ({ pfad: cleanPath(f?.pfad), inhalt: String(f?.inhalt ?? "") }))
      .filter((f) => f.pfad).slice(0, 200);
    const ordner = [...new Set((Array.isArray(o.ordner) ? o.ordner : []).map(cleanPath).filter(Boolean))].slice(0, 300);
    const kopien = (Array.isArray(o.kopien) ? o.kopien : [])
      .map((k: { quelle?: unknown; ziel?: unknown }) => ({ quelle: cleanPath(k?.quelle), ziel: cleanPath(k?.ziel) }))
      .filter((k) => k.quelle && k.ziel).slice(0, 200);
    return dateien.length || kopien.length ? { hinweis: String(o.hinweis ?? ""), dateien, ordner, kopien } : null;
  } catch {
    return null;
  }
}

type Node = { [k: string]: Node };
export function treeText(paths: string[]): string {
  const root: Node = {};
  const ordner = new Set<Node>();
  for (const p of paths) {
    let n = root;
    for (const seg of p.split("/").filter(Boolean)) n = n[seg] ??= {};
    if (p.endsWith("/")) ordner.add(n);
  }
  const lines: string[] = [];
  const rec = (n: Node, pre: string) => {
    const ks = Object.keys(n);
    ks.forEach((k, i) => {
      const last = i === ks.length - 1, dir = Object.keys(n[k]).length > 0 || ordner.has(n[k]);
      lines.push(pre + (last ? "└── " : "├── ") + k + (dir ? "/" : ""));
      rec(n[k], pre + (last ? "    " : "│   "));
    });
  };
  rec(root, "");
  return lines.join("\n");
}

/** Alle Pfade des Pakets (Dateien, Kopien, leere Ordner mit „/“) für Baum und Namen */
export function paketPfade(p: Paket): string[] {
  return [...p.dateien.map((f) => f.pfad), ...p.kopien.map((k) => k.ziel), ...p.ordner.map((o) => `${o}/`)];
}

/** Paket aus einem gespeicherten Ergebnis wiederherstellen, samt Vorlagenordner des Schritts (für Kopien im ZIP). */
export function parsePaketFuer(step: { quellen: { typ: string; url: string }[] }, text: string): Paket | null {
  const p = parsePaket(text);
  const q = step.quellen.find((x) => x.typ === "sharepoint" && x.url.trim());
  if (p && q) p.vorlagenUrl = q.url.trim();
  return p;
}

export function paketName(appName: string, p: Paket): string {
  const alle = paketPfade(p);
  const tops = new Set(alle.map((f) => f.split("/")[0]));
  const name = tops.size === 1 && alle.every((f) => f.includes("/")) ? [...tops][0] : appName.replace(/[^A-Za-z0-9_-]+/g, "_");
  return `${name || "Paket"}.zip`;
}

/** Packt das Paket. Dateien mit Endung .pdf, .docx, .xlsx oder .pptx werden aus ihrem Markdown-Inhalt als echte Dateien erzeugt. */
export async function zipPaket(p: Paket, appName = "", umwandeln?: DateiArt, onStand?: (text: string) => void): Promise<Blob> {
  const [{ default: JSZip }, dok] = await Promise.all([import("jszip"), import("./dokument")]);
  const z = new JSZip();
  for (const o of p.ordner) z.folder(o);
  // Kopien aus dem Vorlagenordner: unverändert laden; was fehlschlägt, steht in einer Hinweisdatei im ZIP
  if (p.kopien.length) {
    const fehler: string[] = [];
    if (!p.vorlagenUrl) fehler.push(...p.kopien.map((k) => `${k.ziel}: keine Verbindung zum Vorlagenordner (Copilot-Anmeldung nötig).`));
    else {
      const v = await import("./ki/vorlagen");
      let n = 0;
      for (const k of p.kopien) {
        onStand?.(`Vorlage ${++n} von ${p.kopien.length} wird geladen\u00a0…`);
        try { z.file(k.ziel, await v.vorlageLaden(p.vorlagenUrl, k.quelle)); }
        catch (e) { fehler.push(`${k.ziel}: ${k.quelle} konnte nicht geladen werden (${e instanceof Error ? e.message : String(e)})`); }
      }
    }
    if (fehler.length) z.file("FEHLENDE_VORLAGEN.txt", `Diese Vorlagen konnten nicht kopiert werden:\n\n${fehler.join("\n")}\n`);
  }
  for (const f of p.dateien) {
    const endung = f.pfad.split(".").pop()?.toLowerCase() as never;
    const titel = f.pfad.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    if (dok.DATEI_ARTEN.includes(endung)) {
      z.file(f.pfad, await dok.dateiErzeugen(endung, f.inhalt, { titel, app: appName }));
    } else if (umwandeln && /\.(html?|md|markdown|txt)$/i.test(f.pfad)) {
      // Dokumente (HTML, Markdown, Text) in die eingestellte Datei-Art umwandeln
      z.file(f.pfad.replace(/\.[^.]+$/, `.${dok.DATEI_ART[umwandeln].endung}`), await dok.dateiErzeugen(umwandeln, f.inhalt, { titel, app: appName }));
    } else z.file(f.pfad, f.inhalt);
  }
  return z.generateAsync({ type: "blob" });
}
