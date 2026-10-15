/**
 * Word-Ergebnis im Design einer hinterlegten Vorlage (.docx/.dotx): Formatvorlagen, Seitenränder,
 * Kopf- und Fußzeilen (mit Logo) bleiben aus der Vorlage, der Inhalt kommt aus dem KI-Ergebnis.
 * Steht in der Vorlage ein Absatz „{{inhalt}}“, kommt das Ergebnis genau dorthin (Deckblatt und Schluss bleiben);
 * sonst ersetzt es den ganzen Text der Vorlage. „{{titel}}“, „{{datum}}“ und „{{app}}“ werden überall ersetzt.
 */
import type { DokBlock, Lauf } from "./dokument";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Formatvorlagen der Vorlage: Anzeigename (klein) → ID */
function stilListe(stylesXml: string | undefined): Map<string, { id: string; typ: string }> {
  const m = new Map<string, { id: string; typ: string }>();
  if (!stylesXml) return m;
  const doc = new DOMParser().parseFromString(stylesXml, "application/xml");
  for (const s of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
    const id = s.getAttributeNS(W, "styleId") ?? s.getAttribute("w:styleId") ?? "";
    const name = s.getElementsByTagNameNS(W, "name")[0]?.getAttributeNS(W, "val") ?? "";
    const typ = s.getAttributeNS(W, "type") ?? s.getAttribute("w:type") ?? "";
    if (id) { m.set(name.toLowerCase(), { id, typ }); m.set(`#${id.toLowerCase()}`, { id, typ }); }
  }
  return m;
}

/** Erste vorhandene Formatvorlage aus Namen (englisch/deutsch) oder IDs */
function finde(stile: Map<string, { id: string; typ: string }>, typ: string, ...namen: string[]): string | null {
  for (const n of namen) {
    const s = stile.get(n) ?? stile.get(`#${n.replace(/\s/g, "")}`);
    if (s && s.typ === typ) return s.id;
  }
  return null;
}

function laufXml(l: Lauf, extra = ""): string {
  const rPr = (l.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : "") + (l.fett ? "<w:b/>" : "") + (l.kursiv ? "<w:i/>" : "") + extra;
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(l.text)}</w:t></w:r>`;
}
const absatzXml = (laeufe: Lauf[], stil: string | null, pPrExtra = "", rExtra = "") =>
  `<w:p>${stil || pPrExtra ? `<w:pPr>${stil ? `<w:pStyle w:val="${esc(stil)}"/>` : ""}${pPrExtra}</w:pPr>` : ""}${laeufe.map((l) => laufXml(l, rExtra)).join("")}</w:p>`;

/** Inhalt als WordprocessingML-Absätze und -Tabellen in den Formatvorlagen der Vorlage */
export function inhaltXml(bl: DokBlock[], stylesXml: string | undefined, titel: string | null): string {
  const st = stilListe(stylesXml);
  const P = "paragraph";
  const titelStil = finde(st, P, "title", "titel");
  const h = [1, 2, 3, 4].map((n) => finde(st, P, `heading ${n}`, `überschrift ${n}`, `heading${n}`));
  const punkt = finde(st, P, "list bullet", "aufzählungszeichen", "listbullet");
  const nummer = finde(st, P, "list number", "listennummer", "listnumber");
  const listenAbsatz = finde(st, P, "list paragraph", "listenabsatz", "listparagraph");
  const tabStil = finde(st, "table", "table grid", "tabellenraster", "tablegrid");
  const out: string[] = [];
  // Ohne passende Formatvorlage: fett und etwas größer statt Überschrift
  const groesse = [0, 32, 28, 24, 22];
  const ueberschrift = (l: Lauf[], e: number) => {
    const stil = e === 0 ? titelStil ?? h[0] : h[Math.min(4, e) - 1];
    out.push(stil ? absatzXml(l, stil) : absatzXml(l, null, '<w:spacing w:before="240" w:after="120"/>', `<w:b/><w:sz w:val="${groesse[Math.max(1, e)] + (e === 0 ? 8 : 0)}"/>`));
  };
  if (titel) ueberschrift([{ text: titel }], 0);
  for (const b of bl) {
    if (b.typ === "ueberschrift") ueberschrift(b.laeufe, b.ebene);
    else if (b.typ === "absatz") out.push(absatzXml(b.laeufe, null));
    else if (b.typ === "liste") {
      b.punkte.forEach((p, k) => {
        const stil = b.nummeriert ? nummer : punkt;
        const einzug = `<w:ind w:left="${360 * (p.tiefe + 1)}" w:hanging="260"/>`;
        if (stil && p.tiefe === 0) out.push(absatzXml(p.laeufe, stil));
        else out.push(absatzXml([{ text: b.nummeriert ? `${k + 1}.\t` : "•\t" }, ...p.laeufe], listenAbsatz, einzug));
      });
    } else if (b.typ === "tabelle") {
      const n = Math.max(1, b.kopf.length);
      const breite = Math.floor(9000 / n);
      const rand = tabStil ? "" : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/></w:tblBorders>';
      const zelle = (c: string, kopf: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/></w:tcPr>${absatzXml(kopf ? [{ text: c, fett: true }] : laeufeAus(c), null)}</w:tc>`;
      out.push(`<w:tbl><w:tblPr>${tabStil ? `<w:tblStyle w:val="${esc(tabStil)}"/>` : ""}<w:tblW w:w="5000" w:type="pct"/>${rand}</w:tblPr>`
        + `<w:tblGrid>${Array.from({ length: n }, () => `<w:gridCol w:w="${breite}"/>`).join("")}</w:tblGrid>`
        + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.kopf.map((c) => zelle(c, true)).join("")}</w:tr>`
        + b.zeilen.map((r) => `<w:tr>${r.map((c) => zelle(c, false)).join("")}</w:tr>`).join("") + "</w:tbl>");
      out.push("<w:p/>");
    } else if (b.typ === "code") b.text.split("\n").forEach((z) => out.push(absatzXml([{ text: z, code: true }], null, '<w:spacing w:after="0"/>')));
    else out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr></w:pPr></w:p>');
  }
  return out.join("");
}

/** **fett** usw. in Tabellenzellen; eigene kleine Kopie, damit vorlage.ts nicht dokument.ts zur Laufzeit braucht */
function laeufeAus(s: string): Lauf[] {
  const out: Lauf[] = [];
  let last = 0;
  for (const m of s.matchAll(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    out.push(m[0].startsWith("`") ? { text: m[0].slice(1, -1), code: true } : { text: m[0].slice(2, -2), fett: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.filter((x) => x.text);
}

/** Text eines Absatzes (über alle Läufe) */
const absatzText = (p: Element) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("");

/** {{titel}}, {{datum}}, {{app}} in allen Absätzen ersetzen; über Läufe verteilte Platzhalter landen im ersten Lauf. */
function platzhalterErsetzen(doc: Document, werte: Record<string, string>): boolean {
  let gefunden = false;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const text = absatzText(p);
    if (!/\{\{\s*(titel|datum|app)\s*\}\}/i.test(text)) continue;
    gefunden = true;
    const neu = text.replace(/\{\{\s*(titel|datum|app)\s*\}\}/gi, (_, k: string) => werte[k.toLowerCase()] ?? "");
    const ts = Array.from(p.getElementsByTagNameNS(W, "t"));
    ts.forEach((t, i) => { t.textContent = i === 0 ? neu : ""; });
    ts[0]?.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  }
  return gefunden;
}

export type VorlageMeta = { titel: string; app: string; datum: string };

/**
 * Baut das Word-Dokument aus der Vorlage (Base64 einer .docx/.dotx) und den Inhaltsblöcken.
 * titelUndRest: Titel (aus # Überschrift oder Schrittname) und übrige Blöcke.
 */
export async function alsDocxMitVorlage(vorlageBase64: string, titel: string, rest: DokBlock[], meta: VorlageMeta): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(vorlageBase64, { base64: true });
  const docPfad = "word/document.xml";
  const xml = await zip.file(docPfad)?.async("string");
  if (!xml) throw new Error("Die Vorlage ist keine Word-Datei.");
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const werte = { titel, datum: meta.datum, app: meta.app };

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body || doc.getElementsByTagName("parsererror").length) throw new Error("Die Vorlage lässt sich nicht lesen.");
  const titelImText = platzhalterErsetzen(doc, werte);
  const fragment = new DOMParser().parseFromString(`<w:body xmlns:w="${W}">${inhaltXml(rest, stylesXml, titelImText ? null : titel)}</w:body>`, "application/xml");
  const neu = Array.from(fragment.documentElement.childNodes).map((n) => doc.importNode(n, true));

  const marke = Array.from(body.getElementsByTagNameNS(W, "p")).find((p) => /^\s*\{\{\s*inhalt\s*\}\}\s*$/i.test(absatzText(p)));
  if (marke) {
    // Der Absatz kann in einer Tabelle oder einem Inhaltssteuerelement stecken: genau dort einsetzen
    neu.forEach((n) => marke.parentNode!.insertBefore(n, marke));
    marke.parentNode!.removeChild(marke);
  } else {
    // Ganzen Text der Vorlage ersetzen; die letzte Abschnittsangabe (Seitenformat, Kopf- und Fußzeilen) bleibt
    const sectPr = Array.from(body.childNodes).filter((n) => n instanceof Element && n.localName === "sectPr").pop();
    Array.from(body.childNodes).forEach((n) => { if (n !== sectPr) body.removeChild(n); });
    neu.forEach((n) => body.insertBefore(n, sectPr ?? null));
  }
  zip.file(docPfad, new XMLSerializer().serializeToString(doc));

  // Platzhalter auch in Kopf- und Fußzeilen
  for (const pfad of Object.keys(zip.files).filter((p) => /^word\/(header|footer)\d*\.xml$/.test(p))) {
    const t = await zip.file(pfad)!.async("string");
    if (!/\{\{/.test(t)) continue;
    const d = new DOMParser().parseFromString(t, "application/xml");
    if (platzhalterErsetzen(d, werte)) zip.file(pfad, new XMLSerializer().serializeToString(d));
  }
  // Eine Dokumentvorlage (.dotx) wird zum normalen Dokument
  const typen = await zip.file("[Content_Types].xml")?.async("string");
  if (typen?.includes("template.main+xml")) zip.file("[Content_Types].xml", typen.replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml"));

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

/** Inhaltsblöcke zurück als Markdown (Aufbau einer Word-Vorlage für die KI) */
export function alsMarkdown(bl: DokBlock[]): string {
  const md = (l: Lauf[]) => l.map((x) => (x.code ? `\`${x.text}\`` : x.fett ? `**${x.text.trim()}**` : x.kursiv ? `*${x.text.trim()}*` : x.text)).join("").trim();
  return bl.map((b) => {
    if (b.typ === "ueberschrift") return `${"#".repeat(b.ebene)} ${md(b.laeufe)}`;
    if (b.typ === "absatz") return md(b.laeufe);
    if (b.typ === "liste") return b.punkte.map((p, i) => `${"  ".repeat(p.tiefe)}${b.nummeriert ? `${i + 1}.` : "-"} ${md(p.laeufe)}`).join("\n");
    if (b.typ === "tabelle") {
      const zeile = (r: string[]) => `| ${r.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`;
      return [zeile(b.kopf), zeile(b.kopf.map(() => "---")), ...b.zeilen.map(zeile)].join("\n");
    }
    if (b.typ === "code") return "```\n" + b.text + "\n```";
    return "---";
  }).filter((t) => t.trim()).join("\n\n");
}
