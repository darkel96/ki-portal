/**
 * Netzlaufwerk als Wissensquelle (ohne Microsoft-Index): Die Freigabe ist auf dem Server schreibgeschützt eingebunden
 * (HUB_LAUFWERK, z. B. /laufwerk). Der Dienst liest nur die Ordner, die die Verwaltung freigegeben hat, holt den Text
 * aus Word, Excel, PowerPoint, PDF und Textdateien, legt einen Suchindex an und liefert zu einer Frage die passenden
 * Stellen. Wer eine Freigabe nutzen darf, steht an der Freigabe (leer = alle Angemeldeten).
 *
 * Kunde zuerst (HUB_LAUFWERK_KUNDEN, z. B. „_KUNDEN“): Unter diesem Ordner liegt je Kunde ein Unterordner. Der Dienst
 * liest ihn nicht im Voraus ein, sondern erkennt den Kunden in der Frage, liest nur dessen Ordner (beim ersten Mal, danach
 * nur Neues) und sucht darin. Ist der Kunde unklar oder nicht eindeutig, liefert er statt Auszügen die Rückfrage.
 *
 * Alle lesen mit demselben Lesekonto des Servers: Ordnerrechte von Windows gelten hier nicht, sondern die Freigaben.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { kundeFinden } from "./kunden";
import { KundenIndex, zerlegen, type IndexDokument, type IndexStelle } from "./laufwerk-index";
import type { DateiSpeicher } from "./speicher";
import { UMGEBUNG } from "./umgebung";

export type Freigabe = { pfad: string; fuer: string[]; notiz: string };
export type LaufwerkTreffer = { titel: string; url: string; text: string; fehler?: string; dateien?: string[]; dateienGesamt?: number };
type Eintrag = { pfad: string; mtime: number; groesse: number; stuecke: number; fehler?: string };
/** Ein Kundenordner im Index: wann zuletzt gefragt, wann zuletzt durchgesehen, ob der erste Durchgang fertig ist */
type KundeStand = { benutzt: number; zeit: number; fertig: boolean; laeuft: Promise<void> | null };

const ENDUNGEN = /\.(docx|xlsx|pptx|pdf|txt|md|csv)$/i;
const MAX_GROESSE = 25 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MAX_AUSZUG = 24_000;
/** Suchindex: Dokumente mit Inhalt (die ersten beiden mit mehr Stellen), danach weitere nur als Titel zum Nachschlagen */
const MAX_DOKUMENTE = 8, MAX_WEITERE = 15;
/** Höchstens so viele Dokumente mit Inhalt aus demselben Ordner: sonst belegt ein Nachtragsordner alle Plätze */
const MAX_JE_ORDNER = 2;
/** Kunde zuerst: Kundenordner im Index gleichzeitig, Wartezeit einer Antwort auf das erste Einlesen, Abstand der erneuten Durchsicht, Zwischenspeicher der Kundenliste */
const MAX_KUNDEN = 12, KUNDE_WARTEN_MS = 40_000, KUNDE_NEU_MS = 10 * 60_000, NAMEN_MS = 10 * 60_000;
/** So lange gilt der zuletzt erkannte Kunde für Folgefragen ohne Kundennamen */
const VERLAUF_MS = 30 * 60_000;
/** Anweisung an die KI, wie sie aus dem Kundenordner antwortet */
const ANTWORTSTIL = (name: string) => `Hinweis für die Antwort: Antworte direkt und sicher aus diesen Unterlagen von ${name}, ohne von „Auszügen“ oder „mitgelieferten Unterlagen“ zu sprechen und ohne nachzufragen, welcher Kunde gemeint ist. Stütze dich zuerst auf die aktuellsten passenden Dokumente (Stand); Dokumente aus Archiv- oder Altordnern und ältere Fassungen nur, wenn nichts Neueres da ist, und dann als solche benannt. Fasse bei Überblicksfragen alle passenden Dokumente zusammen, nicht nur das erste. Unterscheide den Gesamtumfang (Vertrag, Angebot, Pflichtenheft) von Nachträgen und Change Requests: Bei Überblicksfragen zuerst der Gesamtumfang, Nachträge als solche benannt dazu; fehlt der Gesamtumfang in den Unterlagen, sag das, statt einen Nachtrag als Gesamtumfang darzustellen. Steht etwas nicht darin, sag das in einem Satz und nenne das Dokument, in dem es am ehesten stehen müsste.`;

/** Pfad innerhalb der Freigabe: Schrägstriche, keine „..“, ohne Laufwerksbuchstaben und UNC-Anfang */
export function pfadSauber(p: string): string {
  const teile = p.replace(/\\/g, "/").replace(/^[a-z]:/i, "").split("/").map((t) => t.trim()).filter((t) => t && t !== ".");
  if (teile.includes("..")) throw new Error("Ungültiger Pfad.");
  return teile.join("/");
}
const darunter = (pfad: string, ordner: string) => !ordner || pfad.toLowerCase() === ordner.toLowerCase() || pfad.toLowerCase().startsWith(`${ordner.toLowerCase()}/`);

/** Wörter für den Index: klein, ohne Satzzeichen, ab drei Zeichen; Umlaute bleiben */
const woerter = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && w.length <= 40);
const FUELL = new Set(["und", "oder", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "ist", "sind", "wie", "was", "wer", "wann", "wo", "mit", "von", "für", "auf", "aus", "bei", "zum", "zur", "nicht", "auch", "noch", "nach", "über", "unter", "alle", "alles", "bitte", "gibt", "steht", "the", "and", "for",
  // Gesprächswörter aus Folgefragen („kannst du da bitte nachschauen?“)
  "kannst", "kann", "können", "dass", "dann", "doch", "schau", "schaue", "nachschauen", "mal", "mir", "uns", "sag", "sage", "zeig", "zeige",
  "welche", "welcher", "welches", "danke", "nein", "genau", "richtig", "okay", "dort", "hier", "diese", "dieser", "dieses", "hat", "haben",
  "wird", "werden", "war", "einmal", "nochmal", "sie", "ihr", "uns", "euch", "mich", "dich", "wäre", "würde", "soll", "sollte"]);

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
  /** Kunde zuerst: Kundenordner im Index (Pfad → Stand) und die Liste der Kundenordner */
  private kunden = new Map<string, KundeStand>();
  private namenCache: { zeit: number; namen: string[] } | null = null;
  /** Suchindex auf der Festplatte für die Kunden in HUB_LAUFWERK_INDEX (statt Einlesen auf Nachfrage) */
  private kundenIndex: KundenIndex | null = null;
  /** Zuletzt erkannter Kunde je Person (für Folgefragen ohne Kundennamen) */
  private letzterKunde = new Map<string, { name: string; zeit: number }>();
  stand = { dateien: 0, fehler: 0, zuletzt: "", laeuft: false, meldung: "" };

  constructor(private readonly speicher: DateiSpeicher, private readonly wurzel = UMGEBUNG.laufwerk, private readonly kundenOrdner = pfadSauber(UMGEBUNG.laufwerkKunden)) {}

  get aktiv() { return !!this.wurzel; }

  async laden(): Promise<void> {
    if (!this.aktiv) return;
    this.freigaben = (await this.speicher.lesen<Freigabe[]>("laufwerk/freigaben.json")) ?? [];
    if (this.kundenOrdner && UMGEBUNG.laufwerkIndex.length && !this.kundenIndex) {
      try {
        this.kundenIndex = new KundenIndex(join(UMGEBUNG.daten, "laufwerk", "index.db"), this.wurzel, this.kundenOrdner, UMGEBUNG.laufwerkIndex,
          ENDUNGEN, MAX_GROESSE, UMGEBUNG.laufwerkMaxDateien, (p, m, g) => this.textMitZwischenspeicher(p, m, g));
        this.kundenIndex.starten();
        console.info(`[Hub-Dienst] Suchindex für ${UMGEBUNG.laufwerkIndex.length} Kundenordner: ${UMGEBUNG.laufwerkIndex.join(", ")}`);
      } catch (e) { this.kundenIndex = null; console.error("[Hub-Dienst] Suchindex nicht verfügbar:", e); }
    }
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

  /** Ordner im Modus „Kunde zuerst“ (nicht im Voraus eingelesen)? */
  private imKundenOrdner = (p: string) => !!this.kundenOrdner && darunter(p, this.kundenOrdner);

  /**
   * Einen Ordner durchgehen; neue und geänderte Dateien werden gelesen, „gesehen“ sammelt alle gefundenen Dateien
   * (höchstens max). „ausser“: ein Unterordner, der übersprungen wird. Gibt die Zahl der Fehler zurück.
   */
  private async lesen(start: string, gesehen: Set<string>, max: number, ausser = ""): Promise<number> {
    let fehler = 0;
    const gehen = async (rel: string): Promise<void> => {
      if (gesehen.size >= max) return;
      let eintraege;
      try { eintraege = await readdir(join(this.wurzel, rel), { withFileTypes: true }); } catch { fehler++; return; }
      for (const e of eintraege) {
        if (gesehen.size >= max) return;
        if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!ausser || p.toLowerCase() !== ausser.toLowerCase()) await gehen(p); continue; }
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
    await gehen(start);
    return fehler;
  }

  /** Freigegebene Ordner durchgehen; nur neue und geänderte Dateien werden gelesen (Kundenordner erst auf Nachfrage) */
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
      try {
        let kundenweise = false;
        for (const f of this.freigaben) {
          if (this.imKundenOrdner(f.pfad)) { kundenweise = true; continue; }
          fehler += await this.lesen(f.pfad, gesehen, max, this.kundenOrdner);
        }
        // Was nicht mehr da oder nicht mehr freigegeben ist, fliegt raus (Kundenordner im Index verwaltet kundeLesen)
        for (const p of [...this.dateien.keys()]) if (!gesehen.has(p) && !this.imKundenOrdner(p)) this.entfernen(p);
        const meldung = gesehen.size >= max ? `Mehr als ${max} Dateien: Der Rest wurde nicht eingelesen.`
          : kundenweise ? `Kundenordner unter „${this.kundenOrdner}“ liest der Dienst erst, wenn nach dem Kunden gefragt wird.` : "";
        this.stand = { dateien: [...this.dateien.values()].filter((d) => d.stuecke && !this.imKundenOrdner(d.pfad)).length, fehler, zuletzt: new Date().toISOString(), laeuft: false, meldung };
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
    const stuecke = zerlegen(text);
    stuecke.forEach((t, i) => {
      const k = `${p}#${i}`;
      this.texte.set(k, t);
      // Dateiname und Ordner zählen in jedem Stück mit (Fragen nennen oft das Dokument)
      for (const w of new Set([...woerter(t), ...woerter(p)])) { let s = this.index.get(w); if (!s) this.index.set(w, (s = new Set())); s.add(k); }
    });
    this.dateien.set(p, { pfad: p, mtime, groesse, stuecke: stuecke.length });
    this.vokabel = null;
  }

  /* ---------- Kunde zuerst ---------- */
  /** Namen der Kundenordner (zehn Minuten zwischengespeichert) */
  private async kundenNamen(): Promise<string[]> {
    if (this.namenCache && Date.now() - this.namenCache.zeit < NAMEN_MS) return this.namenCache.namen;
    try {
      const e = await readdir(join(this.wurzel, this.kundenOrdner), { withFileTypes: true });
      const namen = e.filter((x) => x.isDirectory() && !x.name.startsWith(".") && !x.name.startsWith("~")).map((x) => x.name).sort((a, b) => a.localeCompare(b, "de"));
      this.namenCache = { zeit: Date.now(), namen };
      return namen;
    } catch { return []; }
  }

  /** Einen Kundenordner lesen (neu und geändert) und aus dem Index nehmen, was dort nicht mehr liegt */
  private async kundeLesen(rel: string): Promise<void> {
    const start = Date.now();
    const gesehen = new Set<string>();
    const fehler = await this.lesen(rel, gesehen, UMGEBUNG.laufwerkMaxDateien);
    for (const p of [...this.dateien.keys()]) if (darunter(p, rel) && !gesehen.has(p)) this.entfernen(p);
    const imIndex = [...this.dateien.values()].filter((d) => d.stuecke && darunter(d.pfad, rel)).length;
    console.info(`[Hub-Dienst] Kundenordner ${rel}: ${gesehen.size} lesbare Dateien gefunden, ${imIndex} im Index, ${fehler} Fehler, ${Math.round((Date.now() - start) / 1000)} s`);
  }

  /** Hält höchstens MAX_KUNDEN Kundenordner im Index: der am längsten nicht gefragte fliegt raus */
  private kundenBegrenzen(behalten: string) {
    while (this.kunden.size > MAX_KUNDEN) {
      const alt = [...this.kunden.entries()].filter(([r, k]) => r !== behalten && !k.laeuft).sort((a, b) => a[1].benutzt - b[1].benutzt)[0];
      if (!alt) return;
      for (const p of [...this.dateien.keys()]) if (darunter(p, alt[0])) this.entfernen(p);
      this.kunden.delete(alt[0]);
    }
  }

  /**
   * Kundenordner für die Suche bereitmachen: beim ersten Mal lesen (die Antwort wartet höchstens KUNDE_WARTEN_MS, der Rest
   * läuft im Hintergrund weiter), danach alle zehn Minuten im Hintergrund auf Neues durchsehen. true = erster Durchgang fertig.
   */
  private async kundeBereit(rel: string): Promise<boolean> {
    let k = this.kunden.get(rel);
    if (!k) this.kunden.set(rel, (k = { benutzt: 0, zeit: 0, fertig: false, laeuft: null }));
    k.benutzt = Date.now();
    if (!k.laeuft && (!k.fertig || Date.now() - k.zeit > KUNDE_NEU_MS)) {
      const stand = k;
      console.info(`[Hub-Dienst] Kundenordner ${rel}: wird gelesen`);
      stand.laeuft = this.kundeLesen(rel).then(() => { stand.fertig = true; stand.zeit = Date.now(); }, (e) => { stand.zeit = Date.now(); console.error(`[Hub-Dienst] Kundenordner ${rel}: Lesen fehlgeschlagen:`, e); }).finally(() => { stand.laeuft = null; });
      this.kundenBegrenzen(rel);
    }
    if (!k.fertig && k.laeuft) {
      let t: NodeJS.Timeout | undefined;
      await Promise.race([k.laeuft, new Promise<void>((r) => { t = setTimeout(r, KUNDE_WARTEN_MS); })]);
      clearTimeout(t);
    }
    return k.fertig;
  }

  /**
   * Suche mit Kundenwahl: Liegt der Ordner im Kundenordner (HUB_LAUFWERK_KUNDEN), erkennt der Dienst den Kunden in der
   * Frage (nur unter den Kunden, die die Person nutzen darf), liest dessen Ordner und sucht darin. Sonst wie suchen().
   * Ist der Kunde unklar oder nicht eindeutig, steht in „text“ die Anweisung zur Rückfrage statt Auszügen.
   */
  async suchenMitKunde(email: string, ordner: string, frage: string, titel: string, breiter?: string): Promise<LaufwerkTreffer> {
    const o = pfadSauber(ordner);
    const suchen = (wo: string) => {
      let r = this.suchen(email, wo, frage, titel);
      if (!r.fehler && !r.text && breiter) r = this.suchen(email, wo, breiter, titel);
      return r;
    };
    const K = this.kundenOrdner;
    if (!this.aktiv || !K || !darunter(o, K)) return suchen(o);
    const erlaubt = this.freigabenFuer(email).filter((f) => darunter(o, f.pfad) || darunter(f.pfad, o));
    if (!erlaubt.length) return suchen(o);

    // Der Kunde steht schon im Ordner der Quelle („_KUNDEN/Printus_Offenburg“) oder muss aus der Frage kommen
    let name = o === K ? "" : o.slice(K.length + 1).split("/")[0]!;
    let ausVerlauf = false;
    if (!name) {
      const alleNamen = await this.kundenNamen();
      const dieErlaubten = alleNamen.filter((n) => erlaubt.some((f) => darunter(`${K}/${n}`, f.pfad) || darunter(f.pfad, `${K}/${n}`)));
      const gefunden = kundeFinden(frage, dieErlaubten, FUELL);
      console.info(`[Hub-Dienst] Kunde zuerst: ${dieErlaubten.length} Kundenordner für diese Person, erkannt: ${gefunden.length ? gefunden.slice(0, 5).join(", ") : "keiner"}${gefunden.length > 5 ? ` (+${gefunden.length - 5})` : ""}`);
      // Folgefragen ohne Kundennamen („Und der IT-Anteil?“, Nachschlagen) und „Printus“ nach „Printus Offenburg“: Der zuletzt erkannte Kunde gilt weiter
      const zuletzt = this.letzterKunde.get(email.trim().toLowerCase());
      const merk = zuletzt && Date.now() - zuletzt.zeit < VERLAUF_MS && dieErlaubten.includes(zuletzt.name) ? zuletzt.name : "";
      // Nennt die Frage einen Kunden, den die Person nicht nutzen darf, gilt der gemerkte nicht (sonst käme die Antwort von einem anderen Kunden)
      const fremd = !gefunden.length && kundeFinden(frage, alleNamen, FUELL).length > 0;
      if (merk && ((!gefunden.length && !fremd) || (gefunden.length > 1 && gefunden.includes(merk)))) { name = merk; ausVerlauf = true; }
      else if (!gefunden.length) {
        const beispiele = dieErlaubten.slice(0, 3).map((n) => `„${n}“`).join(", ");
        return { titel, url: "", text: `Hinweis für die Antwort: In der Frage ist kein Kunde erkennbar.${beispiele ? "" : " Für diese Person ist kein Kundenordner freigegeben."} Beantworte die Frage nicht, sondern frage nach, für welchen Kunden sie gilt (Name wie im Kundenordner${beispiele ? `, z. B. ${beispiele}` : ""}).` };
      }
      else if (gefunden.length > 1) {
        const liste = gefunden.slice(0, 8).map((n) => `„${n}“`).join(", ");
        return { titel, url: "", text: `Hinweis für die Antwort: Der Kunde ist nicht eindeutig. Es passen ${gefunden.length} Kundenordner: ${liste}${gefunden.length > 8 ? " u. a." : ""}. Beantworte die Frage nicht, sondern frage nach, welcher gemeint ist.` };
      }
      else name = gefunden[0]!;
    }
    this.letzterKunde.set(email.trim().toLowerCase(), { name, zeit: Date.now() });
    const kundeRel = `${K}/${name}`;
    const verlauf = ausVerlauf ? `\n(Kunde aus dem bisherigen Gespräch übernommen; nenn ihn in der Antwort, statt nachzufragen.)` : "";
    const idx = this.kundenIndex?.hat(name) ? this.kundenIndex : null;
    if (idx) {
      const ziel = darunter(o, kundeRel) ? o : kundeRel;
      const zulaessig = (p: string) => darunter(p, ziel) && erlaubt.some((f) => darunter(p, f.pfad));
      const fertig = await idx.bereit(name, KUNDE_WARTEN_MS);
      // Dokumente zur aktuellen Frage (letzter Teil nach „ | “) zählen voll, die zu den Vorfragen ergänzen mit 0,6
      const such = (f: string): IndexDokument[] => {
        const b = this.indexBegriffe(f);
        const jetzt = idx.dokumente(name, b.jetzt, zulaessig), alle = f.includes(" | ") ? idx.dokumente(name, b.alle, zulaessig) : [];
        const mj = jetzt[0]?.punkte || 1, ma = alle[0]?.punkte || 1;
        const zus = new Map(jetzt.map((d) => [d.pfad, { ...d, punkte: d.punkte / mj }]));
        for (const d of alle) {
          const z = zus.get(d.pfad);
          if (!z) zus.set(d.pfad, { ...d, punkte: (0.6 * d.punkte) / ma });
          else { z.punkte += (0.6 * d.punkte) / ma; z.stellen = [...z.stellen, ...d.stellen.filter((s) => !z.stellen.some((x) => x.nr === s.nr))].slice(0, 4); }
        }
        return [...zus.values()].sort((a, b) => b.punkte - a.punkte);
      };
      let docs = such(frage);
      if (!docs.length && breiter) docs = such(breiter);
      const r = this.dokumentAuszug(docs, titel, `${kundeRel}/`);
      const f = idx.fortschritt(name)!;
      const kopf = `Kundenordner: ${name} · Suchindex${fertig ? "" : ` (wird gerade aufgebaut: ${f.erledigt} von ${f.gesamt || "?"} Dateien gelesen, die neuesten zuerst; fehlt die Antwort, sag, dass der Kundenordner gerade eingelesen wird und die Frage später noch einmal gestellt werden soll)`}${verlauf}\n${ANTWORTSTIL(name)}`;
      return { ...r, text: `${kopf}\n\n${r.text || "In diesem Kundenordner wurde zu der Frage nichts gefunden."}` };
    }
    const fertig = await this.kundeBereit(kundeRel);
    const r = suchen(darunter(o, kundeRel) ? o : kundeRel);
    const kopf = `Kundenordner: ${name}${fertig ? "" : " (wird noch eingelesen, es können Dateien fehlen)"}${verlauf}\n${ANTWORTSTIL(name)}`;
    return { ...r, text: r.fehler ? r.text : `${kopf}\n\n${r.text || "In diesem Kundenordner wurde zu der Frage nichts gefunden."}` };
  }

  /** Passende Stellen zu einer Frage, nur aus dem Ordner und nur aus Freigaben dieser Person */
  suchen(email: string, ordner: string, frage: string, titel: string): LaufwerkTreffer {
    if (!this.aktiv) return { titel, url: "", text: "", fehler: "Im Hub-Dienst ist kein Netzlaufwerk eingebunden (HUB_LAUFWERK)." };
    const o = pfadSauber(ordner);
    const erlaubt = this.freigabenFuer(email).filter((f) => darunter(o, f.pfad) || darunter(f.pfad, o));
    if (!erlaubt.length) return { titel, url: "", text: "", fehler: `Der Ordner „${o || "/"}“ ist für dich nicht freigegeben. Die Verwaltung gibt Ordner unter „Netzlaufwerk“ frei.` };
    const zulaessig = (p: string) => darunter(p, o) && erlaubt.some((f) => darunter(p, f.pfad));
    const begriffe = this.begriffe(frage);
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
    const r = this.auszug(sortiert.slice(0, 40).map(([k]) => ({ pfad: k.slice(0, k.lastIndexOf("#")), nr: Number(k.slice(k.lastIndexOf("#") + 1)), text: this.texte.get(k) ?? "" })), titel);
    const dateien = new Set(sortiert.map(([k]) => k.slice(0, k.lastIndexOf("#"))));
    const hinweis = this.stand.laeuft && !this.stand.zuletzt ? "Das Laufwerk wird gerade zum ersten Mal eingelesen; es fehlen noch Dateien." : "";
    return { ...r, text: r.text || hinweis, dateienGesamt: dateien.size, dateien: [...dateien].slice(0, 30).map((p) => p.split("/").pop() ?? p) };
  }

  /** Suchbegriffe einer Frage: Wörter ohne Füllwörter, höchstens 30 */
  private begriffe(frage: string) { return [...new Set(woerter(frage).filter((w) => !FUELL.has(w)))].slice(0, 30); }

  /** Für den Suchindex: wie begriffe(), dazu Kürzel aus zwei Großbuchstaben („IT“, „SW“); jetzt = nur die aktuelle Frage */
  private indexBegriffe(frage: string): { jetzt: string[]; alle: string[] } {
    const mit = (t: string) => [...new Set([...(t.match(/(?<![\p{L}\p{N}])\p{Lu}{2}(?![\p{L}\p{N}])/gu) ?? []).map((w) => w.toLowerCase()), ...this.begriffe(t)])].slice(0, 30);
    return { jetzt: mit(frage.split(" | ").pop() ?? frage), alle: mit(frage) };
  }

  /** Stellen (beste zuerst) als Auszug für die KI, mit Dateiname und Link, höchstens MAX_AUSZUG Zeichen */
  private auszug(stellen: IndexStelle[], titel: string): LaufwerkTreffer {
    let text = "";
    for (const s of stellen) {
      const teil = `#### ${s.pfad.split("/").pop()} (Stelle ${s.nr + 1})\nLink: ${this.link(s.pfad)}\n${s.text}\n\n`;
      if (text.length + teil.length > MAX_AUSZUG) break;
      text += teil;
    }
    const dateien = [...new Set(stellen.map((s) => s.pfad))];
    return { titel, url: "", text: text.trim(), dateien: dateien.slice(0, 30).map((p) => p.split("/").pop() ?? p), dateienGesamt: dateien.length };
  }

  /**
   * Dokumente aus dem Suchindex für die KI: je Dokument Name, Stand, Ordner, Link und die besten Stellen (in Lesereihenfolge),
   * höchstens MAX_AUSZUG Zeichen; danach die weiteren passenden Dokumente als Liste, damit die KI sie nennen oder nachschlagen kann
   */
  private dokumentAuszug(docs: IndexDokument[], titel: string, basis: string): LaufwerkTreffer {
    const stand = (d: IndexDokument) => new Date(d.mtime).toISOString().slice(0, 10);
    const ordner = (d: IndexDokument) => d.pfad.slice(basis.length).split("/").slice(0, -1).join("/") || "/";
    let text = "";
    const mit = new Set<string>();
    const jeOrdner = new Map<string, number>();
    for (const d of docs) {
      if (mit.size >= MAX_DOKUMENTE) break;
      const o = ordner(d);
      // Weitere Dokumente aus einem schon vertretenen Ordner kommen nur in die Liste
      if ((jeOrdner.get(o) ?? 0) >= MAX_JE_ORDNER) continue;
      const kopf = `#### ${d.pfad.split("/").pop()}\nStand: ${stand(d)} · Ordner: ${o}\nLink: ${this.link(d.pfad)}\n`;
      let teil = "";
      for (const s of d.stellen.slice(0, mit.size < 2 ? 4 : 2).sort((a, b) => a.nr - b.nr)) {
        const st = `[Stelle ${s.nr + 1}]\n${s.text.trim()}\n\n`;
        if (text.length + kopf.length + teil.length + st.length > MAX_AUSZUG) break;
        teil += st;
      }
      if (!teil) break;
      text += `${kopf}${teil}`;
      mit.add(d.pfad);
      jeOrdner.set(o, (jeOrdner.get(o) ?? 0) + 1);
    }
    const weitere = docs.filter((d) => !mit.has(d.pfad)).slice(0, MAX_WEITERE);
    if (text && weitere.length) text += `Weitere passende Dokumente (Inhalt hier nicht enthalten; bei Bedarf mit dem Dateinamen nachschlagen):\n${weitere.map((d) => `- ${d.pfad.split("/").pop()} (Stand ${stand(d)}, Ordner ${ordner(d)})`).join("\n")}`;
    return { titel, url: "", text: text.trim(), dateien: docs.slice(0, 30).map((d) => d.pfad.split("/").pop() ?? d.pfad), dateienGesamt: docs.length };
  }

  /** Anzeige-Adresse einer Datei: UNC-Pfad, wenn bekannt (öffnet im Windows-Explorer), sonst der Pfad in der Freigabe */
  link(p: string): string {
    const unc = UMGEBUNG.laufwerkUnc.replace(/[\\/]+$/, "");
    return unc ? `${unc}\\${p.split("/").join("\\")}` : p;
  }
  /** Pfad relativ zur Wurzel (für Tests) */
  relativ(abs: string) { return relative(this.wurzel, abs).split(sep).join("/"); }
}
