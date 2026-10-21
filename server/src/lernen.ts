/**
 * Lernschicht im Dienst: Rückmeldungen je App (anonym), Auswertung per KI im Namen der Person, die sie angestoßen hat,
 * und danach von selbst nach Zeitplan, sobald genug neue Rückmeldungen da sind. Freigeben tut immer ein Mensch im Baukasten.
 */
import { kiFragen } from "@/lib/ki";
import { AUSWERTUNG_MIN, MAX_RUECKMELDUNGEN, auswertungDurchfuehren, auswertungEinarbeiten, auswertungsPrompt, leererStand, neueSeit, rueckmeldungAnlegen, vorschlagAnlegen, type LernStand, type Vorschlag, type VorschlagArt } from "@/lib/lernen";
import { StepSchema, type Step } from "@/lib/schema";
import { tokenKontext } from "./alias/auth";
import { graphTokenFuer } from "./anmeldung";
import { DateiSpeicher, sicherName } from "./speicher";

type Auswertung = { nutzer: string; appName: string; step: Step; intervallTage: number };
type Datei = LernStand & { auswertungen: Record<string, Auswertung> };
const pfad = (appId: string) => `lernen/${sicherName(appId)}.json`;
const AUFBEWAHRUNG_TAGE = Number(process.env.HUB_FEEDBACK_TAGE) || 90;

export class Lernen {
  private laeuft = false;
  constructor(private readonly speicher: DateiSpeicher) {}

  private async lesen(appId: string): Promise<Datei> {
    const d = await this.speicher.lesen<Partial<Datei>>(pfad(appId));
    return { ...leererStand(), auswertungen: {}, ...(d ?? {}) };
  }
  private async schreiben(appId: string, d: Datei) {
    const grenze = Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000;
    d.rueckmeldungen = d.rueckmeldungen.filter((r) => Date.parse(r.zeit) >= grenze).slice(-MAX_RUECKMELDUNGEN);
    await this.speicher.schreiben(pfad(appId), d);
  }
  private stand(d: Datei): LernStand {
    const { auswertungen: _a, ...rest } = d;
    return rest;
  }

  async standVon(appId: string): Promise<LernStand> { return this.stand(await this.lesen(appId)); }

  async rueckmeldung(appId: string, roh: unknown): Promise<void> {
    const o = (roh ?? {}) as Record<string, unknown>;
    const bewertung = ["gut", "schlecht", "ohneQuelle"].includes(String(o.bewertung)) ? (o.bewertung as "gut" | "schlecht" | "ohneQuelle") : null;
    const stepId = String(o.stepId ?? "").slice(0, 60);
    if (!bewertung || !stepId) throw new Error("Rückmeldung unvollständig (stepId, bewertung).");
    const d = await this.lesen(appId);
    d.rueckmeldungen.push(rueckmeldungAnlegen({ stepId, bewertung, frage: String(o.frage ?? ""), antwort: String(o.antwort ?? ""), kommentar: String(o.kommentar ?? "") }));
    await this.schreiben(appId, d);
  }

  /** Auswertung anstoßen (Baukasten); der Dienst merkt sich Schritt und Person für die automatische Auswertung */
  async auswerten(appId: string, nutzer: string, roh: unknown): Promise<LernStand> {
    const o = (roh ?? {}) as { stepId?: unknown; step?: unknown; appName?: unknown; intervallTage?: unknown };
    const step = StepSchema.safeParse(o.step);
    if (!step.success) throw new Error("Der KI-Schritt ist ungültig.");
    const intervall = Number(o.intervallTage);
    const cfg: Auswertung = { nutzer, appName: String(o.appName ?? ""), step: step.data, intervallTage: Number.isFinite(intervall) && intervall >= 0 ? intervall : 7 };
    const d = await this.lesen(appId);
    d.auswertungen[step.data.id] = cfg;
    await this.durchfuehren(appId, d, cfg);
    return this.stand(d);
  }

  private async durchfuehren(appId: string, d: Datei, cfg: Auswertung): Promise<void> {
    const r = d.rueckmeldungen.filter((x) => x.stepId === cfg.step.id);
    const erg = await tokenKontext.run({ token: () => graphTokenFuer(this.speicher, cfg.nutzer), nutzer: cfg.nutzer }, () => auswertungDurchfuehren(auswertungsPrompt({ name: cfg.appName }, cfg.step, r), cfg.step.id, (t) => kiFragen(t)));
    const neu = auswertungEinarbeiten(d, cfg.step.id, erg);
    Object.assign(d, neu);
    await this.schreiben(appId, d);
  }

  /** Vorschlag aus dem Chat („Als häufige Frage vorschlagen“) */
  async einreichen(appId: string, roh: unknown): Promise<LernStand> {
    const o = (roh ?? {}) as Record<string, unknown>;
    const art = (["hausregel", "glossar", "faq", "quelle"] as const).find((a) => a === String(o.art ?? "")) as VorschlagArt | undefined;
    const stepId = String(o.stepId ?? "").slice(0, 60);
    if (!art || !stepId) throw new Error("Vorschlag unvollständig (stepId, art).");
    const v = vorschlagAnlegen(stepId, { art, text: String(o.text ?? ""), frage: String(o.frage ?? ""), antwort: String(o.antwort ?? ""), begruendung: String(o.begruendung ?? ""), belege: Number(o.belege) || 1, herkunft: "chat" });
    if (art === "faq" ? !(v.frage && v.antwort) : !v.text) throw new Error("Vorschlag ohne Inhalt.");
    const d = await this.lesen(appId);
    d.vorschlaege = [...d.vorschlaege, v].slice(-150);
    await this.schreiben(appId, d);
    return this.stand(d);
  }

  async vorschlag(appId: string, id: string, stand: unknown): Promise<LernStand> {
    const s = ["offen", "angenommen", "verworfen"].includes(String(stand)) ? (stand as Vorschlag["stand"]) : null;
    if (!s) throw new Error("Unbekannter Stand.");
    const d = await this.lesen(appId);
    d.vorschlaege = d.vorschlaege.map((v) => (v.id === id ? { ...v, stand: s } : v));
    await this.schreiben(appId, d);
    return this.stand(d);
  }

  /** Von selbst auswerten: je gemerktem Schritt, wenn das Intervall um ist und genug neue Rückmeldungen da sind */
  async faellige(): Promise<void> {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      for (const name of await this.speicher.liste("lernen")) {
        const appId = name.replace(/\.json$/, "");
        const d = await this.lesen(appId);
        for (const cfg of Object.values(d.auswertungen)) {
          const letzte = Date.parse(d.letzteAuswertung[cfg.step.id] ?? "") || 0;
          if (Date.now() - letzte < cfg.intervallTage * 86_400_000) continue;
          if (neueSeit(d, cfg.step.id).length < AUSWERTUNG_MIN) continue;
          // Die freigegebenen Hausregeln kennt der Dienst nur bis zur letzten angestoßenen Auswertung; das reicht für Vorschläge
          try { await this.durchfuehren(appId, d, cfg); console.info(`[Hub-Dienst] Lernschicht: „${cfg.appName}“ ausgewertet.`); }
          catch (e) { console.error(`[Hub-Dienst] Lernschicht „${cfg.appName}“:`, e instanceof Error ? e.message : e); }
        }
      }
    } finally { this.laeuft = false; }
  }
}
