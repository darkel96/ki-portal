/**
 * Aufträge nach Zeitplan: Der Hub schreibt je Person ihre Aufträge samt Voreinstellungen und einem Abbild der
 * Applikationen in den Dienst. Der Dienst prüft jede halbe Minute, was fällig ist, und startet den Lauf.
 * Verpasste Termine (Dienst war aus) laufen einmal nach.
 */
import { AuftragSchema, VoreinstellungSchema, naechsterLauf, type Auftrag, type Voreinstellung } from "@/lib/meinhub";
import type { App } from "@/lib/schema";
import { loadApp } from "@/lib/sanitize";
import type { Laeufe } from "./laeufe";
import { DateiSpeicher, sicherName } from "./speicher";

export type AuftragsStand = { nutzer: string; auftraege: Auftrag[]; voreinstellungen: Voreinstellung[]; apps: Record<string, App>; stand: string };
const pfad = (nutzer: string) => `nutzer/${sicherName(nutzer)}/auftraege.json`;

export class Zeitplan {
  private timer: NodeJS.Timeout | null = null;
  private beschaeftigt = false;
  constructor(private readonly speicher: DateiSpeicher, private readonly laeufe: Laeufe) {}

  async lesen(nutzer: string): Promise<AuftragsStand> {
    return (await this.speicher.lesen<AuftragsStand>(pfad(nutzer))) ?? { nutzer, auftraege: [], voreinstellungen: [], apps: {}, stand: "" };
  }

  /**
   * Stand aus dem Hub übernehmen. Termine, die der Dienst schon weitergesetzt hat, bleiben erhalten, solange sich
   * Zeitplan und Aktiv-Schalter eines Auftrags nicht geändert haben (sonst würde ein alter Termin erneut laufen).
   */
  async schreiben(nutzer: string, roh: { auftraege?: unknown[]; voreinstellungen?: unknown[]; apps?: Record<string, unknown> }): Promise<AuftragsStand> {
    const alt = await this.lesen(nutzer);
    const auftraege: Auftrag[] = [];
    for (const a of roh.auftraege ?? []) {
      const r = AuftragSchema.safeParse(a);
      if (!r.success) continue;
      const neu = r.data;
      const vorher = alt.auftraege.find((x) => x.id === neu.id);
      if (vorher && JSON.stringify(vorher.zeitplan) === JSON.stringify(neu.zeitplan) && vorher.aktiv === neu.aktiv) {
        neu.naechsterLauf = vorher.naechsterLauf; neu.letzterLauf = vorher.letzterLauf || neu.letzterLauf;
      } else if (neu.aktiv && (vorher || !neu.naechsterLauf || !Number.isFinite(Date.parse(neu.naechsterLauf)))) {
        // Zeitplan geändert oder Termin unbrauchbar: neu berechnen. Ein neuer Auftrag behält seinen Termin, auch einen
        // schon verstrichenen (der Hub war zu): der läuft dann einmal nach.
        neu.naechsterLauf = naechsterLauf(neu.zeitplan).toISOString();
      }
      auftraege.push(neu);
    }
    const voreinstellungen = (roh.voreinstellungen ?? []).map((v) => VoreinstellungSchema.safeParse(v)).filter((r) => r.success).map((r) => r.data);
    const apps: Record<string, App> = {};
    for (const [id, a] of Object.entries(roh.apps ?? {})) { const app = loadApp(a); if (app) apps[id] = app; }
    const stand: AuftragsStand = { nutzer, auftraege, voreinstellungen, apps, stand: new Date().toISOString() };
    await this.speicher.schreiben(pfad(nutzer), stand);
    return stand;
  }

  /** Einen Auftrag sofort ausführen (Knopf „Jetzt ausführen“) */
  async jetzt(nutzer: string, auftragId: string): Promise<string> {
    const stand = await this.lesen(nutzer);
    const a = stand.auftraege.find((x) => x.id === auftragId);
    if (!a) throw new Error("Den Auftrag gibt es im Dienst nicht. Bitte die Aufträge im Hub neu speichern.");
    return this.starten(nutzer, stand, a, new Date());
  }

  private starten(nutzer: string, stand: AuftragsStand, a: Auftrag, jetzt: Date): string {
    const app = stand.apps[a.appId];
    const vorlage = a.voreinstellungId ? stand.voreinstellungen.find((v) => v.id === a.voreinstellungId) ?? null : null;
    if (!app) throw new Error(`Für den Auftrag „${a.name}“ liegt die Applikation nicht im Dienst. Bitte die Aufträge im Hub neu speichern.`);
    const l = this.laeufe.anlegen({
      nutzer, app, aktion: "alle", werte: { ...(vorlage?.werte ?? {}) }, files: { ...(vorlage?.dateien ?? {}) }, ergebnisse: {},
      titel: a.name, auftragId: a.id, ziel: a.ziel,
    });
    a.letzterLauf = jetzt.toISOString();
    return l.id;
  }

  /** Fällige Aufträge aller Personen starten */
  async pruefen(): Promise<void> {
    if (this.beschaeftigt) return;
    this.beschaeftigt = true;
    try {
      for (const ordner of await this.speicher.verzeichnisse("nutzer")) {
        const stand = await this.speicher.lesen<AuftragsStand>(`nutzer/${ordner}/auftraege.json`);
        if (!stand?.auftraege.length) continue;
        const jetzt = new Date();
        let geaendert = false;
        for (const a of stand.auftraege) {
          if (!a.aktiv || !a.naechsterLauf || Date.parse(a.naechsterLauf) > jetzt.getTime()) continue;
          // Termin zuerst weitersetzen, damit ein Auftrag nie doppelt startet
          a.naechsterLauf = naechsterLauf(a.zeitplan, jetzt).toISOString();
          geaendert = true;
          try { this.starten(stand.nutzer || ordner, stand, a, jetzt); }
          catch (e) { console.error(`[Hub-Dienst] Auftrag „${a.name}“:`, e instanceof Error ? e.message : e); }
        }
        if (geaendert) await this.speicher.schreiben(`nutzer/${ordner}/auftraege.json`, stand);
      }
    } finally { this.beschaeftigt = false; }
  }

  start(intervallMs = Number(process.env.HUB_ZEITPLAN_MS) || 30_000) {
    this.timer = setInterval(() => { void this.pruefen(); }, intervallMs);
    void this.pruefen();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
