/**
 * Netzlaufwerk als Wissensquelle (ohne Microsoft-Index): Die Freigabe ist auf dem Server schreibgeschützt eingebunden
 * (HUB_LAUFWERK, z. B. /laufwerk). Der Dienst liest nur die Ordner, die die Verwaltung freigegeben hat, holt den Text
 * aus Word, Excel, PowerPoint, PDF und Textdateien, legt einen Suchindex an und liefert zu einer Frage die passenden
 * Stellen. Wer eine Freigabe nutzen darf, steht an der Freigabe (leer = alle Angemeldeten).
 *
 * Alle lesen mit demselben Lesekonto des Servers: Ordnerrechte von Windows gelten hier nicht, sondern die Freigaben.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { DateiSpeicher } from "./speicher";
import { UMGEBUNG } from "./umgebung";

export type Freigabe = { pfad: string; fuer: string[]; notiz: string };
export type LaufwerkTreffer = { titel: string; url: string; text: string; fehler?: string; dateien?: string[]; dateienGesamt?: number };
type Eintrag = { pfad: string; mtime: number; groesse: number; stuecke: number; fehler?: string };

const ENDUNGEN = /\.(docx|xlsx|pptx|pdf|txt|md|csv)$/i;
const MAX_GROESSE = 25 * 1024 * 1024;
const MAX_TEXT = 200_000;
const STUECK = 1_500;
const MAX_AUSZUG = 24_000;

/** Pfad innerhalb der Freigabe: Schrägstriche, keine „..“, ohne Laufwerksbuchstaben und UNC-Anfang */
export function pfadSauber(p: string): string {
  const teile = p.replace(/\\/g, "/").replace(/^[a-z]:/i, "").split("/").map((t) => t.trim()).filter((t) => t && t !== ".");
  if (teile.includes("..")) throw new Error("Ungültiger Pfad.");
  return teile.join("/");
}
const darunter = (pfad: string, ordner: string) => !ordner || pfad.toLowerCase() === ordner.toLowerCase() || pfad.toLowerCase().startsWith(`${ordner.toLowerCase()}/`);

/** Wörter für den Index: klein, ohne Satzzeichen, ab drei Zeichen; Umlaute bleiben */
const woerter = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && w.length <= 40);
const FUELL = new Set(["und", "oder", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "ist", "sind", "wie", "was", "wer", "wann", "wo", "mit", "von", "für", "auf", "aus", "bei", "zum", "zur", "nicht", "auch", "noch", "nach", "über", "unter", "alle", "alles", "bitte", "gibt", "steht", "the", "and", "for"]);

/* ---------- Text aus Dateien ---------- */
async function textAus(datei: string): Promise<string> {
  const n = datei.toLowerCase();
  const daten = await readFile(datei);
  if (/\.(txt|md|csv)$/.test(n)) return daten.toString("utf8");
  if (n.endsWith(".docx")) { const mammoth = await import("mammoth"); return (await mammoth.extractRawText({ buffer: daten })).value; }
  if (n.endsWith(".xlsx")) {
    const { default: lesen } = await import("read-excel-file/node");
    const blaetter = await lesen(daten) as unknown as { sheet: string; data: unknown[][] }[];
    return blaetter.map((b) => `## Tabellenblatt: ${b.sheet}\n` + b.data.map((z) => z.map((c) => (c == null ? "" : String(c))).join(";")).join("\n")).join("\n\n");
  }
  if (n.endsWith(".pptx")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(daten);
    const folien = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
    const out: string[] = [];
    for (const [i, f] of folien.entries()) {
      const xml = await zip.file(f)!.async("string");
      out.push(`## Folie ${i + 1}\n` + [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")).join(" "));
    }
    return out.join("\n\n");
  }
  if (n.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(daten), verbosity: 0 }).promise;
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(`[Seite ${i}] ` + tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    await doc.cleanup();
    return out.join("\n\n");
  }
  return "";
}

/* ---------- Laufwerk ---------- */
export class Laufwerk {
  private freigaben: Freigabe[] = [];
  private dateien = new Map<string, Eintrag>();
  /** Wort → Stück-Schlüssel („pfad#nr“); Stücktexte liegen im Speicher des Dienstes (Zwischenspeicher) */
  private index = new Map<string, Set<string>>();
  private texte = new Map<string, string>();
  private laeuft: Promise<void> | null = null;
  /** Wörter sortiert (für die Suche nach Wortanfang); null = nach Änderungen neu bilden */
  private vokabel: string[] | null = null;
  private nochmal = false;
  stand = { dateien: 0, fehler: 0, zuletzt: "", laeuft: false, meldung: "" };

  constructor(private readonly speicher: DateiSpeicher, private readonly wurzel = UMGEBUNG.laufwerk) {}

  get aktiv() { return !!this.wurzel; }

  async laden(): Promise<void> {
    if (!this.aktiv) return;
    this.freigaben = (await this.speicher.lesen<Freigabe[]>("laufwerk/freigaben.json")) ?? [];
    void this.einlesen();
  }
  alleFreigaben(): Freigabe[] { return this.freigaben; }
  /** Freigaben, die diese Person nutzen darf (leere Liste „fuer“ = alle Angemeldeten) */
  freigabenFuer(email: string): Freigabe[] {
    const e = email.trim().toLowerCase();
    return this.freigaben.filter((f) => !f.fuer.length || f.fuer.some((x) => x.trim().toLowerCase() === e));
  }
  async freigabenSetzen(liste: unknown): Promise<Freigabe[]> {
    if (!Array.isArray(liste)) throw new Error("Erwartet wird eine Liste von Freigaben.");
    const neu: Freigabe[] = liste.slice(0, 100).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { pfad: pfadSauber(String(o.pfad ?? "")), fuer: (Array.isArray(o.fuer) ? o.fuer : []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@")).slice(0, 200), notiz: String(o.notiz ?? "").slice(0, 300) };
    });
    this.freigaben = neu;
    await this.speicher.schreiben("laufwerk/freigaben.json", neu);
    void this.einlesen();
    return neu;
  }

  /** Unterordner eines Ordners (für die Auswahl); nur innerhalb der Wurzel */
  async ordner(pfad: string): Promise<{ name: string; pfad: string }[]> {
    if (!this.aktiv) return [];
    const rel = pfadSauber(pfad);
    const eintraege = await readdir(join(this.wurzel, rel), { withFileTypes: true });
    return eintraege.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("~"))
      .map((e) => ({ name: e.name, pfad: rel ? `${rel}/${e.name}` : e.name })).sort((a, b) => a.name.localeCompare(b.name, "de")).slice(0, 500);
  }

  /** Freigegebene Ordner durchgehen; nur neue und geänderte Dateien werden gelesen */
  einlesen(): Promise<void> {
    if (!this.aktiv) return Promise.resolve();
    // Läuft gerade ein Durchgang (mit den alten Freigaben), danach noch einmal
    if (this.laeuft) { this.nochmal = true; return this.laeuft; }
    this.laeuft = (async () => {
      // Erst nach der Zuweisung oben weiter: ohne Freigaben wäre der Durchgang sonst sofort fertig, und „laeuft“ bliebe gesetzt
      await Promise.resolve();
      this.stand = { ...this.stand, laeuft: true, meldung: "" };
      const gesehen = new Set<string>();
      let fehler = 0;
      const max = UMGEBUNG.laufwerkMaxDateien;
      const gehen = async (rel: string): Promise<void> => {
        if (gesehen.size >= max) return;
        let eintraege;
        try { eintraege = await readdir(join(this.wurzel, rel), { withFileTypes: true }); } catch { fehler++; return; }
        for (const e of eintraege) {
          if (gesehen.size >= max) return;
          if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
          const p = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { await gehen(p); continue; }
          if (!e.isFile() || !ENDUNGEN.test(e.name) || gesehen.has(p)) continue;
          gesehen.add(p);
          try {
            const s = await stat(join(this.wurzel, p));
            const alt = this.dateien.get(p);
            if (alt && alt.mtime === s.mtimeMs && alt.groesse === s.size) continue;
            if (s.size > MAX_GROESSE) { this.dateien.set(p, { pfad: p, mtime: s.mtimeMs, groesse: s.size, stuecke: 0, fehler: "zu groß" }); continue; }
            this.aufnehmen(p, s.mtimeMs, s.size, await this.textMitZwischenspeicher(p, s.mtimeMs, s.size));
          } catch (err) {
            fehler++;
            this.dateien.set(p, { pfad: p, mtime: 0, groesse: 0, stuecke: 0, fehler: err instanceof Error ? err.message : String(err) });
          }
        }
      };
      try {
        for (const f of this.freigaben) await gehen(f.pfad);
        // Was nicht mehr da oder nicht mehr freigegeben ist, fliegt raus
        for (const p of [...this.dateien.keys()]) if (!gesehen.has(p)) this.entfernen(p);
        this.stand = { dateien: [...this.dateien.values()].filter((d) => d.stuecke).length, fehler, zuletzt: new Date().toISOString(), laeuft: false, meldung: gesehen.size >= max ? `Mehr als ${max} Dateien: Der Rest wurde nicht eingelesen.` : "" };
      } catch (e) {
        this.stand = { ...this.stand, laeuft: false, meldung: e instanceof Error ? e.message : String(e) };
      } finally {
        this.laeuft = null;
        if (this.nochmal) { this.nochmal = false; void this.einlesen(); }
      }
    })();
    return this.laeuft;
  }

  private async textMitZwischenspeicher(p: string, mtime: number, groesse: number): Promise<string> {
    const k = `laufwerk/text/${createHash("sha1").update(p).digest("hex")}.json`;
    const alt = await this.speicher.lesen<{ mtime: number; groesse: number; text: string }>(k);
    if (alt && alt.mtime === mtime && alt.groesse === groesse) return alt.text;
    const text = (await textAus(join(this.wurzel, p))).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, MAX_TEXT);
    await this.speicher.schreiben(k, { mtime, groesse, text });
    return text;
  }

  private entfernen(p: string) {
    const d = this.dateien.get(p);
    if (!d) return;
    for (let i = 0; i < d.stuecke; i++) {
      const k = `${p}#${i}`;
      const t = this.texte.get(k) ?? "";
      for (const w of new Set([...woerter(t), ...woerter(p)])) { const s = this.index.get(w); s?.delete(k); if (s && !s.size) this.index.delete(w); }
      this.texte.delete(k);
    }
    this.dateien.delete(p);
    this.vokabel = null;
  }

  private aufnehmen(p: string, mtime: number, groesse: number, text: string) {
    this.entfernen(p);
    const stuecke: string[] = [];
    // Stücke an Absätzen trennen, damit Tabellenzeilen und Sätze zusammenbleiben
    let akt = "";
    for (const absatz of text.split(/\n{2,}|\n(?=\[Seite \d+\]|## )/)) {
      if (akt && akt.length + absatz.length > STUECK) { stuecke.push(akt); akt = ""; }
      akt = akt ? `${akt}\n\n${absatz}` : absatz;
      while (akt.length > STUECK * 2) { stuecke.push(akt.slice(0, STUECK)); akt = akt.slice(STUECK); }
    }
    if (akt.trim()) stuecke.push(akt);
    stuecke.forEach((t, i) => {
      const k = `${p}#${i}`;
      this.texte.set(k, t);
      // Dateiname und Ordner zählen in jedem Stück mit (Fragen nennen oft das Dokument)
      for (const w of new Set([...woerter(t), ...woerter(p)])) { let s = this.index.get(w); if (!s) this.index.set(w, (s = new Set())); s.add(k); }
    });
    this.dateien.set(p, { pfad: p, mtime, groesse, stuecke: stuecke.length });
    this.vokabel = null;
  }

  /** Passende Stellen zu einer Frage, nur aus dem Ordner und nur aus Freigaben dieser Person */
  suchen(email: string, ordner: string, frage: string, titel: string): LaufwerkTreffer {
    if (!this.aktiv) return { titel, url: "", text: "", fehler: "Im Hub-Dienst ist kein Netzlaufwerk eingebunden (HUB_LAUFWERK)." };
    const o = pfadSauber(ordner);
    const erlaubt = this.freigabenFuer(email).filter((f) => darunter(o, f.pfad) || darunter(f.pfad, o));
    if (!erlaubt.length) return { titel, url: "", text: "", fehler: `Der Ordner „${o || "/"}“ ist für dich nicht freigegeben. Die Verwaltung gibt Ordner unter „Netzlaufwerk“ frei.` };
    const zulaessig = (p: string) => darunter(p, o) && erlaubt.some((f) => darunter(p, f.pfad));
    const begriffe = [...new Set(woerter(frage).filter((w) => !FUELL.has(w)))].slice(0, 30);
    const punkte = new Map<string, number>();
    const n = Math.max(1, this.texte.size);
    for (const b of begriffe) {
      // Wortanfang: „Abnahme“ trifft auch „Abnahmeprotokoll“ (zusammengesetzte Wörter)
      const treffer = new Set<string>();
      const v = (this.vokabel ??= [...this.index.keys()].sort());
      let lo = 0, hi = v.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (v[m]! < b) lo = m + 1; else hi = m; }
      for (let i = lo; i < v.length && v[i]!.startsWith(b); i++) for (const k of this.index.get(v[i]!) ?? []) treffer.add(k);
      if (!treffer.size) continue;
      const idf = Math.log(1 + n / treffer.size);
      for (const k of treffer) if (zulaessig(k.slice(0, k.lastIndexOf("#")))) punkte.set(k, (punkte.get(k) ?? 0) + idf);
    }
    const sortiert = [...punkte.entries()].sort((a, b) => b[1] - a[1]);
    const dateien = [...new Set(sortiert.map(([k]) => k.slice(0, k.lastIndexOf("#"))))];
    let text = "";
    for (const [k] of sortiert.slice(0, 40)) {
      const p = k.slice(0, k.lastIndexOf("#"));
      const teil = `#### ${p.split("/").pop()} (Stelle ${Number(k.slice(k.lastIndexOf("#") + 1)) + 1})\nLink: ${this.link(p)}\n${this.texte.get(k)}\n\n`;
      if (text.length + teil.length > MAX_AUSZUG) break;
      text += teil;
    }
    const hinweis = this.stand.laeuft && !this.stand.zuletzt ? "Das Laufwerk wird gerade zum ersten Mal eingelesen; es fehlen noch Dateien." : "";
    return { titel, url: "", text: text.trim() || hinweis, dateien: dateien.slice(0, 30).map((p) => p.split("/").pop() ?? p), dateienGesamt: dateien.length };
  }

  /** Anzeige-Adresse einer Datei: UNC-Pfad, wenn bekannt (öffnet im Windows-Explorer), sonst der Pfad in der Freigabe */
  link(p: string): string {
    const unc = UMGEBUNG.laufwerkUnc.replace(/[\\/]+$/, "");
    return unc ? `${unc}\\${p.split("/").join("\\")}` : p;
  }
  /** Pfad relativ zur Wurzel (für Tests) */
  relativ(abs: string) { return relative(this.wurzel, abs).split(sep).join("/"); }
}
