/**
 * Ampel für Werte in Applikationen (globale Regel): Was widersprüchlich oder offen ist, soll ins Auge stechen.
 * Gilt für Auswahlwerte (ganzer Wert) und für Markierungen im Text wie „[offen]“.
 *   rot   = widersprüchlich, abweichend, fehlt, nicht erfüllt, kritisch
 *   gelb  = unsicher, unklar, offen, zu klären, teilweise
 *   gruen = sicher, bestätigt, erfüllt, geklärt, in Ordnung
 * Ja/Nein und Prioritäten (hoch/niedrig) bleiben bewusst neutral: Ihre Bedeutung hängt vom Feld ab.
 */
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
export const PRUEF_HINWEIS = 'Prüfseite: Ist ein Wert unsicher, ungenau, unvollständig oder widersprüchlich (insbesondere jedes Status-Feld, das nicht „Sicher“ ist), gib statt des einfachen Werts ein Objekt {"wert": <Wert>, "hinweis": "ein kurzer Satz, höchstens 25 Wörter: was genau nicht passt oder fehlt und worauf die Person achten soll, mit Fundstelle"}. Beispiel: "status_lieferumfang": {"wert": "Widersprüchlich", "hinweis": "Kunde fordert Datenmigration aus dem Altsystem (Spezifikation Abschnitt 4), im Angebot ausgeschlossen."}. Eindeutige Werte bleiben einfache Werte.';
