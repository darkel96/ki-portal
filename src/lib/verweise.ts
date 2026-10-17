/**
 * Nummerierte Quellenverweise aus Copilot-Antworten in lesbare Links umwandeln. Reine Textlogik ohne DOM, damit sie
 * im Browser und im Hub-Dienst läuft.
 */
/** Nummerierter Verweis, wie Copilot Quellen setzt: „[1](Adresse)“ (mit Leerraum davor) */
/** Fertiger Markdown-Link „[Text](Adresse)“, Adresse auch mit paarigen Klammern */
const LINK = /\[[^\]]*\]\((?:[^\s()]|\([^\s()]*\))+\)/g;
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
    // Abschnitte der Zeile: Text bis zum Verweis → [Text](Adresse). Steht in dem Text schon ein Link (Copilot schreibt
    // inzwischen beides: Link und Nummer), bleibt der Link, und nur der Text danach wird mit der Adresse der Nummer verlinkt
    let rest = "", pos = 0;
    for (const v of m[2].matchAll(VERWEIS)) {
      const t = m[2].slice(pos, v.index);
      pos = v.index + v[0].length;
      inQuellen.add(v[2]);
      let ende = 0;
      for (const l of t.matchAll(LINK)) ende = l.index + l[0].length;
      const vor = t.slice(0, ende), nach = t.slice(ende);
      const trenner = /^\s*[;,·|]\s*/.exec(nach)?.[0] ?? "";
      const name = nach.slice(trenner.length).trim().replace(/[.;,:·]+$/, "");
      if (name) rest += `${vor}${trenner}[${name}](${v[2]})`;
      else if (vor) rest += vor;   // Nummer hinter einem fertigen Link: der Link reicht
      else rest += `${rest.trim() ? " · " : ""}[${dokumentName(v[2])}](${v[2]})`;
    }
    rest += m[2].slice(pos);
    return m[1] + rest;
  });
  return erst.map((z) => (quellenZeile.test(z) ? z : z.replace(VERWEIS, (_, __, u: string) => (inQuellen.has(u) ? "" : ` [${dokumentName(u)}](${u})`)))).join("\n");
}

/* ---------- Quellennamen ohne Link ---------- */
export type DokLink = { titel: string; link: string };

/** Dokumente mit Adresse aus dem Auszugstext des Hubs („Dokument: …“ gefolgt von „Link: …“) */
export function dokumentLinks(auszug: string): DokLink[] {
  const out: DokLink[] = [];
  const zeilen = auszug.split("\n");
  for (let i = 0; i + 1 < zeilen.length; i++) {
    const d = /^Dokument:\s*(.+)$/.exec(zeilen[i]), l = /^Link:\s*(\S+)$/.exec(zeilen[i + 1]);
    if (d && l) out.push({ titel: d[1].trim(), link: l[1] });
  }
  return out;
}

/** Vergleichsform eines Dokumentnamens: klein, ohne Endung, Unterstriche und Satzzeichen */
const normName = (s: string) => s.toLowerCase().replace(/\.(docx?|pptx?|xlsx?|pdf|md|txt|csv|aspx)$/i, "").replace(/[_\s]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Schreibt die KI in einer Quellenzeile nur den Namen eines Dokuments („Quelle: Cheat Sheet, Abschnitt 3; Schulung, S. 24“),
 * verlinkt der Hub ihn mit der Adresse aus den gelesenen Auszügen; die ganze Angabe (Name und Stelle) wird Linktext.
 * Nur Abschnitte ohne Link werden angefasst, der längste passende Dokumentname gewinnt.
 */
export function quellenVerlinken(text: string, links: DokLink[]): string {
  const bekannt = links.map((l) => ({ ...l, norm: normName(l.titel) })).filter((l) => l.norm.length >= 6 && /^https?:/.test(l.link)).sort((a, b) => b.norm.length - a.norm.length);
  if (!bekannt.length || !/^\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:/im.test(text)) return text;
  const quellenZeile = /^(\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:\s*)(.*)$/i;
  return text.split("\n").map((z) => {
    const m = quellenZeile.exec(z);
    if (!m) return z;
    // Abschnitte an „;“ oder „·“ trennen; „,“ bleibt, weil es Name und Stelle trennt
    const teile = m[2].split(/(\s*[;·]\s*)/);
    const neu = teile.map((t, i) => {
      if (i % 2 === 1 || !t.trim() || /\]\(/.test(t) || /https?:\/\//.test(t)) return t;
      const name = t.trim().replace(/[.;,:]+$/, "");
      const norm = normName(name);
      const l = bekannt.find((x) => norm.startsWith(x.norm) || norm.includes(" " + x.norm) || norm === x.norm);
      if (!l) return t;
      const vor = /^\s*/.exec(t)?.[0] ?? "", nach = t.slice(vor.length + t.trim().length);
      return `${vor}[${name}](${l.link})${nach}`;
    }).join("");
    return m[1] + neu;
  }).join("\n");
}
