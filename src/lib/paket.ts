import type { DateiArt } from "./dokument";
/** Dateipakete (Ausgabeformat „dateien“): prüfen, als Baum zeigen, als ZIP packen. */
export type Paket = { hinweis: string; dateien: { pfad: string; inhalt: string }[] };

export function cleanPath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").split("/")
    .map((s) => s.trim().replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+$/, "_"))
    .filter(Boolean).join("/").slice(0, 240);
}

export function parsePaket(text: string): Paket | null {
  const t = String(text ?? ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1)) as { hinweis?: unknown; dateien?: unknown };
    const dateien = (Array.isArray(o.dateien) ? o.dateien : [])
      .map((f: { pfad?: unknown; inhalt?: unknown }) => ({ pfad: cleanPath(f?.pfad), inhalt: String(f?.inhalt ?? "") }))
      .filter((f) => f.pfad).slice(0, 200);
    return dateien.length ? { hinweis: String(o.hinweis ?? ""), dateien } : null;
  } catch {
    return null;
  }
}

type Node = { [k: string]: Node };
export function treeText(paths: string[]): string {
  const root: Node = {};
  for (const p of paths) { let n = root; for (const seg of p.split("/")) n = n[seg] ??= {}; }
  const lines: string[] = [];
  const rec = (n: Node, pre: string) => {
    const ks = Object.keys(n);
    ks.forEach((k, i) => {
      const last = i === ks.length - 1, dir = Object.keys(n[k]).length > 0;
      lines.push(pre + (last ? "└── " : "├── ") + k + (dir ? "/" : ""));
      rec(n[k], pre + (last ? "    " : "│   "));
    });
  };
  rec(root, "");
  return lines.join("\n");
}

export function paketName(appName: string, p: Paket): string {
  const tops = new Set(p.dateien.map((f) => f.pfad.split("/")[0]));
  const name = tops.size === 1 && p.dateien.every((f) => f.pfad.includes("/")) ? [...tops][0] : appName.replace(/[^A-Za-z0-9_-]+/g, "_");
  return `${name || "Paket"}.zip`;
}

/** Packt das Paket. Dateien mit Endung .pdf, .docx, .xlsx oder .pptx werden aus ihrem Markdown-Inhalt als echte Dateien erzeugt. */
export async function zipPaket(p: Paket, appName = "", umwandeln?: DateiArt): Promise<Blob> {
  const [{ default: JSZip }, dok] = await Promise.all([import("jszip"), import("./dokument")]);
  const z = new JSZip();
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
