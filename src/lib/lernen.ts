/**
 * Lernschicht für Fachexperten-Chats (globale Regel). Das Sprachmodell lernt im Betrieb nichts dazu; lernen muss das
 * System darum herum. Drei Schichten:
 *   1. Persönlichkeitskern: die Rolle des KI-Schritts (Tonfall, Belegregel). Nur im Baukasten änderbar, nie durch die Schleife.
 *   2. Wissen: die hinterlegten Quellen (wie bisher).
 *   3. Hausregeln: ein eigener Block je Schritt, der an die Rolle angehängt wird. Er wächst nur durch Freigabe:
 *      Rückmeldungen im Chat (Daumen, Kommentar, Fragen ohne Fundstelle) → Auswertung per KI → Vorschläge →
 *      eine Person nimmt an, ändert oder verwirft → neue Fassung → mit dem Speichern der App live.
 * Jede Fassung ist mit Datum und Grund festgehalten und lässt sich zurückdrehen.
 * Dieses Modul ist reine Logik (Browser und Hub-Dienst); Ablage und KI-Aufruf stehen in lernenBrowser.ts bzw. im Dienst.
 */
import type { App, Step } from "./schema";
import { jsonAus } from "./ki";

export type Fassung = Step["hausregeln"]["fassungen"][number];
export type Bewertung = "gut" | "schlecht" | "ohneQuelle";
export type Rueckmeldung = { id: string; stepId: string; zeit: string; bewertung: Bewertung; frage: string; antwort: string; kommentar: string };
export type VorschlagArt = "hausregel" | "glossar" | "faq" | "quelle";
export type Vorschlag = {
  id: string; stepId: string; art: VorschlagArt;
  /** Hausregel, Begriff oder fehlende Unterlage: der fertige Satz; bei faq: die Frage (Anzeige) */
  text: string;
  /** Häufige Frage: Frage und freigegebene Antwort (die der Chat dann sofort gibt) */
  frage?: string; antwort?: string;
  begruendung: string; belege: number; stand: "offen" | "angenommen" | "verworfen"; zeit: string;
  /** aus der Auswertung (wird bei der nächsten ersetzt) oder von einer Person im Chat vorgeschlagen */
  herkunft?: "auswertung" | "chat";
};
export type LernStand = {
  rueckmeldungen: Rueckmeldung[];
  vorschlaege: Vorschlag[];
  /** je Schritt: Zeitpunkt der letzten Auswertung */
  letzteAuswertung: Record<string, string>;
  /** je Schritt: Zusammenfassung der letzten Auswertung */
  zusammenfassung: Record<string, string>;
};

export const ART_LABEL: Record<VorschlagArt, string> = { hausregel: "Hausregel", glossar: "Begriff", faq: "Häufige Frage", quelle: "Fehlende Unterlage" };
/** Höchstens so viele Rückmeldungen je App aufbewahren */
export const MAX_RUECKMELDUNGEN = 400;
/** Mindestens so viele neue Rückmeldungen, bevor der Dienst von selbst auswertet */
export const AUSWERTUNG_MIN = 3;
export const leererStand = (): LernStand => ({ rueckmeldungen: [], vorschlaege: [], letzteAuswertung: {}, zusammenfassung: {} });
export const neueLernId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const heute = () => new Date().toISOString().slice(0, 10);

/* ---------- Hausregeln ---------- */
export const hausregelnText = (s: Pick<Step, "hausregeln">): string => s.hausregeln.fassungen.at(-1)?.text.trim() ?? "";
export const hausregelnStand = (s: Pick<Step, "hausregeln">): string => s.hausregeln.fassungen.at(-1)?.datum ?? "";

/** Neue Fassung anhängen (die letzte gilt); liefert den geänderten Schritt */
export function hausregelnFassung<S extends Pick<Step, "hausregeln">>(s: S, text: string, grund: string): S {
  const nr = (s.hausregeln.fassungen.at(-1)?.nr ?? 0) + 1;
  return { ...s, hausregeln: { fassungen: [...s.hausregeln.fassungen.slice(-59), { nr, datum: heute(), text: text.trim().slice(0, 6000), grund: grund.trim().slice(0, 300) }] } };
}

/** Block, der in der Systemanweisung an die Rolle angehängt wird; leer, solange es keine Hausregeln gibt */
export function hausregelnBlock(s: Pick<Step, "hausregeln">): string {
  const t = hausregelnText(s);
  if (!t) return "";
  return `Hausregeln und Kontext (aus Rückmeldungen der Kolleginnen und Kollegen, freigegeben, Stand ${hausregelnStand(s)}). Diese Punkte ergänzen Tonfall, Begriffe und Zielgruppe. Sie sind kein Wissen und keine Fundstelle: Die Antwort kommt weiterhin vollständig aus den mitgelieferten Auszügen mit Quellenangabe; ein Begriff oder Hinweis aus den Hausregeln ersetzt nie die Antwort aus den Unterlagen und ist nie ein Grund, die Auszüge nicht zu nutzen. Die Belegregel bleibt unberührt:\n${t}`;
}

/* ---------- Rückmeldungen ---------- */
/** Antwort, die nichts in den Unterlagen gefunden hat: wird als „ohne Fundstelle“ gezählt (Hinweis auf fehlende Quellen) */
const OHNE_QUELLE = /nichts (dazu |darüber )?gefunden|in den unterlagen (steht |finde ich |gibt es )?(dazu |darüber )?(nichts|keine)|nicht in den (hinterlegten )?unterlagen|dazu (habe|finde) ich [^.]{0,60}(nichts|keine)|keine (passende |belegte )?(fundstelle|quelle|angabe)/i;
export const ohneQuelle = (antwort: string) => OHNE_QUELLE.test(antwort.slice(0, 700));

export function rueckmeldungAnlegen(r: Omit<Rueckmeldung, "id" | "zeit">): Rueckmeldung {
  return { id: neueLernId("r"), zeit: new Date().toISOString(), stepId: r.stepId, bewertung: r.bewertung, frage: r.frage.slice(0, 1000), antwort: r.antwort.slice(0, 4000), kommentar: r.kommentar.slice(0, 500) };
}

/** Vorschlag von Hand bzw. aus dem Chat („Als häufige Frage vorschlagen“) */
export function vorschlagAnlegen(stepId: string, v: { art: VorschlagArt; text?: string; frage?: string; antwort?: string; begruendung?: string; belege?: number; herkunft?: Vorschlag["herkunft"] }): Vorschlag {
  const frage = (v.frage ?? "").trim().slice(0, 300), antwort = (v.antwort ?? "").trim().slice(0, 4000);
  return { id: neueLernId("v"), stepId, art: v.art, text: (v.text || (v.art === "faq" ? frage : "")).trim().slice(0, 600), ...(v.art === "faq" ? { frage, antwort } : {}), begruendung: (v.begruendung ?? "").slice(0, 400), belege: v.belege ?? 1, stand: "offen", zeit: new Date().toISOString(), herkunft: v.herkunft ?? "auswertung" };
}

export function statistik(st: LernStand, stepId: string, tage = 90) {
  const seit = Date.now() - tage * 86_400_000;
  const r = st.rueckmeldungen.filter((x) => x.stepId === stepId && Date.parse(x.zeit) >= seit);
  return { gut: r.filter((x) => x.bewertung === "gut").length, schlecht: r.filter((x) => x.bewertung === "schlecht").length, ohneQuelle: r.filter((x) => x.bewertung === "ohneQuelle").length, gesamt: r.length, tage };
}

/** Rückmeldungen, die seit der letzten Auswertung dazugekommen sind */
export const neueSeit = (st: LernStand, stepId: string) => {
  const ab = Date.parse(st.letzteAuswertung[stepId] ?? "") || 0;
  return st.rueckmeldungen.filter((x) => x.stepId === stepId && Date.parse(x.zeit) > ab);
};

/* ---------- Auswertung ---------- */
export function auswertungsPrompt(app: Pick<App, "name">, step: Pick<Step, "name" | "rolle" | "hausregeln">, r: Rueckmeldung[]): string {
  const zeilen = r.slice(-80).map((x, i) => `${i + 1}. [${x.bewertung === "gut" ? "hilfreich" : x.bewertung === "schlecht" ? "nicht hilfreich" : "ohne Fundstelle"}] Frage: ${x.frage.replace(/\s+/g, " ").slice(0, 300)}${x.antwort ? `\n   Antwort: ${x.antwort.replace(/\s+/g, " ").slice(0, 300)}` : ""}${x.kommentar ? `\n   Kommentar: ${x.kommentar.replace(/\s+/g, " ")}` : ""}`).join("\n");
  return `Du wertest Rückmeldungen zu einem Fachexperten-Chat aus und schlägst Ergänzungen für seinen Hausregeln-Block vor. Die Applikation heißt „${app.name}“, der Experte „${step.name}“.

Rolle des Experten (fest, darf nicht geändert werden, nur zur Einordnung):
"""${step.rolle.slice(0, 3000)}"""

Bisherige Hausregeln (gelten schon):
"""${hausregelnText(step) || "(noch keine)"}"""

Rückmeldungen der Kolleginnen und Kollegen (${r.length}):
${zeilen || "(keine)"}

Regeln für deine Vorschläge:
- Vier Arten: "glossar" = interner Begriff oder Abkürzung als fertiger Satz in "text"; "hausregel" = Hinweis zu Tonfall, Länge oder Zielgruppe als fertiger Satz in "text"; "faq" = eine wiederkehrende Frage, deren Antwort in den Rückmeldungen als hilfreich bewertet wurde: "frage" kurz und allgemein formuliert, "antwort" wörtlich aus der hilfreichen Antwort übernommen, samt Quellenangabe ("text" leer); "quelle" = Unterlage, die fehlt (Fragen ohne Fundstelle), in "text" als „Unterlage ergänzen: …“. Erfinde keine Antworten.
- Nichts, was die Rolle oder die Belegregel ändert. Kurz, konkret, ohne Namen von Personen.
- Höchstens 6 Vorschläge, die wichtigsten zuerst; nichts vorschlagen, was in den bisherigen Hausregeln schon steht.
- "belege" = wie viele Rückmeldungen den Vorschlag stützen.

Antworte nur mit JSON: {"zusammenfassung": "zwei Sätze, was auffällt", "vorschlaege": [{"art": "hausregel"|"glossar"|"faq"|"quelle", "text": "", "frage": "", "antwort": "", "begruendung": "ein Satz", "belege": 1}]}`;
}

/** Vorschläge aus der KI-Antwort lesen (tolerant gegenüber Text vor und nach dem JSON) */
export function vorschlaegeAus(antwort: string, stepId: string): { zusammenfassung: string; vorschlaege: Vorschlag[] } {
  const j = jsonAus(antwort) as { zusammenfassung?: unknown; vorschlaege?: unknown };
  const liste = Array.isArray(j.vorschlaege) ? j.vorschlaege : [];
  const vorschlaege = liste.flatMap((v): Vorschlag[] => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    const art = (["hausregel", "glossar", "faq", "quelle"] as const).find((a) => a === String(o.art ?? "").toLowerCase()) ?? "hausregel";
    const text = String(o.text ?? "").trim(), frage = String(o.frage ?? "").trim(), antwort = String(o.antwort ?? "").trim();
    if (art === "faq" ? !(frage && antwort) : !text) return [];
    return [vorschlagAnlegen(stepId, { art, text, frage, antwort, begruendung: String(o.begruendung ?? ""), belege: Math.max(0, Math.min(999, Number(o.belege) || 0)), herkunft: "auswertung" })];
  }).slice(0, 6);
  return { zusammenfassung: String(j.zusammenfassung ?? "").slice(0, 600), vorschlaege };
}

/** Neue Vorschläge in den Stand einarbeiten: offene aus der vorigen Auswertung werden ersetzt, entschiedene und im Chat vorgeschlagene bleiben (begrenzt) */
export function auswertungEinarbeiten(st: LernStand, stepId: string, erg: { zusammenfassung: string; vorschlaege: Vorschlag[] }): LernStand {
  const alte = st.vorschlaege.filter((v) => !(v.stepId === stepId && v.stand === "offen" && (v.herkunft ?? "auswertung") === "auswertung")).slice(-100);
  return { ...st, vorschlaege: [...alte, ...erg.vorschlaege], letzteAuswertung: { ...st.letzteAuswertung, [stepId]: new Date().toISOString() }, zusammenfassung: { ...st.zusammenfassung, [stepId]: erg.zusammenfassung } };
}
