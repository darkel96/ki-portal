/**
 * Echte Dateien aus einem KI-Ergebnis: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx).
 * Grundlage ist ein kleines Dokumentmodell, das aus Markdown (bzw. ersatzweise aus HTML) gelesen wird.
 * Die Bibliotheken werden erst beim Herunterladen nachgeladen.
 */
import type { Step } from "./schema";

export type DateiArt = Exclude<Step["datei"], "" | "wunsch">;
export const DATEI_ART: Record<DateiArt, { label: string; endung: string; mime: string }> = {
  pdf: { label: "PDF", endung: "pdf", mime: "application/pdf" },
  docx: { label: "Word", endung: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { label: "Excel", endung: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pptx: { label: "PowerPoint", endung: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};
export const DATEI_ARTEN = Object.keys(DATEI_ART) as DateiArt[];

/** Hinweis an die KI, damit sich das Ergebnis gut in die gewünschte Datei übertragen lässt. */
export const DATEI_HINWEIS: Record<DateiArt, string> = {
  pdf: "Das Ergebnis wird automatisch als fertig formatiertes PDF gespeichert. Liefere nur den Inhalt als Markdown (# Titel, ## Abschnitte, Listen, Tabellen), kein HTML und keine Hinweise zum Drucken oder Speichern.",
  docx: "Das Ergebnis wird automatisch als Word-Dokument gespeichert. Liefere nur den Inhalt als Markdown (# Titel, ## Abschnitte, Listen, Tabellen), kein HTML und keine Hinweise zum Speichern.",
  xlsx: "Das Ergebnis wird automatisch als Excel-Datei gespeichert. Liefere die Daten als Markdown-Tabellen; jede Tabelle wird ein eigenes Tabellenblatt, die Überschrift (##) direkt davor wird der Blattname. Zahlen ohne Einheit in der Zelle, die Einheit in die Spaltenüberschrift. Kein HTML.",
  pptx: "Das Ergebnis wird automatisch als PowerPoint-Präsentation gespeichert. Gliedere es in Folien: Jede Folie beginnt mit ## Folientitel, darunter 3 bis 6 kurze Stichpunkte oder eine kleine Tabelle. Beginne mit # Titel der Präsentation. Kein HTML.",
};

/** Erkennt in Aufgabe und Eingaben, ob ausdrücklich eine bestimmte Datei gewünscht ist („als PDF“, „Excel-Datei“ …). */
export function dateiWunsch(text: string): DateiArt | null {
  const t = text.toLowerCase();
  const treffer: [DateiArt, RegExp][] = [
    ["pptx", /\b(powerpoint|pptx|präsentation|foliensatz)\b/],
    ["xlsx", /\b(excel|xlsx|tabellenblatt|tabellenkalkulation)\b/],
    ["docx", /\b(word|docx|word-dokument)\b/],
    ["pdf", /\bpdf\b/],
  ];
  return treffer.find(([, re]) => re.test(t))?.[0] ?? null;
}

/* ---------- Dokumentmodell ---------- */
export type Lauf = { text: string; fett?: boolean; kursiv?: boolean; code?: boolean };
export type DokBlock =
  | { typ: "ueberschrift"; ebene: 1 | 2 | 3 | 4; laeufe: Lauf[] }
  | { typ: "absatz"; laeufe: Lauf[] }
  | { typ: "liste"; nummeriert: boolean; punkte: { laeufe: Lauf[]; tiefe: number }[] }
  | { typ: "tabelle"; kopf: string[]; zeilen: string[][] }
  | { typ: "code"; text: string }
  | { typ: "linie" };

const reinText = (l: Lauf[]) => l.map((x) => x.text).join("");

/** **fett**, *kursiv* / _kursiv_, `code` */
export function laeufe(s: string): Lauf[] {
  const out: Lauf[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**") || t.startsWith("__")) out.push({ text: t.slice(2, -2), fett: true });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1), code: true });
    else out.push({ text: t.slice(1, -1), kursiv: true });
    last = m.index! + t.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.filter((x) => x.text);
}

const zellen = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*(.+?)\*\*/g, "$1"));

export function ausMarkdown(src: string): DokBlock[] {
  const lines = String(src).replace(/\r/g, "").split("\n");
  const out: DokBlock[] = [];
  let i = 0;
  const blockStart = /^(#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$|\s*(---|\*\*\*|___)\s*$|\s*```)/;
  while (i < lines.length) {
    const l = lines[i];
    let m: RegExpMatchArray | null;
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push({ typ: "code", text: code.join("\n") });
      continue;
    }
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { out.push({ typ: "ueberschrift", ebene: m[1].length as 1, laeufe: laeufe(m[2].replace(/#+\s*$/, "").trim()) }); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push({ typ: "linie" }); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map(zellen);
      if (body.length) {
        const n = Math.max(...body.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(n - r.length).fill("")];
        out.push({ typ: "tabelle", kopf: pad(body[0]), zeilen: body.slice(1).map(pad) });
      }
      continue;
    }
    if ((m = l.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) {
      const nummeriert = /\d/.test(m[2]);
      const punkte: { laeufe: Lauf[]; tiefe: number }[] = [];
      while (i < lines.length && (m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) {
        punkte.push({ laeufe: laeufe(m[3]), tiefe: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) });
        i++;
      }
      out.push({ typ: "liste", nummeriert, punkte });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i])) para.push(lines[i++].trim());
    if (para.length) out.push({ typ: "absatz", laeufe: laeufe(para.join(" ")) });
    else i++;
  }
  return out;
}

/** Hat die KI doch HTML geliefert, wird es in das Dokumentmodell übertragen (Skripte usw. fallen weg). */
function ausHtml(html: string): DokBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head, noscript").forEach((n) => n.remove());
  const out: DokBlock[] = [];
  const runsOf = (el: Element): Lauf[] => {
    const r: Lauf[] = [];
    const walk = (n: Node, fett = false, kursiv = false) => {
      if (n.nodeType === 3) { const t = (n.textContent ?? "").replace(/\s+/g, " "); if (t.trim() || r.length) r.push({ text: t, fett, kursiv }); return; }
      if (!(n instanceof Element)) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") { r.push({ text: " " }); return; }
      n.childNodes.forEach((c) => walk(c, fett || tag === "strong" || tag === "b", kursiv || tag === "em" || tag === "i"));
    };
    walk(el);
    return r.filter((x) => x.text);
  };
  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) { out.push({ typ: "ueberschrift", ebene: Math.min(4, Number(tag[1])) as 1, laeufe: runsOf(el) }); return; }
    if (tag === "p" || tag === "blockquote") { const l = runsOf(el); if (reinText(l).trim()) out.push({ typ: "absatz", laeufe: l }); return; }
    if (tag === "ul" || tag === "ol") {
      const punkte: { laeufe: Lauf[]; tiefe: number }[] = [];
      const rec = (list: Element, tiefe: number) => list.querySelectorAll(":scope > li").forEach((li) => {
        const kopie = li.cloneNode(true) as Element;
        kopie.querySelectorAll("ul, ol").forEach((x) => x.remove());
        punkte.push({ laeufe: runsOf(kopie), tiefe });
        li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => rec(sub, Math.min(3, tiefe + 1)));
      });
      rec(el, 0);
      out.push({ typ: "liste", nummeriert: tag === "ol", punkte });
      return;
    }
    if (tag === "table") {
      const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th, td")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()));
      if (rows.length) { const n = Math.max(...rows.map((r) => r.length)); const pad = (r: string[]) => [...r, ...Array(n - r.length).fill("")]; out.push({ typ: "tabelle", kopf: pad(rows[0]), zeilen: rows.slice(1).map(pad) }); }
      return;
    }
    if (tag === "pre") { out.push({ typ: "code", text: el.textContent ?? "" }); return; }
    if (tag === "hr") { out.push({ typ: "linie" }); return; }
    // Container: Kinder besuchen; lose Texte als Absatz
    el.childNodes.forEach((c) => {
      if (c instanceof Element) visit(c);
      else if (c.nodeType === 3 && c.textContent?.trim()) out.push({ typ: "absatz", laeufe: [{ text: c.textContent.trim().replace(/\s+/g, " ") }] });
    });
  };
  if (doc.body) visit(doc.body);
  return out;
}

/** JSON-Ergebnis: Liste von Objekten → Tabelle, sonst als Code. */
function ausJson(text: string): DokBlock[] | null {
  try {
    const v = JSON.parse(text);
    const liste = Array.isArray(v) ? v : Object.values(v ?? {}).find(Array.isArray);
    if (Array.isArray(liste) && liste.length && liste.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      const kopf = [...new Set(liste.flatMap((x) => Object.keys(x)))];
      return [{ typ: "tabelle", kopf, zeilen: liste.map((x) => kopf.map((k) => (typeof x[k] === "object" ? JSON.stringify(x[k]) : String(x[k] ?? "")))) }];
    }
    return [{ typ: "code", text: JSON.stringify(v, null, 2) }];
  } catch { return null; }
}

export function dokumentAus(text: string): DokBlock[] {
  const t = String(text ?? "").trim();
  const html = t.match(/```html\s*([\s\S]*?)```/i)?.[1] ?? (/^<!doctype html|^<html|<body[\s>]/i.test(t) ? t : null);
  if (html) return ausHtml(html);
  if (/^[[{]/.test(t)) { const j = ausJson(t); if (j) return j; }
  return ausMarkdown(t);
}

/* ---------- Gemeinsames ---------- */
export type DokMeta = { titel: string; app: string; akzent?: string };
// Farben aus src/styles/tokens.css (Körber): neutral-darkest, blue, warm-grey-darker, warm-grey, warm-grey-light, warm-grey-lighter
const INK = "#00050D";
const BRAND = "#0060FF";
const GRAU = "#5C5A58";
const LINIE = "#E6E2DC";
const FLAECHE = "#F0EEEA";
const CODE_FLAECHE = "#F5F3F1";
const hex6 = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : BRAND);
const heute = () => new Date().toLocaleDateString("de-DE", { dateStyle: "long" });

/** Titel: erste Überschrift der Ebene 1 (wird dann nicht doppelt gezeigt), sonst der Schrittname. */
function titelUndRest(bl: DokBlock[], fallback: string): [string, DokBlock[]] {
  const i = bl.findIndex((b) => b.typ === "ueberschrift" && b.ebene === 1);
  if (i === 0) return [reinText((bl[0] as { laeufe: Lauf[] }).laeufe), bl.slice(1)];
  return [fallback, bl];
}

export function dateiName(name: string, art: DateiArt): string {
  const n = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Ergebnis";
  return `${n}.${DATEI_ART[art].endung}`;
}

/* ---------- PDF ---------- */
async function alsPdf(bl: DokBlock[], meta: DokMeta): Promise<Blob> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  pdfMake.addVirtualFileSystem(vfs);
  const akzent = hex6(meta.akzent);
  const [titel, rest] = titelUndRest(bl, meta.titel);
  const runs = (l: Lauf[]) => l.map((x) => ({ text: x.text, bold: x.fett || undefined, italics: x.kursiv || undefined, background: x.code ? CODE_FLAECHE : undefined }));
  type C = Record<string, unknown>;
  const content: C[] = [
    { text: meta.app.toUpperCase(), style: "kicker" },
    { text: titel, style: "titel" },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 60, y2: 0, lineWidth: 3, lineColor: akzent }], margin: [0, 6, 0, 18] },
  ];
  for (const b of rest) {
    if (b.typ === "ueberschrift") content.push({ text: runs(b.laeufe), style: `h${Math.max(2, b.ebene)}` });
    else if (b.typ === "absatz") content.push({ text: runs(b.laeufe), style: "p" });
    else if (b.typ === "liste") {
      // Verschachtelte Punkte als eingerückte Einträge
      const items = b.punkte.map((p) => ({ text: runs(p.laeufe), margin: [p.tiefe * 14, 0, 0, 3] }));
      content.push(b.nummeriert ? { ol: items, style: "p" } : { ul: items, style: "p" });
    } else if (b.typ === "tabelle") {
      content.push({
        table: { headerRows: 1, widths: b.kopf.map(() => "*"), body: [b.kopf.map((c) => ({ text: c, style: "th" })), ...b.zeilen.map((r) => r.map((c) => ({ text: laeufe(c).length ? runs(laeufe(c)) : "", style: "td" })))] },
        layout: { hLineWidth: (i: number) => (i <= 1 ? 1 : 0.5), vLineWidth: () => 0, hLineColor: (i: number) => (i <= 1 ? INK : LINIE), paddingTop: () => 5, paddingBottom: () => 5, fillColor: (i: number) => (i === 0 ? FLAECHE : null) },
        margin: [0, 4, 0, 12],
      });
    } else if (b.typ === "code") content.push({ text: b.text, style: "code" });
    else content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.5, lineColor: LINIE }], margin: [0, 8, 0, 12] });
  }
  const def = {
    info: { title: titel, creator: "KI-Hub" },
    pageSize: "A4" as const,
    pageMargins: [56, 64, 56, 64] as [number, number, number, number],
    header: () => ({ columns: [{ text: meta.app, color: GRAU, fontSize: 8 }, { text: heute(), color: GRAU, fontSize: 8, alignment: "right" as const }], margin: [56, 28, 56, 0] }),
    footer: (seite: number, gesamt: number) => ({ text: `Seite ${seite} von ${gesamt}`, alignment: "right" as const, color: GRAU, fontSize: 8, margin: [56, 24, 56, 0] }),
    content,
    defaultStyle: { fontSize: 10.5, lineHeight: 1.35, color: INK },
    styles: {
      kicker: { fontSize: 8, color: GRAU, characterSpacing: 1, margin: [0, 0, 0, 4] },
      titel: { fontSize: 24, bold: true, lineHeight: 1.1 },
      h2: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
      h4: { fontSize: 11, bold: true, color: akzent, margin: [0, 8, 0, 3] },
      p: { margin: [0, 0, 0, 8] },
      th: { bold: true, fontSize: 9.5 },
      td: { fontSize: 9.5 },
      code: { fontSize: 8.5, background: CODE_FLAECHE, margin: [0, 4, 0, 10], preserveLeadingSpaces: true },
    },
  };
  return pdfMake.createPdf(def as never).getBlob();
}

/* ---------- Word ---------- */
async function alsDocx(bl: DokBlock[], meta: DokMeta): Promise<Blob> {
  const d = await import("docx");
  const akzent = hex6(meta.akzent).slice(1);
  const [titel, rest] = titelUndRest(bl, meta.titel);
  const runs = (l: Lauf[], extra: Record<string, unknown> = {}) => l.map((x) => new d.TextRun({ text: x.text, bold: x.fett, italics: x.kursiv, font: x.code ? "Consolas" : undefined, ...extra }));
  const H = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4];
  const kinder: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [
    new d.Paragraph({ children: [new d.TextRun({ text: meta.app.toUpperCase(), size: 16, color: GRAU.slice(1) })] }),
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun({ text: titel })], border: { bottom: { style: d.BorderStyle.SINGLE, size: 18, color: akzent, space: 6 } }, spacing: { after: 240 } }),
  ];
  let listeNr = 0;
  for (const b of rest) {
    if (b.typ === "ueberschrift") kinder.push(new d.Paragraph({ heading: H[b.ebene], children: runs(b.laeufe) }));
    else if (b.typ === "absatz") kinder.push(new d.Paragraph({ children: runs(b.laeufe), spacing: { after: 120 } }));
    else if (b.typ === "liste") {
      const inst = listeNr++;
      for (const p of b.punkte) kinder.push(new d.Paragraph(b.nummeriert
        ? { children: runs(p.laeufe), numbering: { reference: "nummern", level: p.tiefe, instance: inst } }
        : { children: runs(p.laeufe), bullet: { level: p.tiefe } }));
    } else if (b.typ === "tabelle") {
      const zeile = (r: string[], kopf: boolean) => new d.TableRow({
        tableHeader: kopf,
        children: r.map((c) => new d.TableCell({
          children: [new d.Paragraph({ children: kopf ? [new d.TextRun({ text: c, bold: true })] : runs(laeufe(c)) })],
          shading: kopf ? { type: d.ShadingType.CLEAR, color: "auto", fill: FLAECHE.slice(1) } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        })),
      });
      kinder.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: [zeile(b.kopf, true), ...b.zeilen.map((r) => zeile(r, false))] }));
      kinder.push(new d.Paragraph({ children: [] }));
    } else if (b.typ === "code") for (const z of b.text.split("\n")) kinder.push(new d.Paragraph({ children: [new d.TextRun({ text: z, font: "Consolas", size: 18 })], shading: { type: d.ShadingType.CLEAR, color: "auto", fill: CODE_FLAECHE.slice(1) } }));
    else kinder.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 4, color: LINIE.slice(1), space: 4 } } }));
  }
  const doc = new d.Document({
    creator: "KI-Hub", title: titel,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: INK.slice(1) } } },
      paragraphStyles: [{ id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", run: { bold: true, color: akzent } }],
    },
    numbering: { config: [{ reference: "nummern", levels: [0, 1, 2, 3].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) }] },
    sections: [{
      headers: { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: `${meta.app} · ${heute()}`, size: 16, color: GRAU.slice(1) })] })] }) },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ children: ["Seite ", d.PageNumber.CURRENT, " von ", d.PageNumber.TOTAL_PAGES], size: 16, color: GRAU.slice(1) })] })] }) },
      children: kinder,
    }],
  });
  return d.Packer.toBlob(doc);
}

/* ---------- Excel ---------- */
const zahl = (s: string): number | null => {
  const t = s.trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return null;
};

async function alsXlsx(bl: DokBlock[], meta: DokMeta): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const kopfStil = { fontWeight: "bold" as const, backgroundColor: FLAECHE, bottomBorderStyle: "thin" as const, bottomBorderColor: INK, wrap: true };
  const namen = new Set<string>();
  const blattName = (s: string) => {
    let n = s.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Tabelle";
    for (let k = 2; namen.has(n); k++) n = `${n.slice(0, 28)} ${k}`;
    namen.add(n);
    return n;
  };
  const blaetter: { data: unknown[][]; sheet: string; columns: { width: number }[]; stickyRowsCount?: number }[] = [];
  let letzteUeberschrift = "";
  for (const b of bl) {
    if (b.typ === "ueberschrift") letzteUeberschrift = reinText(b.laeufe);
    if (b.typ !== "tabelle") continue;
    const data = [
      b.kopf.map((c) => ({ value: c, ...kopfStil })),
      ...b.zeilen.map((r) => r.map((c) => { const z = zahl(c); return z !== null ? { value: z, type: Number } : { value: c, wrap: true }; })),
    ];
    const columns = b.kopf.map((_, i) => ({ width: Math.min(60, Math.max(10, ...[b.kopf[i], ...b.zeilen.map((r) => r[i] ?? "")].map((s) => s.length + 2))) }));
    blaetter.push({ data, sheet: blattName(letzteUeberschrift || `Tabelle ${blaetter.length + 1}`), columns, stickyRowsCount: 1 });
  }
  // Ohne Tabellen: der ganze Text zeilenweise auf einem Blatt
  if (!blaetter.length) {
    const data: unknown[][] = [[{ value: meta.titel, fontWeight: "bold", fontSize: 14 }], []];
    for (const b of bl) {
      if (b.typ === "ueberschrift") data.push([{ value: reinText(b.laeufe), fontWeight: "bold" }]);
      else if (b.typ === "absatz") data.push([{ value: reinText(b.laeufe), wrap: true }]);
      else if (b.typ === "liste") b.punkte.forEach((p, i) => data.push([{ value: `${b.nummeriert ? `${i + 1}.` : "•"} ${reinText(p.laeufe)}`, wrap: true, indent: p.tiefe }]));
      else if (b.typ === "code") b.text.split("\n").forEach((z) => data.push([{ value: z, fontFamily: "Consolas" }]));
    }
    blaetter.push({ data, sheet: blattName("Ergebnis"), columns: [{ width: 100 }] });
  }
  return writeExcelFile(blaetter as never).toBlob();
}

/* ---------- PowerPoint ---------- */
async function alsPptx(bl: DokBlock[], meta: DokMeta): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = meta.titel;
  const akzent = hex6(meta.akzent).slice(1);
  const ink = INK.slice(1);
  const font = "Calibri";
  const [titel, rest] = titelUndRest(bl, meta.titel);

  const start = pres.addSlide();
  start.background = { color: "FBFAF9" /* warm-grey-lightest */ };
  start.addShape("rect", { x: 0.6, y: 3.05, w: 1.2, h: 0.08, fill: { color: akzent }, line: { color: akzent } });
  start.addText(titel, { x: 0.6, y: 1.6, w: 12, h: 1.4, fontFace: font, fontSize: 40, bold: true, color: ink, valign: "bottom" });
  start.addText(`${meta.app} · ${heute()}`, { x: 0.6, y: 3.3, w: 12, h: 0.5, fontFace: font, fontSize: 16, color: GRAU.slice(1) });

  type Folie = { titel: string; teile: DokBlock[] };
  const folien: Folie[] = [];
  for (const b of rest) {
    if (b.typ === "ueberschrift" && b.ebene <= 2) { folien.push({ titel: reinText(b.laeufe), teile: [] }); continue; }
    if (!folien.length) folien.push({ titel, teile: [] });
    folien[folien.length - 1].teile.push(b);
  }
  const MAX_PUNKTE = 8;
  let nr = 1;
  const neueFolie = (t: string) => {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(t, { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: font, fontSize: 28, bold: true, color: ink, valign: "middle" });
    s.addShape("rect", { x: 0.6, y: 1.25, w: 0.8, h: 0.06, fill: { color: akzent }, line: { color: akzent } });
    s.addText(String(++nr), { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontFace: font, fontSize: 10, color: GRAU.slice(1), align: "right" });
    return s;
  };
  for (const f of folien) {
    type Punkt = { text: { text: string; options: Record<string, unknown> }[]; tiefe: number; aufzaehlung: boolean };
    let punkte: Punkt[] = [];
    let s = neueFolie(f.titel);
    let y = 1.55;
    const textRaus = () => {
      if (!punkte.length) return;
      // Kein Platz mehr unter einer Tabelle: Fortsetzungsfolie
      if (y > 6.2) { s = neueFolie(`${f.titel} (Fortsetzung)`); y = 1.55; }
      // Je Punkt ein Absatz: alle Läufe tragen dieselben Absatz-Optionen, der letzte beendet die Zeile.
      const arr = punkte.flatMap((p, i) => p.text.map((r, j) => ({
        text: r.text,
        options: { ...r.options, bullet: p.aufzaehlung ? { indent: 18 } : false, indentLevel: p.tiefe, breakLine: j === p.text.length - 1 && i < punkte.length - 1 },
      })));
      const h = Math.min(7.0 - y, 0.45 * punkte.length + 0.3);
      s.addText(arr as never, { x: 0.6, y, w: 12.1, h, fontFace: font, fontSize: 18, color: ink, valign: "top", paraSpaceAfter: 6 });
      y += h + 0.1;
      punkte = [];
    };
    const runs = (l: Lauf[]) => l.map((x) => ({ text: x.text, options: { bold: x.fett, italic: x.kursiv } }));
    for (const b of f.teile) {
      if (b.typ === "tabelle") {
        textRaus();
        const zeilenProFolie = 10;
        for (let k = 0; k < Math.max(1, b.zeilen.length); k += zeilenProFolie) {
          if (k > 0 || y > 5.5) { s = neueFolie(`${f.titel} (Fortsetzung)`); y = 1.55; }
          const rows = [b.kopf.map((c) => ({ text: c, options: { bold: true, fill: { color: FLAECHE.slice(1) } } })), ...b.zeilen.slice(k, k + zeilenProFolie).map((r) => r.map((c) => ({ text: c })))];
          s.addTable(rows as never, { x: 0.6, y, w: 12.1, rowH: 0.42, fontFace: font, fontSize: 12, color: ink, border: { type: "solid", pt: 0.5, color: LINIE.slice(1) }, autoPage: false });
          y += 0.42 * rows.length + 0.25;
        }
        continue;
      }
      if (b.typ === "liste") b.punkte.forEach((p) => punkte.push({ text: runs(p.laeufe), tiefe: p.tiefe, aufzaehlung: true }));
      else if (b.typ === "absatz") punkte.push({ text: runs(b.laeufe), tiefe: 0, aufzaehlung: false });
      else if (b.typ === "ueberschrift") punkte.push({ text: [{ text: reinText(b.laeufe), options: { bold: true, color: akzent } }], tiefe: 0, aufzaehlung: false });
      else if (b.typ === "code") punkte.push({ text: [{ text: b.text, options: { fontFace: "Consolas", fontSize: 12 } }], tiefe: 0, aufzaehlung: false });
      if (punkte.length >= MAX_PUNKTE) { textRaus(); s = neueFolie(`${f.titel} (Fortsetzung)`); y = 1.55; }
    }
    textRaus();
  }
  return (await pres.write({ outputType: "blob" })) as Blob;
}

/** Erzeugt die Datei. */
export async function dateiErzeugen(art: DateiArt, text: string, meta: DokMeta): Promise<Blob> {
  const bl = dokumentAus(text);
  if (art === "pdf") return alsPdf(bl, meta);
  if (art === "docx") return alsDocx(bl, meta);
  if (art === "xlsx") return alsXlsx(bl, meta);
  return alsPptx(bl, meta);
}
