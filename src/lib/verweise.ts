/**
 * Nummerierte Quellenverweise aus Copilot-Antworten in lesbare Links umwandeln. Reine Textlogik ohne DOM, damit sie
 * im Browser und im Hub-Dienst läuft.
 */
/** Nummerierter Verweis, wie Copilot Quellen setzt: „[1](Adresse)“ (mit Leerraum davor) */
const VERWEIS = /\s*\[(\d{1,3})\]\(((?:https?:\/\/)(?:[^\s()]|\([^\s()]*\))+)\)/g;
/** Name eines Dokuments aus seiner Adresse: der Dateiname (bei Office-Links der Parameter „file“), sonst der letzte Pfadteil */
export function dokumentName(url: string): string {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    let name = u.searchParams.get("file") || "";
    if (!name) { const letzter = u.pathname.split("/").filter(Boolean).at(-1) ?? ""; try { name = decodeURIComponent(letzter); } catch { name = letzter; } }
    name = name.replace(/\.aspx$/i, "").replace(/_/g, " ").trim();
    return name || u.hostname;
  } catch { return url; }
}
/**
 * Copilot setzt Quellen als nummerierte Verweise „… Text [1](Adresse)“, in der Anzeige bleibt davon nur eine kleine „1“.
 * Der Hub macht daraus lesbare Links: In einer Quellenzeile („Quelle: Dokument, Abschnitt [1](…)“) wird die Angabe davor
 * zum Linktext. Verweise im Fließtext, deren Adresse in einer Quellenzeile steht, fallen weg (die Quellenzeile trägt den
 * Link); die übrigen bekommen den Dokumentnamen aus der Adresse als Linktext. Wirkt auf den Text selbst, also auch in
 * Word, PDF und beim Kopieren.
 */
export function verweiseAufloesen(text: string): string {
  if (!/\[\d{1,3}\]\(https?:/.test(text)) return text;
  const inQuellen = new Set<string>();
  const zeilen = text.split("\n");
  const quellenZeile = /^(\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:\s*)(.*)$/i;
  const erst = zeilen.map((z) => {
    const m = quellenZeile.exec(z);
    if (!m) return z;
    // Abschnitte der Zeile: Text bis zum Verweis → [Text](Adresse); steht davor schon ein Link, fällt nur der Verweis weg
    let rest = "", pos = 0;
    for (const v of m[2].matchAll(VERWEIS)) {
      const t = m[2].slice(pos, v.index);
      pos = v.index + v[0].length;
      inQuellen.add(v[2]);
      if (/\]\([^()]*\)\s*$/.test(t)) { rest += t; continue; }
      const trenner = /^\s*[;,]\s*/.exec(t)?.[0] ?? "";
      const name = t.slice(trenner.length).trim().replace(/[.;,:]+$/, "");
      rest += `${trenner}[${name || dokumentName(v[2])}](${v[2]})`;
    }
    rest += m[2].slice(pos);
    return m[1] + rest;
  });
  return erst.map((z) => (quellenZeile.test(z) ? z : z.replace(VERWEIS, (_, __, u: string) => (inQuellen.has(u) ? "" : ` [${dokumentName(u)}](${u})`)))).join("\n");
}
