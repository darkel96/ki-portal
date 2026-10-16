/**
 * Ampel für Werte in Applikationen (globale Regel): Was widersprüchlich oder offen ist, soll ins Auge stechen.
 * Gilt für Auswahlwerte (ganzer Wert) und für Markierungen im Text wie „[offen]“.
 *   rot   = widersprüchlich, abweichend, fehlt, nicht erfüllt, kritisch
 *   gelb  = unsicher, unklar, offen, zu klären, teilweise
 *   gruen = sicher, bestätigt, erfüllt, geklärt, in Ordnung
 * Ja/Nein und Prioritäten (hoch/niedrig) bleiben bewusst neutral: Ihre Bedeutung hängt vom Feld ab.
 */
import type { App } from "./schema";
import { fieldsOf } from "./model";

export type Ampel = "rot" | "gelb" | "gruen";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ROT = /^(widersprüchlich|widerspruch|abweichend|weicht ab|abweichung|fehlt|fehlend|nicht erfüllt|nicht vorhanden|nicht enthalten|kritisch|abgelehnt|falsch|fehlerhaft|konflikt|nicht ok|n\.?\s?i\.?\s?o\.?)\b/;
const GELB = /^(unsicher|unklar|offen|zu klären|klären|klärung|ungeklärt|prüfen|zu prüfen|in prüfung|teilweise|unvollständig|fraglich|nicht eindeutig|rückfrage|vorbehalt|annahme)\b/;
const GRUEN = /^(sicher|bestätigt|erfüllt|vollständig|eindeutig|geklärt|ok|i\.?\s?o\.?|in ordnung|übereinstimmend|stimmt überein|passt|freigegeben)\b/;

/** Ampel eines Auswahlwerts (Auswahlliste, Auswahlknöpfe) */
export function ampelWert(wert: unknown): Ampel | null {
  if (typeof wert !== "string" || !wert.trim()) return null;
  const v = norm(wert);
  if (ROT.test(v)) return "rot";
  if (GELB.test(v)) return "gelb";
  if (GRUEN.test(v)) return "gruen";
  return null;
}

/** Ampel eines freien Texts: nur ausdrückliche Markierungen, damit normaler Text nicht bunt wird */
export function ampelText(wert: unknown): Ampel | null {
  if (typeof wert !== "string" || !wert.trim()) return null;
  const v = wert.toLowerCase();
  if (/\[(fehlt|widerspruch|widersprüchlich)\]|widersprüchlich|widerspricht/.test(v)) return "rot";
  if (/\[(offen|unklar|prüfen|zu klären|klären|tbd)\]|zu klären|ungeklärt/.test(v)) return "gelb";
  return null;
}

export const AMPEL_LABEL: Record<Ampel, string> = { rot: "Widerspruch oder fehlt", gelb: "Offen oder unsicher", gruen: "Geklärt" };

/** Kurzes Stichwort vor der Erklärung unter einem markierten Feld */
export const AMPEL_KURZ: Record<Ampel, string> = { rot: "Widerspruch: ", gelb: "Prüfen: ", gruen: "" };
/** Standardhinweis, wenn die KI keine Erklärung mitgeliefert hat */
export const AMPEL_STANDARD: Record<"rot" | "gelb", string> = {
  rot: "Die Angaben passen nicht zusammen. Bitte mit den Unterlagen abgleichen und den richtigen Wert festlegen.",
  gelb: "Nicht eindeutig belegt. Bitte in den Unterlagen nachsehen und bestätigen oder korrigieren.",
};
export const AMPEL_STANDARD_TEXT: Record<"rot" | "gelb", string> = {
  rot: "Im Text ist ein Widerspruch vermerkt. Bitte klären, welche Angabe gilt.",
  gelb: "Im Text ist etwas als offen markiert. Bitte ergänzen oder bestätigen.",
};
/** Anweisung an die KI für Lese-Schritte von Prüfseiten: zu jedem unsicheren oder widersprüchlichen Wert ein Satz, warum */
export const PRUEF_HINWEIS = 'Prüfseite: Ist ein Wert unsicher, ungenau, unvollständig oder widersprüchlich, begründe das in einem kurzen Satz (höchstens 25 Wörter): was genau nicht passt oder fehlt, mit Fundstelle. Die Begründung steht in einem zusätzlichen Schlüssel auf derselben Ebene mit der Endung "_hinweis", z. B. "status_lieferumfang": "Widersprüchlich", "status_lieferumfang_hinweis": "Kunde fordert Datenmigration (Spezifikation 4.2), Angebot schließt sie aus." Eindeutige Werte brauchen keinen Hinweis. Ein Status wie Sicher/Unsicher/Widersprüchlich bewertet die Beleglage, nicht den Zustand: „Sicher“, wenn die Angabe eindeutig und ohne Widerspruch in den Unterlagen steht, auch wenn der Befund schlecht ist (abgekündigt, verschlissen, fehlerhaft); „Unsicher“ nur, wenn etwas fehlt, ungenau, nicht geprüft oder nur indirekt belegt ist; „Widersprüchlich“, wenn Angaben einander widersprechen.';

/* ---------- Paare aus Inhaltsfeld und Status-Feld ---------- */
type FeldLike = { type: string; props: { key: string; label: string; optionen?: string[] } };
const istText = (b: FeldLike) => b.type === "textarea" || b.type === "input";
/** Status-Feld: Auswahl, die „Status“ heißt oder Optionen mit Ampel-Bedeutung hat (z. B. Sicher/Unsicher/Widersprüchlich) */
export function istStatusFeld(b: FeldLike): boolean {
  if (b.type !== "select" && b.type !== "radio") return false;
  if (/^status\b|\bstatus$/i.test(b.props.label.trim()) || /^status_|_status$/i.test(b.props.key)) return true;
  const o = b.props.optionen ?? [];
  return o.some((x) => ampelWert(x) === "rot" || ampelWert(x) === "gelb") && o.some((x) => ampelWert(x) === "gruen");
}
const wortstamm = (s: string) => s.toLowerCase().replace(/^status\s+/, "").replace(/\s+status$/, "").replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
/** Passt der Name eines Status-Felds zu einem Inhaltsfeld? („Status Lagerplätze“ ↔ „Lagerplätze und Kapazitäten“) */
const passt = (status: string, inhalt: string) => {
  const a = wortstamm(status), b = wortstamm(inhalt);
  return a.length > 0 && a.some((w) => b.some((x) => x.startsWith(w.slice(0, 6)) || w.startsWith(x.slice(0, 6))));
};

export type Paare = { zuStatus: Map<string, string>; zuInhalt: Map<string, string> };
const cache = new WeakMap<object, Paare>();
/**
 * Ordnet jedem Status-Feld sein Inhaltsfeld zu: das passend benannte unter den drei Textfeldern davor, sonst das
 * unmittelbar davor stehende Textfeld. So färbt sich auch „Lagerplätze und Kapazitäten“ nach „Status Lagerplätze“.
 */
export function ampelPaare(app: Pick<App, "blocks">): Paare {
  const c = cache.get(app.blocks);
  if (c) return c;
  const felder = fieldsOf(app) as unknown as FeldLike[];
  const p: Paare = { zuStatus: new Map(), zuInhalt: new Map() };
  felder.forEach((b, i) => {
    if (!istStatusFeld(b)) return;
    const davor = felder.slice(Math.max(0, i - 3), i).reverse().filter((x) => istText(x) && !p.zuStatus.has(x.props.key));
    const ziel = davor.find((x) => passt(b.props.label, x.props.label)) ?? (davor[0] === felder[i - 1] ? davor[0] : undefined);
    if (ziel) { p.zuStatus.set(ziel.props.key, b.props.key); p.zuInhalt.set(b.props.key, ziel.props.key); }
  });
  cache.set(app.blocks, p);
  return p;
}
