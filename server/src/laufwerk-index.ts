/**
 * Suchindex auf der Festplatte für ausgewählte Kundenordner (HUB_LAUFWERK_INDEX): SQLite mit Volltextsuche (FTS5) unter
 * HUB_DATEN/laufwerk/index.db. Ein Hintergrundlauf liest die Kundenordner (neueste Dateien zuerst) und danach alle
 * 15 Minuten nur Neues und Geändertes; Gelöschtes fliegt raus. Der Index übersteht Neustarts, eine Frage wartet also
 * nicht auf das Einlesen. Rechte prüft der Aufrufer (Freigaben in laufwerk.ts).
 */
import { mkdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export type IndexStelle = { pfad: string; nr: number; text: string };
type Fortschritt = { gesamt: number; erledigt: number; fertig: boolean; fertigMelden: () => void; fertigGemeldet: Promise<void> };
type Datei = { p: string; mtime: number; groesse: number };

const STUECK = 1_500;
/** Stellen je Datei höchstens (Schlüssel der Stelle = Datei-ID × STELLEN + Nummer) */
const STELLEN = 100_000;
const INTERVALL_MS = 15 * 60_000;

/** Text in Stücke teilen, an Absätzen, damit Tabellenzeilen und Sätze zusammenbleiben */
export function zerlegen(text: string): string[] {
  const stuecke: string[] = [];
  let akt = "";
  for (const absatz of text.split(/\n{2,}|\n(?=\[Seite \d+\]|## )/)) {
    if (akt && akt.length + absatz.length > STUECK) { stuecke.push(akt); akt = ""; }
    akt = akt ? `${akt}\n\n${absatz}` : absatz;
    while (akt.length > STUECK * 2) { stuecke.push(akt.slice(0, STUECK)); akt = akt.slice(STUECK); }
  }
  if (akt.trim()) stuecke.push(akt);
  return stuecke.slice(0, STELLEN - 1);
}

export class KundenIndex {
  private db: DatabaseSync;
  private stand = new Map<string, Fortschritt>();
  private s: Record<"datei" | "neu" | "aendern" | "stelle" | "stellenWeg" | "dateiWeg" | "dateienKunde" | "durchgang" | "fertig", StatementSync>;

  constructor(datei: string, private readonly wurzel: string, private readonly kundenOrdner: string, readonly kunden: string[],
    private readonly endungen: RegExp, private readonly maxGroesse: number, private readonly maxDateien: number,
    private readonly text: (p: string, mtime: number, groesse: number) => Promise<string>) {
    mkdirSync(dirname(datei), { recursive: true });
    this.db = new DatabaseSync(datei);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS dateien (id INTEGER PRIMARY KEY, pfad TEXT NOT NULL UNIQUE, kunde TEXT NOT NULL, mtime REAL NOT NULL, groesse INTEGER NOT NULL, stuecke INTEGER NOT NULL, fehler TEXT);
      CREATE INDEX IF NOT EXISTS dateien_kunde ON dateien (kunde);
      CREATE TABLE IF NOT EXISTS durchgaenge (kunde TEXT PRIMARY KEY, zeit TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS stellen USING fts5 (name, text, tokenize = 'unicode61 remove_diacritics 2');`);
    this.s = {
      datei: this.db.prepare("SELECT id FROM dateien WHERE pfad = ?"),
      neu: this.db.prepare("INSERT INTO dateien (pfad, kunde, mtime, groesse, stuecke, fehler) VALUES (?, ?, ?, ?, ?, ?)"),
      aendern: this.db.prepare("UPDATE dateien SET mtime = ?, groesse = ?, stuecke = ?, fehler = ? WHERE id = ?"),
      stelle: this.db.prepare("INSERT INTO stellen (rowid, name, text) VALUES (?, ?, ?)"),
      stellenWeg: this.db.prepare("DELETE FROM stellen WHERE rowid >= ? AND rowid < ?"),
      dateiWeg: this.db.prepare("DELETE FROM dateien WHERE id = ?"),
      dateienKunde: this.db.prepare("SELECT id, pfad, mtime, groesse FROM dateien WHERE kunde = ?"),
      durchgang: this.db.prepare("INSERT INTO durchgaenge (kunde, zeit) VALUES (?, ?) ON CONFLICT (kunde) DO UPDATE SET zeit = excluded.zeit"),
      fertig: this.db.prepare("SELECT 1 FROM durchgaenge WHERE kunde = ?"),
    };
    for (const k of kunden) {
      let fertigMelden = () => {};
      const fertigGemeldet = new Promise<void>((r) => { fertigMelden = r; });
      // Ein früherer Durchgang (vor dem Neustart) war vollständig: sofort suchbar, der neue Durchgang holt nur Änderungen nach
      const fertig = !!this.s.fertig.get(k);
      this.stand.set(k, { gesamt: 0, erledigt: 0, fertig, fertigMelden, fertigGemeldet });
      if (fertig) fertigMelden();
    }
  }

  hat(kunde: string) { return this.stand.has(kunde); }
  fortschritt(kunde: string) { const f = this.stand.get(kunde); return f ? { gesamt: f.gesamt, erledigt: f.erledigt, fertig: f.fertig } : null; }

  /** Wartet höchstens ms auf den ersten vollständigen Durchgang; true = fertig */
  async bereit(kunde: string, ms: number): Promise<boolean> {
    const f = this.stand.get(kunde);
    if (!f) return false;
    if (!f.fertig) {
      let t: NodeJS.Timeout | undefined;
      await Promise.race([f.fertigGemeldet, new Promise<void>((r) => { t = setTimeout(r, ms); })]);
      clearTimeout(t);
    }
    return f.fertig;
  }

  /** Hintergrundlauf: alle Kunden nacheinander, dann Pause */
  starten() {
    void (async () => {
      for (;;) {
        for (const k of this.kunden) {
          try { await this.durchgang(k); } catch (e) { console.error(`[Hub-Dienst] Suchindex ${k}: Durchgang fehlgeschlagen:`, e); }
        }
        await new Promise((r) => setTimeout(r, INTERVALL_MS));
      }
    })();
  }

  private async durchgang(kunde: string) {
    const start = Date.now();
    const f = this.stand.get(kunde)!;
    const rel = `${this.kundenOrdner}/${kunde}`;
    const liste: Datei[] = [];
    let fehler = 0;
    const gehen = async (r: string): Promise<void> => {
      let eintraege;
      try { eintraege = await readdir(join(this.wurzel, r), { withFileTypes: true }); } catch { fehler++; return; }
      for (const e of eintraege) {
        if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
        const p = `${r}/${e.name}`;
        if (e.isDirectory()) { await gehen(p); continue; }
        if (!e.isFile() || !this.endungen.test(e.name)) continue;
        try { const s = await stat(join(this.wurzel, p)); liste.push({ p, mtime: s.mtimeMs, groesse: s.size }); } catch { fehler++; }
      }
    };
    await gehen(rel);
    // Neueste zuerst: Beim ersten Einlesen sind die aktuellen Unterlagen am schnellsten suchbar
    liste.sort((a, b) => b.mtime - a.mtime);
    liste.length = Math.min(liste.length, this.maxDateien);
    f.gesamt = liste.length; f.erledigt = 0;
    const alt = new Map((this.s.dateienKunde.all(kunde) as { id: number; pfad: string; mtime: number; groesse: number }[]).map((d) => [d.pfad, d]));
    let neu = 0;
    for (const d of liste) {
      const a = alt.get(d.p);
      alt.delete(d.p);
      if (!a || a.mtime !== d.mtime || a.groesse !== d.groesse) {
        if (d.groesse > this.maxGroesse) this.schreiben(kunde, d, [], "zu groß");
        else {
          try { this.schreiben(kunde, d, zerlegen(await this.text(d.p, d.mtime, d.groesse))); }
          catch (e) { fehler++; this.schreiben(kunde, d, [], e instanceof Error ? e.message : String(e)); }
        }
        neu++;
      }
      f.erledigt++;
    }
    for (const a of alt.values()) this.loeschen(a.id);
    this.s.durchgang.run(kunde, new Date().toISOString());
    if (!f.fertig) { f.fertig = true; f.fertigMelden(); }
    if (neu || alt.size) console.info(`[Hub-Dienst] Suchindex ${kunde}: ${liste.length} lesbare Dateien, ${neu} neu gelesen, ${alt.size} entfernt, ${fehler} Fehler, ${Math.round((Date.now() - start) / 1000)} s`);
  }

  private schreiben(kunde: string, d: Datei, stuecke: string[], fehler: string | null = null) {
    // Im Namen nur der Pfad im Kundenordner: der Kundenname stünde sonst in jeder Stelle
    const name = d.p.slice(this.kundenOrdner.length + kunde.length + 2).replace(/[/_.\-]+/g, " ");
    this.db.exec("BEGIN");
    try {
      const alt = this.s.datei.get(d.p) as { id: number } | undefined;
      let id: number;
      if (alt) {
        id = alt.id;
        this.s.stellenWeg.run(id * STELLEN, (id + 1) * STELLEN);
        this.s.aendern.run(d.mtime, d.groesse, stuecke.length, fehler, id);
      } else id = Number(this.s.neu.run(d.p, kunde, d.mtime, d.groesse, stuecke.length, fehler).lastInsertRowid);
      stuecke.forEach((t, i) => this.s.stelle.run(id * STELLEN + i, name, t));
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  private loeschen(id: number) {
    this.db.exec("BEGIN");
    try { this.s.stellenWeg.run(id * STELLEN, (id + 1) * STELLEN); this.s.dateiWeg.run(id); this.db.exec("COMMIT"); }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /** Beste Stellen eines Kunden zu den Suchbegriffen (Wortanfang zählt, Treffer im Dateinamen doppelt) */
  suchen(kunde: string, begriffe: string[], zulaessig: (p: string) => boolean, max = 40): IndexStelle[] {
    // Kurze Kürzel („it“) nur als ganzes Wort, sonst zählt der Wortanfang
    const ausdruck = begriffe.map((w) => `"${w.replace(/"/g, "")}"${w.length < 3 ? "" : "*"}`).join(" OR ");
    if (!ausdruck) return [];
    const zeilen = this.db.prepare(`SELECT d.pfad AS pfad, s.rowid % ${STELLEN} AS nr, s.text AS text FROM stellen s JOIN dateien d ON d.id = s.rowid / ${STELLEN}
      WHERE stellen MATCH ? AND d.kunde = ? ORDER BY bm25(stellen, 2.0, 1.0) LIMIT 400`).all(ausdruck, kunde) as IndexStelle[];
    return zeilen.filter((z) => zulaessig(z.pfad)).slice(0, max);
  }
}
