/**
 * Prüfseiten: Eingabefelder werden aus dem JSON-Ergebnis eines KI-Schritts vorbelegt („aus“ am Feld),
 * die Person prüft und korrigiert, spätere Schritte arbeiten mit den korrigierten Werten.
 */
import type { App, Block } from "./schema";
import { fieldsOf, type FieldBlock } from "./model";
import { jsonAus } from "./ki";

/** Wert unter einem Punkt-Pfad („produkte.wartung.status“); undefined, wenn es ihn nicht gibt. Schlüssel ohne Beachtung der Schreibweise. */
export function wertUnter(obj: unknown, pfad: string): unknown {
  let cur = obj;
  for (const teil of pfad.split(".").map((t) => t.trim()).filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) { cur = cur[Number(teil)]; continue; }
    const o = cur as Record<string, unknown>;
    const k = Object.keys(o).find((x) => x === teil) ?? Object.keys(o).find((x) => x.toLowerCase() === teil.toLowerCase());
    cur = k === undefined ? undefined : o[k];
  }
  return cur;
}

/** JSON-Wert als Text für ein Eingabefeld: Listen als Zeilen, Objekte als „Schlüssel: Wert“-Zeilen. */
export function alsText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x !== null ? alsText(x) : String(x ?? ""))).filter(Boolean).join("\n");
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${alsText(x).replace(/\n/g, " / ")}`).join("\n");
}

/** Wert passend zum Feldtyp: Auswahl auf eine vorhandene Option abbilden, Ankreuzfeld auf ja/nein. */
export function feldWert(b: FieldBlock, v: unknown): string | boolean | undefined {
  if (v === undefined) return undefined;
  if (b.type === "checkbox") return typeof v === "boolean" ? v : /^(ja|yes|true|1|x)$/i.test(alsText(v));
  const text = alsText(v);
  if (b.type === "select" || b.type === "radio") {
    const t = text.toLowerCase();
    const opt = b.props.optionen.find((o) => o.toLowerCase() === t) ?? b.props.optionen.find((o) => t && (o.toLowerCase().startsWith(t) || t.startsWith(o.toLowerCase())));
    return opt ?? "";
  }
  if (b.type === "date") { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text) ?? /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text); return m ? (m[0].includes("-") ? m[0].slice(0, 10) : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`) : text; }
  if (b.type === "number") { const m = /-?\d+([.,]\d+)?/.exec(text); return m ? m[0].replace(",", ".") : ""; }
  return text;
}

/** Felder, die sich aus dem Ergebnis des Schritts mit diesem key vorbelegen, mit ihren Werten. Liefert null, wenn das Ergebnis kein JSON ist. */
export function vorbelegungen(app: Pick<App, "blocks">, stepKey: string, text: string): Record<string, string | boolean> | null {
  const k = stepKey.toLowerCase();
  const felder = fieldsOf(app).filter((b) => b.type !== "file" && b.props.aus.trim().split(".")[0].toLowerCase() === k);
  if (!felder.length) return null;
  let json: unknown;
  try { json = jsonAus(text); } catch { return null; }
  const out: Record<string, string | boolean> = {};
  for (const b of felder) {
    const pfad = b.props.aus.trim().split(".").slice(1).join(".");
    const w = feldWert(b, pfad ? wertUnter(json, pfad) : json);
    if (w !== undefined) out[b.props.key] = w;
  }
  return out;
}

/** Hat die App Felder, die aus einem KI-Ergebnis vorbelegt werden (Prüfseite)? */
export const hatVorbelegung = (app: Pick<App, "blocks">) => fieldsOf(app).some((b) => b.props.aus.trim());

/** Ergebnis-Element: nur ein Teil des JSON. Liefert Text (Markdown), eine Liste oder ein Objekt zur Anzeige. */
export function teilAus(text: string, pfad: string): unknown {
  try { return wertUnter(jsonAus(text), pfad); } catch { return undefined; }
}

export type { Block };
