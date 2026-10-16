/**
 * Prüfseiten: Eingabefelder werden aus dem JSON-Ergebnis eines KI-Schritts vorbelegt („aus“ am Feld),
 * die Person prüft und korrigiert, spätere Schritte arbeiten mit den korrigierten Werten.
 */
import type { App, Block } from "./schema";
import { fieldsOf, type FieldBlock } from "./model";
import { jsonAus } from "./ki";
import { istStatusFeld } from "./ampel";

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

/** Vorbelegung eines Feldes: Wert plus optionaler Hinweis der KI und Markierung „zu klären“ */
export type Vorbelegung = { wert: string | boolean; hinweis?: string; klaeren?: boolean };

/**
 * Felder, die sich aus dem Ergebnis des Schritts mit diesem key vorbelegen, mit ihren Werten. Liefert null, wenn das
 * Ergebnis kein JSON ist. Der Wert im JSON darf ein Objekt {"wert", "hinweis", "klaeren"} sein: dann steht der
 * Hinweis unter dem Feld und „klaeren“ hebt es hervor (z. B. ein nicht eindeutig angekreuztes Kästchen).
 */
export function vorbelegungen(app: Pick<App, "blocks">, stepKey: string, text: string): Record<string, Vorbelegung> | null {
  const k = stepKey.toLowerCase();
  const felder = fieldsOf(app).filter((b) => b.type !== "file" && b.props.aus.trim().split(".")[0].toLowerCase() === k);
  if (!felder.length) return null;
  let json: unknown;
  try { json = jsonAus(text); } catch { return null; }
  const out: Record<string, Vorbelegung> = {};
  for (const b of felder) {
    const pfad = b.props.aus.trim().split(".").slice(1).join(".");
    let roh = pfad ? wertUnter(json, pfad) : json;
    let hinweis: string | undefined, klaeren: boolean | undefined;
    if (roh && typeof roh === "object" && !Array.isArray(roh) && "wert" in (roh as object)) {
      const o = roh as { wert?: unknown; hinweis?: unknown; klaeren?: unknown };
      hinweis = typeof o.hinweis === "string" && o.hinweis.trim() ? o.hinweis.trim().slice(0, 500) : undefined;
      klaeren = o.klaeren === true || /^(ja|true|1)$/i.test(String(o.klaeren ?? ""));
      roh = o.wert;
    }
    // Begründung auch als eigener Schlüssel daneben („status_x_hinweis“, „status_xHinweis“, „status_x_begruendung“),
    // als Sammlung („hinweise“: {"status_x": …}) oder im selben Unterobjekt, wenn dort nur dieses Status-Feld steht
    if (!hinweis && pfad) hinweis = begruendungZu(json, pfad, istStatusFeld(b) && felder.filter((f) => istStatusFeld(f) && elternVon(f.props.aus) === elternVon(b.props.aus)).length === 1);
    const w = feldWert(b, roh);
    // „Unsicher – Gassensicherung nicht geprüft“: Option übernehmen, der Rest ist die Begründung
    if (!hinweis && typeof w === "string" && w && (b.type === "select" || b.type === "radio")) {
      const rest = alsText(roh).slice(w.length).replace(/^[\s:;,.–—(-]+/, "").replace(/\)$/, "").trim();
      if (alsText(roh).toLowerCase().startsWith(w.toLowerCase()) && rest.length >= 12) hinweis = rest.slice(0, 500);
    }
    if (w === undefined && !hinweis) continue;
    // Auswahl ohne passende Option (z. B. „Unklar“ bei Ja/Nein) gilt als zu klären
    if ((b.type === "select" || b.type === "radio") && w === "" && roh !== undefined && roh !== "") klaeren = true;
    out[b.props.key] = { wert: w ?? "", hinweis, klaeren };
  }
  return out;
}

const elternVon = (aus: string) => aus.trim().split(".").slice(1, -1).join(".");
const HINWEIS_NAMEN = ["hinweis", "begruendung", "begründung", "grund", "erlaeuterung", "erläuterung", "kommentar"];
/** Begründung zu einem Status-Wert, wo immer die KI sie abgelegt hat */
function begruendungZu(json: unknown, pfad: string, alleinImObjekt: boolean): string | undefined {
  const teile = pfad.split("."), letzt = teile[teile.length - 1], eltern = teile.slice(0, -1).join(".");
  const im = (x: string) => (eltern ? `${eltern}.${x}` : x);
  const kandidaten = [
    ...HINWEIS_NAMEN.flatMap((n) => [`${pfad}_${n}`, `${pfad}${n[0].toUpperCase()}${n.slice(1)}`, im(`${n}_${letzt}`)]),
    ...["hinweise", "begruendungen", "begründungen"].flatMap((m) => [`${m}.${pfad}`, `${m}.${letzt}`]),
    ...(alleinImObjekt && eltern ? HINWEIS_NAMEN.map((n) => `${eltern}.${n}`).concat(HINWEIS_NAMEN.map((n) => `${eltern}.status_${n}`)) : []),
  ];
  for (const k of kandidaten) {
    const v = wertUnter(json, k);
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 500);
  }
  return undefined;
}

/** Hat die App Felder, die aus einem KI-Ergebnis vorbelegt werden (Prüfseite)? */
export const hatVorbelegung = (app: Pick<App, "blocks">) => fieldsOf(app).some((b) => b.props.aus.trim());

/** Ergebnis-Element: nur ein Teil des JSON. Liefert Text (Markdown), eine Liste oder ein Objekt zur Anzeige. */
export function teilAus(text: string, pfad: string): unknown {
  try { return wertUnter(jsonAus(text), pfad); } catch { return undefined; }
}

export type { Block };
