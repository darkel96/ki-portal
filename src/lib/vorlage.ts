/**
 * Word-Ergebnis im Design einer hinterlegten Vorlage (.docx/.dotx).
 *
 * Seitenformat, Ränder, Kopf- und Fußzeilen (mit Logo), Formatvorlagen, Design-Farben und Nummerierungen bleiben
 * aus der Vorlage. Für den Inhalt nimmt der Hub echte Beispielabsätze aus der Vorlage als Muster und klont deren
 * Formatierung: Fließtext, jede Überschriftenebene, Titel, Aufzählung, Nummerierung, Tabelle (Kopfzeile und
 * Datenzeilen, auch abwechselnd gefärbte). So passt das Ergebnis auch bei eigenen Stilnamen und bei Text, der in
 * der Vorlage von Hand formatiert ist. Was die Vorlage nicht zeigt, kommt aus ihren Formatvorlagen (Überschrift 1,
 * Aufzählungszeichen, Tabellenraster …), zuletzt aus einfachen Vorgaben.
 *
 * Steht in der Vorlage ein Absatz „{{inhalt}}“, kommt das Ergebnis genau dorthin (Deckblatt und Schluss bleiben);
 * sonst ersetzt es den ganzen Text der Vorlage. „{{titel}}“, „{{datum}}“ und „{{app}}“ werden überall ersetzt.
 */
import type { DokBlock, Lauf } from "./dokument";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/* ---------- DOM-Hilfen ---------- */
const kinder = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.namespaceURI === W && c.localName === name) : []);
const kind = (el: Element | null | undefined, name: string) => kinder(el, name)[0] ?? null;
const wert = (el: Element | null | undefined) => (el ? el.getAttributeNS(W, "val") ?? el.getAttribute("w:val") : null);
const an = (el: Element | null | undefined) => !!el && !["0", "false", "off"].includes(wert(el) ?? "");
const vorfahr = (el: Element, name: string, bis: Element) => { for (let n = el.parentElement; n && n !== bis; n = n.parentElement) if (n.namespaceURI === W && n.localName === name) return n; return null; };

// Reihenfolge der Kindelemente laut Schema: Word lehnt Dateien mit falscher Reihenfolge teils ab
const ORDNUNG: Record<string, string[]> = {
  pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
  rPr: ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
  tcPr: ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
  trPr: ["cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter", "cantSplit", "trHeight", "tblHeader", "tblCellSpacing", "jc", "hidden"],
  numPr: ["ilvl", "numId"],
};

/** Kindelement anlegen oder holen, an der Stelle, die das Schema verlangt */
function setze(eltern: Element, name: string, attrs: Record<string, string> = {}): Element {
  let el = kind(eltern, name);
  if (!el) {
    el = eltern.ownerDocument.createElementNS(W, `w:${name}`);
    const ord = ORDNUNG[eltern.localName] ?? [];
    const i = ord.indexOf(name);
    const nach = Array.from(eltern.children).find((c) => ord.indexOf(c.localName) > i);
    eltern.insertBefore(el, i >= 0 ? nach ?? null : null);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(W, `w:${k}`, v);
  return el;
}
const entferne = (el: Element | null, ...namen: string[]) => { if (el) for (const n of namen) kinder(el, n).forEach((c) => el.removeChild(c)); };
const klon = (el: Element | null) => (el ? (el.cloneNode(true) as Element) : null);

/* ---------- Formatvorlagen ---------- */
type Stil = { id: string; name: string; typ: string; basis: string | null; el: Element; standard: boolean };
type Stile = { byId: Map<string, Stil>; byName: Map<string, Stil>; standardAbsatz: string | null };

function stileLesen(xml: string | undefined): Stile {
  const byId = new Map<string, Stil>(), byName = new Map<string, Stil>();
  let standardAbsatz: string | null = null;
  if (xml) {
    const d = new DOMParser().parseFromString(xml, "application/xml");
    for (const el of Array.from(d.getElementsByTagNameNS(W, "style"))) {
      const id = el.getAttributeNS(W, "styleId") ?? el.getAttribute("w:styleId") ?? "";
      if (!id) continue;
      const s: Stil = { id, name: (wert(kind(el, "name")) ?? id).toLowerCase(), typ: el.getAttributeNS(W, "type") ?? el.getAttribute("w:type") ?? "", basis: wert(kind(el, "basedOn")), el, standard: (el.getAttributeNS(W, "default") ?? el.getAttribute("w:default")) === "1" };
      byId.set(id, s);
      if (!byName.has(s.name)) byName.set(s.name, s);
      if (s.typ === "paragraph" && s.standard) standardAbsatz = id;
    }
  }
  return { byId, byName, standardAbsatz };
}
/** Eigenschaft über die Vererbungskette (basedOn) einer Formatvorlage */
function geerbt<T>(st: Stile, id: string | null, f: (s: Stil) => T | null): T | null {
  for (let n = 0, s = id ? st.byId.get(id) : undefined; s && n < 12; n++, s = s.basis ? st.byId.get(s.basis) : undefined) {
    const v = f(s);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}
/** Erste vorhandene Formatvorlage aus Namen (englisch/deutsch) */
const stilNamens = (st: Stile, typ: string, ...namen: string[]) => namen.map((n) => st.byName.get(n)).find((s) => s?.typ === typ)?.id ?? null;
const UEBERSCHRIFT_NAME = /^(heading|überschrift)\s*([1-9])$/;

/* ---------- Muster aus der Vorlage ---------- */
type Absatzmuster = { pPr: Element | null; rPr: Element | null; nummeriert?: boolean };
type Zellmuster = { tcPr: Element | null; pPr: Element | null; rPr: Element | null; trPr: Element | null };
type Tabellenmuster = { tblPr: Element; breite: number; kopf: Zellmuster | null; daten: Zellmuster[] };
type Muster = {
  text: Absatzmuster | null; titel: Absatzmuster | null; h: (Absatzmuster | null)[];
  punkt: Absatzmuster | null; nummer: Absatzmuster | null; tabelle: Tabellenmuster | null;
};

const ersterLaufRPr = (p: Element): Element | null => {
  for (const r of Array.from(p.getElementsByTagNameNS(W, "r"))) {
    if (Array.from(r.getElementsByTagNameNS(W, "t")).some((t) => (t.textContent ?? "").trim())) return klon(kind(r, "rPr"));
  }
  return null;
};
/** Absatz-Muster: Absatzformat ohne Abschnittswechsel und Änderungsverfolgung, Zeichenformat des ersten Textlaufs */
function absatzmuster(p: Element): Absatzmuster {
  const pPr = klon(kind(p, "pPr"));
  entferne(pPr, "sectPr", "pPrChange");
  const rPr = ersterLaufRPr(p);
  entferne(rPr, "rPrChange", "vanish", "webHidden");
  return { pPr, rPr };
}

/** Zahlenformat einer Nummerierung (bullet, decimal …) aus numbering.xml */
function numFormat(num: Document | null, numId: string, ilvl: string): string | null {
  if (!num) return null;
  const n = Array.from(num.getElementsByTagNameNS(W, "num")).find((x) => (x.getAttributeNS(W, "numId") ?? x.getAttribute("w:numId")) === numId);
  const abs = wert(kind(n, "abstractNumId"));
  const a = Array.from(num.getElementsByTagNameNS(W, "abstractNum")).find((x) => (x.getAttributeNS(W, "abstractNumId") ?? x.getAttribute("w:abstractNumId")) === abs);
  const lvl = kinder(a, "lvl").find((l) => (l.getAttributeNS(W, "ilvl") ?? l.getAttribute("w:ilvl")) === ilvl) ?? kinder(a, "lvl")[0];
  return wert(kind(lvl, "numFmt"));
}

const istPlatzhalter = (t: string) => /\{\{\s*\w+\s*\}\}/.test(t);

export function musterLesen(body: Element, st: Stile, num: Document | null): Muster {
  const m: Muster = { text: null, titel: null, h: [null, null, null, null], punkt: null, nummer: null, tabelle: null };
  type Info = { p: Element; text: string; stil: string; ebene: number | null; liste: string | null; groesse: number; fett: boolean };
  const infos: Info[] = [];
  let titelAbsatz: Element | null = null;
  const zahl = (s: string | null) => (s && /^\d+$/.test(s) ? Number(s) : null);
  for (const p of Array.from(body.getElementsByTagNameNS(W, "p"))) {
    if (vorfahr(p, "tbl", body) || vorfahr(p, "txbxContent", body)) continue;
    const text = absatzText(p).trim();
    if (!text || istPlatzhalter(text)) continue;
    const pPr = kind(p, "pPr");
    const stil = wert(kind(pPr, "pStyle")) ?? st.standardAbsatz ?? "";
    const stilName = st.byId.get(stil)?.name ?? "";
    let ebene = zahl(wert(kind(pPr, "outlineLvl"))) ?? geerbt(st, stil, (s) => zahl(wert(kind(kind(s.el, "pPr"), "outlineLvl"))));
    const nameEbene = stilName.match(UEBERSCHRIFT_NAME);
    if (ebene === null && nameEbene) ebene = Number(nameEbene[2]) - 1;
    if (ebene !== null && ebene > 8) ebene = null;
    const numPr = kind(pPr, "numPr") ?? geerbt(st, stil, (s) => kind(kind(s.el, "pPr"), "numPr"));
    const numId = wert(kind(numPr, "numId"));
    const liste = numId && numId !== "0" ? numFormat(num, numId, wert(kind(numPr, "ilvl")) ?? "0") ?? "decimal" : null;
    const rPr = ersterLaufRPr(p);
    const groesse = zahl(wert(kind(rPr, "sz"))) ?? geerbt(st, stil, (s) => zahl(wert(kind(kind(s.el, "rPr"), "sz")))) ?? 22;
    const fett = kind(rPr, "b") ? an(kind(rPr, "b")) : !!geerbt(st, stil, (s) => (kind(kind(s.el, "rPr"), "b") ? an(kind(kind(s.el, "rPr"), "b")) : null));
    infos.push({ p, text, stil, ebene, liste, groesse, fett });
    if (/^(title|titel)$/.test(stilName) && !m.titel) { m.titel = absatzmuster(p); titelAbsatz = p; }
  }
  // Überschriften: Gliederungsebene (aus Absatz oder Formatvorlage) oder Name „Überschrift n“
  for (const i of infos) if (i.ebene !== null && i.ebene < 4 && !m.h[i.ebene] && !/^(title|titel)$/.test(st.byId.get(i.stil)?.name ?? "")) {
    m.h[i.ebene] = { ...absatzmuster(i.p), nummeriert: !!i.liste };
  }
  // Listen (ohne Überschriften, die nummeriert sind)
  for (const i of infos) if (i.liste && i.ebene === null) {
    if (i.liste === "bullet" || i.liste === "none") m.punkt ??= absatzmuster(i.p);
    else m.nummer ??= absatzmuster(i.p);
  }
  // Fließtext: das häufigste Format längerer normaler Absätze
  const normal = infos.filter((i) => i.ebene === null && !i.liste && i.p !== titelAbsatz);
  const lang = normal.filter((i) => i.text.length >= 40);
  const zaehl = new Map<string, { n: number; i: Info }>();
  for (const i of lang.length ? lang : normal) {
    const k = `${i.stil}|${i.groesse}|${i.fett}`;
    const e = zaehl.get(k);
    if (e) e.n++; else zaehl.set(k, { n: 1, i });
  }
  const haeufig = [...zaehl.values()].sort((a, b) => b.n - a.n)[0]?.i;
  if (haeufig) m.text = absatzmuster(haeufig.p);
  // Ohne Titel-Formatvorlage: die größte kurze Zeile vor dem ersten Kapitel ist der Titel
  if (!m.titel && haeufig) {
    const erstesKapitel = infos.findIndex((i) => i.ebene !== null);
    const davor = infos.slice(0, erstesKapitel < 0 ? 5 : erstesKapitel).filter((i) => !i.liste && i.text.length <= 120 && i.groesse > haeufig.groesse);
    const groesste = davor.sort((a, b) => b.groesse - a.groesse)[0];
    if (groesste) { m.titel = absatzmuster(groesste.p); titelAbsatz = groesste.p; }
  }
  // Ohne Gliederung in der Vorlage: kurze, größere oder fette Zeilen gelten als Überschriften (nach Größe gestuft)
  if (!m.h.some(Boolean) && haeufig) {
    const kandidaten = normal.filter((i) => i.p !== titelAbsatz && i.text.length <= 90 && !/[.,;]$/.test(i.text) && (i.groesse > haeufig.groesse || (i.fett && !haeufig.fett && i.groesse >= haeufig.groesse)));
    const stufen = [...new Set(kandidaten.map((i) => i.groesse * 2 + (i.fett ? 1 : 0)))].sort((a, b) => b - a).slice(0, 4);
    for (const i of kandidaten) { const e = stufen.indexOf(i.groesse * 2 + (i.fett ? 1 : 0)); if (e >= 0 && !m.h[e]) m.h[e] = absatzmuster(i.p); }
  }
  // Tabelle: die erste Tabelle mit mindestens zwei Zeilen
  const tbl = Array.from(body.getElementsByTagNameNS(W, "tbl")).find((t) => !vorfahr(t, "tbl", body) && kinder(t, "tr").length >= 2);
  if (tbl) {
    const zeilen = kinder(tbl, "tr");
    const zelle = (tr: Element): Zellmuster | null => {
      const tc = kind(tr, "tc");
      if (!tc) return null;
      const p = kinder(tc, "p").find((x) => absatzText(x).trim()) ?? kind(tc, "p");
      const tcPr = klon(kind(tc, "tcPr"));
      entferne(tcPr, "gridSpan", "hMerge", "vMerge", "tcPrChange");
      const trPr = klon(kind(tr, "trPr"));
      entferne(trPr, "gridBefore", "gridAfter", "wBefore", "wAfter", "trPrChange");
      return { tcPr, trPr, ...(p ? absatzmuster(p) : { pPr: null, rPr: null }) };
    };
    const tblPr = klon(kind(tbl, "tblPr")) ?? body.ownerDocument.createElementNS(W, "w:tblPr");
    entferne(tblPr, "tblpPr", "tblOverlap", "tblCaption", "tblDescription", "tblPrChange");
    const breite = kinder(kind(tbl, "tblGrid"), "gridCol").reduce((s, g) => s + (Number(g.getAttributeNS(W, "w") ?? g.getAttribute("w:w")) || 0), 0) || 9000;
    // Datenzeilen: bis zu zwei als Wechsel (gebänderte Tabellen); eine Summenzeile am Ende zählt nicht
    const daten = zeilen.slice(1, Math.min(zeilen.length - (zeilen.length > 3 ? 1 : 0), 3)).map(zelle).filter((z): z is Zellmuster => !!z);
    m.tabelle = { tblPr, breite, kopf: zelle(zeilen[0]), daten: daten.length ? daten : [zelle(zeilen[1])!] };
  }
  return m;
}

/* ---------- Inhalt bauen ---------- */
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

/** Baut die Absätze und Tabellen des Ergebnisses im Dokument der Vorlage */
export function inhaltBauen(doc: Document, bl: DokBlock[], titel: string | null, m: Muster, st: Stile, num: Document | null): Node[] {
  const el = (name: string) => doc.createElementNS(W, `w:${name}`);
  const out: Node[] = [];
  const fallbackStil = {
    titel: stilNamens(st, "paragraph", "title", "titel"),
    h: [1, 2, 3, 4].map((n) => stilNamens(st, "paragraph", `heading ${n}`, `überschrift ${n}`)),
    punkt: stilNamens(st, "paragraph", "list bullet", "aufzählungszeichen"),
    nummer: stilNamens(st, "paragraph", "list number", "listennummer"),
    tabelle: stilNamens(st, "table", "table grid", "tabellenraster"),
  };

  const lauf = (l: Lauf, rPrMuster: Element | null) => {
    const r = el("r");
    const rPr = klon(rPrMuster) ?? el("rPr");
    if (l.fett) setze(rPr, "b");
    if (l.kursiv) setze(rPr, "i");
    if (l.code) setze(rPr, "rFonts", { ascii: "Consolas", hAnsi: "Consolas", cs: "Consolas" });
    if (rPr.children.length) r.appendChild(rPr);
    const t = el("t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = l.text;
    r.appendChild(t);
    return r;
  };
  const absatz = (laeufe: Lauf[], mu: Absatzmuster | null, stil: string | null = null, anpassen?: (pPr: Element) => void) => {
    const p = el("p");
    const pPr = klon(mu?.pPr ?? null) ?? el("pPr");
    if (!mu?.pPr && stil) setze(pPr, "pStyle", { val: stil });
    anpassen?.(pPr);
    if (pPr.children.length) p.appendChild(pPr);
    laeufe.forEach((l) => p.appendChild(lauf(l, mu?.rPr ?? null)));
    return p;
  };
  /** Nummerierung der Vorlage, aber für jede Liste neu bei 1 */
  const neueNummer = (pPr: Element): string | null => {
    const numId = wert(kind(kind(pPr, "numPr"), "numId"));
    if (!num || !numId) return null;
    const root = num.documentElement;
    const n = Array.from(num.getElementsByTagNameNS(W, "num")).find((x) => (x.getAttributeNS(W, "numId") ?? x.getAttribute("w:numId")) === numId);
    const abs = wert(kind(n, "abstractNumId"));
    if (abs === null) return null;
    const ids = Array.from(num.getElementsByTagNameNS(W, "num")).map((x) => Number(x.getAttributeNS(W, "numId") ?? x.getAttribute("w:numId")) || 0);
    const neu = num.createElementNS(W, "w:num");
    const id = String(Math.max(0, ...ids) + 1);
    neu.setAttributeNS(W, "w:numId", id);
    const a = num.createElementNS(W, "w:abstractNumId"); a.setAttributeNS(W, "w:val", abs); neu.appendChild(a);
    const o = num.createElementNS(W, "w:lvlOverride"); o.setAttributeNS(W, "w:ilvl", "0");
    const s = num.createElementNS(W, "w:startOverride"); s.setAttributeNS(W, "w:val", "1"); o.appendChild(s); neu.appendChild(o);
    root.insertBefore(neu, kind(root, "numIdMacAtCleanup"));
    setze(kind(pPr, "numPr")!, "numId", { val: id });
    return id;
  };
  // Text der Überschrift ohne „1.2“, wenn die Vorlage Überschriften selbst nummeriert
  const ohneNummer = (l: Lauf[], mu: Absatzmuster | null) => (mu?.nummeriert && l[0] ? [{ ...l[0], text: l[0].text.replace(/^\s*\d+(\.\d+)*\.?\s+/, "") }, ...l.slice(1)] : l);
  const groesse = [0, 32, 28, 24, 22];
  const ueberschrift = (l: Lauf[], e: number) => {
    const mu = e === 0 ? m.titel ?? m.h[0] : m.h[Math.min(4, e) - 1] ?? m.h.slice(0, Math.min(4, e) - 1).reverse().find(Boolean) ?? null;
    const stil = e === 0 ? fallbackStil.titel ?? fallbackStil.h[0] : fallbackStil.h[Math.min(4, e) - 1];
    if (mu || stil) { out.push(absatz(ohneNummer(l, mu), mu, stil)); return; }
    out.push(absatz(l.map((x) => ({ ...x, fett: true })), m.text, null, (pPr) => setze(pPr, "spacing", { before: "240", after: "120" })));
    const r = (out[out.length - 1] as Element).getElementsByTagNameNS(W, "rPr");
    Array.from(r).forEach((rPr) => setze(rPr, "sz", { val: String(groesse[Math.max(1, e)] + (e === 0 ? 8 : 0)) }));
  };

  // Die oberste Überschriftenebene im Ergebnis (meist ##, weil # der Titel ist) ist die erste Kapitelebene der Vorlage
  const ebenen = bl.flatMap((b) => (b.typ === "ueberschrift" ? [b.ebene] : []));
  const versatz = ebenen.length ? Math.min(...ebenen) - 1 : 0;
  if (titel) ueberschrift([{ text: titel }], 0);
  let bilder = 0;
  for (const b of bl) {
    if (b.typ === "ueberschrift") ueberschrift(b.laeufe, b.ebene - versatz);
    else if (b.typ === "absatz") out.push(absatz(b.laeufe, m.text));
    else if (b.typ === "liste") {
      const mu = b.nummeriert ? m.nummer : m.punkt;
      const stil = b.nummeriert ? fallbackStil.nummer : fallbackStil.punkt;
      let listenId: string | null | undefined;
      b.punkte.forEach((pt, k) => {
        if (mu?.pPr && kind(mu.pPr, "numPr")) {
          out.push(absatz(pt.laeufe, mu, null, (pPr) => {
            const numPr = kind(pPr, "numPr")!;
            setze(numPr, "ilvl", { val: String(pt.tiefe) });
            if (!b.nummeriert) return;
            if (listenId === undefined) listenId = neueNummer(pPr);
            else if (listenId) setze(numPr, "numId", { val: listenId });
          }));
        } else if (stil && pt.tiefe === 0) out.push(absatz(pt.laeufe, null, stil));
        else out.push(absatz([{ text: b.nummeriert ? `${k + 1}.\t` : "•\t" }, ...pt.laeufe], m.text, null,
          (pPr) => setze(pPr, "ind", { left: String(360 * (pt.tiefe + 1)), hanging: "260" })));
      });
    } else if (b.typ === "tabelle") {
      // Nach einer Tabelle steht in Word immer ein Absatz (auch am Ende einer Zelle oder des Dokuments)
      out.push(tabelle(b.kopf, b.zeilen), absatz([], m.text));
    }
    else if (b.typ === "code") b.text.split("\n").forEach((z) => out.push(absatz([{ text: z, code: true }], m.text, null, (pPr) => setze(pPr, "spacing", { before: "0", after: "0" }))));
    else if (b.typ === "bild") out.push(bildAbsatz(doc, b, ++bilder));
    else out.push(absatz([], null, null, (pPr) => { const bdr = setze(pPr, "pBdr"); const u = doc.createElementNS(W, "w:bottom"); for (const [k, v] of Object.entries({ val: "single", sz: "4", space: "4", color: "auto" })) u.setAttributeNS(W, `w:${k}`, v); bdr.appendChild(u); }));
  }
  return out;

  function tabelle(kopf: string[], zeilen: string[][]): Node {
    const t = m.tabelle;
    const n = Math.max(1, kopf.length);
    const breite = Math.floor((t?.breite ?? 9000) / n);
    const tbl = el("tbl");
    const tblPr = klon(t?.tblPr ?? null) ?? el("tblPr");
    if (!t) {
      if (fallbackStil.tabelle) tblPr.appendChild(el("tblStyle")).setAttributeNS(W, "w:val", fallbackStil.tabelle);
      const w = el("tblW"); w.setAttributeNS(W, "w:w", "5000"); w.setAttributeNS(W, "w:type", "pct"); tblPr.appendChild(w);
      if (!fallbackStil.tabelle) {
        const r = el("tblBorders");
        for (const s of ["top", "bottom", "insideH"]) { const x = el(s); for (const [k, v] of Object.entries({ val: "single", sz: "4", color: "auto" })) x.setAttributeNS(W, `w:${k}`, v); r.appendChild(x); }
        tblPr.appendChild(r);
      }
    }
    tbl.appendChild(tblPr);
    const grid = el("tblGrid");
    for (let i = 0; i < n; i++) { const g = el("gridCol"); g.setAttributeNS(W, "w:w", String(breite)); grid.appendChild(g); }
    tbl.appendChild(grid);
    const zeile = (zellen: string[], mu: Zellmuster | null, istKopf: boolean) => {
      const tr = el("tr");
      const trPr = klon(mu?.trPr ?? null) ?? el("trPr");
      if (istKopf) setze(trPr, "tblHeader"); else entferne(trPr, "tblHeader");
      if (trPr.children.length) tr.appendChild(trPr);
      for (const c of zellen) {
        const tc = el("tc");
        const tcPr = klon(mu?.tcPr ?? null) ?? el("tcPr");
        setze(tcPr, "tcW", { w: String(breite), type: "dxa" });
        tc.appendChild(tcPr);
        const laeufe = istKopf && !mu ? [{ text: c, fett: true }] : laeufeAus(c);
        tc.appendChild(absatz(laeufe, mu ? { pPr: mu.pPr, rPr: mu.rPr } : null));
        tr.appendChild(tc);
      }
      return tr;
    };
    tbl.appendChild(zeile(kopf, t?.kopf ?? null, true));
    zeilen.forEach((r, i) => tbl.appendChild(zeile(r, t ? t.daten[i % t.daten.length] : null, false)));
    return tbl;
  }
}

/* ---------- Platzhalter ---------- */
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
    ts[0]?.setAttributeNS(XML_NS, "xml:space", "preserve");
  }
  return gefunden;
}

export type VorlageMeta = { titel: string; app: string; datum: string };

/**
 * Baut das Word-Dokument aus der Vorlage (Base64 einer .docx/.dotx) und den Inhaltsblöcken.
 * titel: aus # Überschrift oder Schrittname; rest: übrige Blöcke.
 */
/* ---------- Diagramme als Bild ---------- */
const BILD_REL = (n: number) => `rIdKiHubDia${n}`;
const BILD_PFAD = (n: number) => `media/kihub_diagramm${n}.png`;
/** Absatz mit eingebettetem Bild (DrawingML, zentriert, höchstens 16 cm breit) */
function bildAbsatz(doc: Document, b: { breite: number; hoehe: number; alt: string }, n: number): Node {
  const f = Math.min(1, 600 / b.breite, 800 / b.hoehe);
  const cx = Math.round(b.breite * f * 9525), cy = Math.round(b.hoehe * f * 9525);
  const alt = b.alt.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const xml = `<w:p xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${9000 + n}" name="Diagramm ${n}" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${9000 + n}" name="kihub_diagramm${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${BILD_REL(n)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  return doc.importNode(new DOMParser().parseFromString(xml, "application/xml").documentElement, true);
}
/** Bilddateien, Beziehungen und Inhaltstyp für die Diagramme in die Word-Datei schreiben */
async function bilderEinfuegen(zip: import("jszip"), bl: DokBlock[]) {
  const bilder = bl.filter((b): b is Extract<DokBlock, { typ: "bild" }> => b.typ === "bild");
  if (!bilder.length) return;
  const relPfad = "word/_rels/document.xml.rels";
  let rels = (await zip.file(relPfad)?.async("string")) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  bilder.forEach((b, i) => {
    zip.file(`word/${BILD_PFAD(i + 1)}`, b.png);
    rels = rels.replace("</Relationships>", `<Relationship Id="${BILD_REL(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${BILD_PFAD(i + 1)}"/></Relationships>`);
  });
  zip.file(relPfad, rels);
  const typen = await zip.file("[Content_Types].xml")?.async("string");
  if (typen && !/Extension="png"/i.test(typen)) zip.file("[Content_Types].xml", typen.replace("<Types ", "<Types ").replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'));
}

export async function alsDocxMitVorlage(vorlageBase64: string, titel: string, rest: DokBlock[], meta: VorlageMeta): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(vorlageBase64, { base64: true });
  const docPfad = "word/document.xml";
  const xml = await zip.file(docPfad)?.async("string");
  if (!xml) throw new Error("Die Vorlage ist keine Word-Datei.");
  const st = stileLesen(await zip.file("word/styles.xml")?.async("string"));
  const numXml = await zip.file("word/numbering.xml")?.async("string");
  const num = numXml ? new DOMParser().parseFromString(numXml, "application/xml") : null;
  const werte = { titel, datum: meta.datum, app: meta.app };

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body || doc.getElementsByTagName("parsererror").length) throw new Error("Die Vorlage lässt sich nicht lesen.");
  // Muster vor jeder Änderung lesen: Die Beispielabsätze verschwinden gleich
  const muster = musterLesen(body, st, num);
  const titelImText = platzhalterErsetzen(doc, werte);
  const neu = inhaltBauen(doc, rest, titelImText ? null : titel, muster, st, num);

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
  await bilderEinfuegen(zip, rest);
  if (num && numXml) zip.file("word/numbering.xml", new XMLSerializer().serializeToString(num));

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
    if (b.typ === "bild") return `[Diagramm: ${b.alt}]`;
    return "---";
  }).filter((t) => t.trim()).join("\n\n");
}
