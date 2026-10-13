/**
 * Word-Dateien (.docx) als Text lesen, so dass Formulare erhalten bleiben: Kästchen werden zu ☒ (angekreuzt)
 * und ☐ (leer), Tabellen zu Zeilen mit „|“. Das braucht z. B. die Service-Checkliste, deren Ja/Nein-Kästchen
 * in einfachen Textauszügen verloren gehen.
 * Erkannt werden: Inhaltssteuerelemente (w14:checkbox), ältere Formularfelder (w:checkBox) und
 * Wingdings-Symbole (w:sym), auch als Zeichen in Wingdings-Schrift.
 */
export async function docxAlsText(daten: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(daten);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("Die Word-Datei enthält kein Dokument.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("Die Word-Datei ist leer.");
  return bloecke(body).join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
/** Wingdings-Zeichen für Kästchen (angekreuzt / leer) */
const KREUZ = new Set(["FE", "FD", "54", "52", "F8"]);
const LEER = new Set(["A8", "6F", "A1", "AA", "A4", "AB", "A2", "A3", "A5"]);

function lokal(n: Element) { return n.localName; }

/** Absätze und Tabellen eines Containers als Zeilen */
function bloecke(el: Element): string[] {
  const out: string[] = [];
  for (const n of Array.from(el.children)) {
    const t = lokal(n);
    if (t === "p") out.push(absatz(n));
    else if (t === "tbl") out.push(...tabelle(n), "");
    else if (t === "sdt") { const c = n.getElementsByTagNameNS(W, "sdtContent")[0]; if (c) out.push(...bloecke(c)); }
    else if (t === "sectPr") continue;
    else out.push(...bloecke(n));
  }
  return out;
}

function tabelle(tbl: Element): string[] {
  const zeilen: string[] = [];
  for (const tr of Array.from(tbl.children).filter((x) => lokal(x) === "tr")) {
    const zellen = Array.from(tr.children).filter((x) => lokal(x) === "tc").map((tc) => bloecke(tc).filter(Boolean).join(" / ").trim());
    zeilen.push("| " + zellen.join(" | ") + " |");
  }
  return zeilen;
}

/** Text eines Absatzes samt Kästchen; verschachtelte Steuerelemente (sdt) werden aufgelöst. */
function absatz(p: Element): string {
  let s = "";
  /** Zustand älterer Formularfelder: zwischen fldChar begin (mit ffData) und end wird das Ergebnis durch das Kästchen ersetzt */
  let feld: { kreuz: boolean } | null = null;
  const lauf = (el: Element) => {
    for (const n of Array.from(el.children)) {
      const t = lokal(n);
      if (t === "sdt") {
        const pr = Array.from(n.children).find((x) => lokal(x) === "sdtPr");
        const cb = pr?.getElementsByTagNameNS(W14, "checkbox")[0];
        const inhalt = Array.from(n.children).find((x) => lokal(x) === "sdtContent");
        if (cb) {
          const an = cb.getElementsByTagNameNS(W14, "checked")[0]?.getAttributeNS(W14, "val") ?? cb.getElementsByTagNameNS(W14, "checked")[0]?.getAttribute("w14:val");
          s += an === "1" || an === "true" ? "☒" : "☐";
        } else if (inhalt) lauf(inhalt);
        continue;
      }
      if (t === "r") { s += run(n); continue; }
      if (t === "hyperlink" || t === "smartTag" || t === "ins" || t === "fldSimple") { lauf(n); continue; }
    }
  };
  const run = (r: Element): string => {
    let out = "";
    const font = r.getElementsByTagNameNS(W, "rFonts")[0];
    const wingdings = /wingdings|webdings|symbol/i.test([font?.getAttributeNS(W, "ascii"), font?.getAttribute("w:ascii"), font?.getAttributeNS(W, "hAnsi"), font?.getAttribute("w:hAnsi")].filter(Boolean).join(" "));
    for (const n of Array.from(r.children)) {
      const t = lokal(n);
      if (t === "fldChar") {
        const typ = n.getAttributeNS(W, "fldCharType") ?? n.getAttribute("w:fldCharType");
        if (typ === "begin") {
          const cb = n.getElementsByTagNameNS(W, "checkBox")[0];
          if (cb) {
            const checked = cb.getElementsByTagNameNS(W, "checked")[0];
            const def = cb.getElementsByTagNameNS(W, "default")[0];
            const val = (el: Element | undefined) => el ? (el.getAttributeNS(W, "val") ?? el.getAttribute("w:val") ?? "1") : null;
            const v = val(checked) ?? val(def);
            feld = { kreuz: v === "1" || v === "true" || v === "on" };
            out += feld.kreuz ? "☒" : "☐";
          }
        } else if (typ === "end") feld = null;
        continue;
      }
      if (feld) continue;   // Text im Formularfeld (z. B. FORMCHECKBOX) nicht doppelt ausgeben
      if (t === "t") out += n.textContent ?? "";
      else if (t === "tab") out += "\t";
      else if (t === "br" || t === "cr") out += "\n";
      else if (t === "sym") {
        const ch = (n.getAttributeNS(W, "char") ?? n.getAttribute("w:char") ?? "").toUpperCase().slice(-2);
        out += KREUZ.has(ch) ? "☒" : LEER.has(ch) ? "☐" : "";
      }
      else if (t === "noBreakHyphen") out += "-";
    }
    // Zeichen aus dem Private-Use-Bereich (Wingdings-Schrift) in Kästchen übersetzen
    if (wingdings) out = out.replace(/[-]/g, (c) => { const code = (c.charCodeAt(0) & 0xff).toString(16).toUpperCase().padStart(2, "0"); return KREUZ.has(code) ? "☒" : LEER.has(code) ? "☐" : ""; });
    return out;
  };
  lauf(p);
  return s;
}
