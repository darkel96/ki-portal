/**
 * Läufe im Dienst: Eine App wird mit Eingaben ausgeführt, Zwischenstände landen laufend auf der Platte. Wird der
 * Dienst neu gestartet, laufen angefangene Läufe mit den fertigen Schritten weiter. Der Hub holt den Stand per API.
 */
import { stepsFor } from "@/lib/model";
import { ablaufStarten, type OutState, type Werte } from "@/lib/runner";
import type { FileInfo } from "@/lib/request";
import type { App } from "@/lib/schema";
import { loadApp } from "@/lib/sanitize";
import { kurz, type Lauf, type Ziel } from "@/lib/meinhub";
import { tokenKontext } from "./alias/auth";
import { graphTokenFuer } from "./anmeldung";
import { DateiSpeicher, sicherName } from "./speicher";
import { UMGEBUNG } from "./umgebung";

export type LaufStatus = "laeuft" | "fertig" | "fehler" | "abgebrochen";
export type DienstLauf = {
  id: string; nutzer: string; appId: string; appName: string; titel: string; aktion: string;
  auftragId: string | null; ziel: Ziel | null;
  start: string; ende: string; status: LaufStatus; meldung: string;
  /** Was mit dem Ergebnis geschah („Per E-Mail an … gesendet.“ oder der Fehler der Zustellung) */
  zustellung?: string;
  /** Zähler, der bei jeder Änderung steigt (der Hub fragt nur nach Neuem) */
  version: number;
  gesehen: boolean;
  app: App; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>;
  outs: Record<string, OutState>;
};
/** Was der Hub in Listen bekommt (ohne App, Eingaben und lange Texte) */
export type LaufKurz = Omit<DienstLauf, "app" | "werte" | "files" | "outs" | "ergebnisse"> & { ergebnisse: Lauf["ergebnisse"] };

const laufPfad = (id: string) => `laeufe/${sicherName(id)}.json`;
const neueId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Laeufe {
  private readonly alle = new Map<string, DienstLauf>();
  private readonly laufend = new Map<string, AbortController>();
  private readonly warteschlange: DienstLauf[] = [];
  private aktiv = 0;
  private readonly schreibTimer = new Map<string, NodeJS.Timeout>();
  /** Wird nach dem Ende eines Laufs aufgerufen (Versand an Ziel, Protokoll) */
  onEnde: ((l: DienstLauf) => Promise<void> | void) | null = null;

  constructor(private readonly speicher: DateiSpeicher) {}

  async laden(): Promise<void> {
    for (const name of await this.speicher.liste("laeufe")) {
      const l = await this.speicher.lesen<DienstLauf>(`laeufe/${name}`);
      if (l?.id) this.alle.set(l.id, l);
    }
    // Angefangene Läufe (Dienst wurde beendet) mit den fertigen Schritten fortsetzen
    for (const l of this.alle.values()) if (l.status === "laeuft") this.einreihen(l);
    await this.aufraeumen();
  }

  anlegen(eingabe: { nutzer: string; app: unknown; aktion: string; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>; titel: string; auftragId?: string | null; ziel?: Ziel | null }): DienstLauf {
    const app = loadApp(eingabe.app);
    if (!app) throw new Error("Die Applikation ist ungültig.");
    const steps = stepsFor(app, eingabe.aktion);
    if (!steps.length) throw new Error("Für diese Aktion gibt es keine KI-Schritte.");
    const l: DienstLauf = {
      id: neueId(), nutzer: eingabe.nutzer, appId: app.id ?? "", appName: app.name, titel: eingabe.titel || app.name, aktion: eingabe.aktion,
      auftragId: eingabe.auftragId ?? null, ziel: eingabe.ziel ?? null,
      start: new Date().toISOString(), ende: "", status: "laeuft", meldung: "", version: 1, gesehen: false,
      app, werte: eingabe.werte, files: eingabe.files, ergebnisse: eingabe.ergebnisse,
      outs: Object.fromEntries(steps.map((s) => [s.id, { status: "wartet" as const }])),
    };
    this.alle.set(l.id, l);
    void this.speicher.schreiben(laufPfad(l.id), l);
    this.einreihen(l);
    return l;
  }

  holen(id: string): DienstLauf | undefined { return this.alle.get(id); }

  von(nutzer: string, filter: { appId?: string; nurAuftraege?: boolean; seit?: number } = {}): DienstLauf[] {
    return [...this.alle.values()]
      .filter((l) => l.nutzer === nutzer && (!filter.appId || l.appId === filter.appId) && (!filter.nurAuftraege || l.auftragId) && (!filter.seit || Date.parse(l.start) >= filter.seit || l.status === "laeuft"))
      .sort((a, b) => b.start.localeCompare(a.start));
  }

  kurz(l: DienstLauf): LaufKurz {
    const { app: _a, werte: _w, files: _f, outs, ergebnisse: _e, ...rest } = l;
    return { ...rest, ergebnisse: kurz(outs, l.app) };
  }

  abbrechen(id: string): boolean {
    const l = this.alle.get(id);
    if (!l || l.status !== "laeuft") return false;
    const i = this.warteschlange.indexOf(l);
    if (i >= 0) {
      this.warteschlange.splice(i, 1);
      this.beenden(l, "abgebrochen", "Abgebrochen, bevor der Lauf begonnen hat.");
      return true;
    }
    this.laufend.get(id)?.abort();
    return true;
  }

  gesehen(id: string): void {
    const l = this.alle.get(id);
    if (l && !l.gesehen) { l.gesehen = true; l.version++; this.sichern(l, true); }
  }

  async loeschen(id: string): Promise<void> {
    this.abbrechen(id);
    this.alle.delete(id);
    await this.speicher.loeschen(laufPfad(id));
  }

  /** Alte Läufe entfernen (HUB_AUFBEWAHRUNG_TAGE) */
  async aufraeumen(): Promise<void> {
    const grenze = Date.now() - UMGEBUNG.aufbewahrungTage * 86_400_000;
    for (const l of [...this.alle.values()]) if (l.status !== "laeuft" && Date.parse(l.ende || l.start) < grenze) await this.loeschen(l.id);
  }

  private einreihen(l: DienstLauf) {
    this.warteschlange.push(l);
    this.naechsten();
  }

  private naechsten() {
    while (this.aktiv < UMGEBUNG.parallel && this.warteschlange.length) {
      const l = this.warteschlange.shift()!;
      this.aktiv++;
      void this.ausfuehren(l).finally(() => { this.aktiv--; this.naechsten(); });
    }
  }

  private sichern(l: DienstLauf, sofort = false) {
    const t = this.schreibTimer.get(l.id);
    if (sofort) {
      if (t) clearTimeout(t);
      this.schreibTimer.delete(l.id);
      void this.speicher.schreiben(laufPfad(l.id), l);
      return;
    }
    if (t) return;
    this.schreibTimer.set(l.id, setTimeout(() => { this.schreibTimer.delete(l.id); void this.speicher.schreiben(laufPfad(l.id), l); }, 1000));
  }

  private beenden(l: DienstLauf, status: LaufStatus, meldung: string) {
    l.status = status; l.meldung = meldung; l.ende = new Date().toISOString(); l.version++;
    this.sichern(l, true);
    void Promise.resolve(this.onEnde?.(l)).catch((e) => console.error("[Hub-Dienst] Nach dem Lauf:", e));
  }

  private async ausfuehren(l: DienstLauf): Promise<void> {
    const ctl = new AbortController();
    this.laufend.set(l.id, ctl);
    // Fortsetzen: nur Schritte, die noch kein Ergebnis haben
    const steps = stepsFor(l.app, l.aktion);
    const offen = steps.filter((s) => !["fertig", "uebersprungen", "simuliert"].includes(l.outs[s.id]?.status ?? ""));
    const aktion = offen.length === steps.length ? l.aktion : offen.map((s) => s.id).join(",");
    for (const s of offen) l.outs[s.id] = { status: "wartet" };
    const setOut = (id: string, s: OutState | ((prev: OutState | undefined) => OutState)) => {
      const neu = typeof s === "function" ? s(l.outs[id]) : s;
      // Team-Verlauf begrenzen, die Datei bleibt handlich
      if (neu.team && neu.team.length > 60) neu.team = neu.team.slice(-60);
      l.outs[id] = neu;
      const step = l.app.steps.find((x) => x.id === id);
      if (step && neu.status === "fertig" && neu.text) l.ergebnisse[step.key] = neu.text;
      l.version++;
      this.sichern(l);
    };
    try {
      if (!offen.length) { this.beenden(l, "fertig", ""); return; }
      await tokenKontext.run({ token: () => graphTokenFuer(this.speicher, l.nutzer), nutzer: l.nutzer }, () =>
        ablaufStarten({ app: l.app, aktion, werte: l.werte, files: l.files, ergebnisse: l.ergebnisse, signal: ctl.signal, setOut }));
      const st = Object.values(l.outs).map((o) => o.status);
      if (ctl.signal.aborted || st.includes("gestoppt")) this.beenden(l, "abgebrochen", "Abgebrochen.");
      else if (st.includes("fehler")) this.beenden(l, "fehler", "Mindestens ein Schritt ist fehlgeschlagen.");
      else this.beenden(l, "fertig", "");
    } catch (e) {
      this.beenden(l, ctl.signal.aborted ? "abgebrochen" : "fehler", e instanceof Error ? e.message : "Der Lauf ist fehlgeschlagen.");
    } finally {
      this.laufend.delete(l.id);
    }
  }
}
