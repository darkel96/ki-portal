/**
 * „Mein Hub“: persönlicher Bereich je Nutzer.
 * - Apps aus dem öffentlichen Katalog übernehmen (als Verweis, nicht als Kopie)
 * - Voreinstellungen: gespeicherte Eingaben je App
 * - Aufträge: App + Voreinstellung + Zeitplan + Ziel, laufen regelmäßig
 * - Verlauf: Ergebnisse der Läufe
 *
 * Stand jetzt: Speicher im Browser, Aufträge laufen, solange der Hub geöffnet ist.
 * TODO (mit der IT): Speicher und Ausführung in einen Hintergrunddienst verlegen (z. B. Azure Function mit Zeitsteuerung),
 * Berechtigung je Nutzer über gespeichertes Refresh-Token (offline_access) in Key Vault, Nutzer-ID aus Entra ID.
 */
import { z } from "zod";
import type { App } from "./schema";
import type { FileInfo } from "./request";
import { ablaufStarten, fehlendePflichtfelder, type OutState, type Werte } from "./runner";
import { fieldsOf, rid, stepsFor } from "./model";

/* ---------- Schema ---------- */
const Iso = z.string().default("");

export const FileInfoSchema = z.object({ name: z.string(), size: z.number(), type: z.string(), text: z.string().max(200_000), geaendert: z.string().optional() });

export const VoreinstellungSchema = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string().min(1).max(80),
  werte: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  /** Dateien als bereits gelesener Text (z. B. ein festes Regelwerk) */
  dateien: z.record(z.string(), FileInfoSchema).default({}),
  erstellt: Iso,
  geaendert: Iso,
});

export const ZeitplanSchema = z.object({
  art: z.enum(["taeglich", "werktags", "woechentlich", "monatlich"]).default("woechentlich"),
  uhrzeit: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
  /** 1 = Montag … 7 = Sonntag */
  wochentag: z.number().int().min(1).max(7).default(1),
  /** Tag im Monat; 1 bis 28, damit es jeden Monat gibt */
  tag: z.number().int().min(1).max(28).default(1),
});

export const ZielSchema = z.object({
  art: z.enum(["hub", "email", "sharepoint", "teams"]).default("hub"),
  adresse: z.string().max(400).default(""),
});

export const AuftragSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  appId: z.string(),
  voreinstellungId: z.string().nullable().default(null),
  zeitplan: ZeitplanSchema.default(ZeitplanSchema.parse({})),
  ziel: ZielSchema.default(ZielSchema.parse({})),
  aktiv: z.boolean().default(true),
  naechsterLauf: Iso,
  letzterLauf: Iso,
  erstellt: Iso,
});

export const LaufSchema = z.object({
  id: z.string(),
  auftragId: z.string().nullable().default(null),
  appId: z.string(),
  appName: z.string().default(""),
  titel: z.string().default(""),
  voreinstellungId: z.string().nullable().default(null),
  start: Iso,
  ende: Iso,
  status: z.enum(["laeuft", "fertig", "fehler", "abgebrochen"]).default("laeuft"),
  meldung: z.string().default(""),
  /** Ergebnis je Schritt (Status, Text, Meldung); Anfrage und Team-Verlauf werden nicht gespeichert */
  ergebnisse: z.record(z.string(), z.object({ status: z.string(), text: z.string().optional(), meldung: z.string().optional(), key: z.string().optional(), name: z.string().optional() })).default({}),
});

export const MeinHubSchema = z.object({
  v: z.literal(1).default(1),
  /** Nutzer-ID; später die Objekt-ID aus Entra ID */
  nutzer: z.string().default("lokal"),
  pins: z.array(z.object({ appId: z.string(), seit: Iso })).default([]),
  voreinstellungen: z.array(VoreinstellungSchema).default([]),
  auftraege: z.array(AuftragSchema).default([]),
  laeufe: z.array(LaufSchema).default([]),
  /** Fällige Aufträge automatisch ausführen, solange der Hub geöffnet ist */
  automatisch: z.boolean().default(true),
});

export type Voreinstellung = z.output<typeof VoreinstellungSchema>;
export type Zeitplan = z.output<typeof ZeitplanSchema>;
export type Ziel = z.output<typeof ZielSchema>;
export type Auftrag = z.output<typeof AuftragSchema>;
export type Lauf = z.output<typeof LaufSchema>;
export type MeinHub = z.output<typeof MeinHubSchema>;

export const ZIEL_LABEL: Record<Ziel["art"], string> = {
  hub: "Im Verlauf von Mein Hub ablegen",
  email: "Per E-Mail an mich",
  sharepoint: "In einen SharePoint-Ordner ablegen",
  teams: "In einen Teams-Kanal posten",
};
/** Ziele, die erst mit dem Hintergrunddienst (Microsoft Graph) möglich sind */
export const ZIEL_SPAETER = new Set<Ziel["art"]>(["email", "sharepoint", "teams"]);
export const WOCHENTAG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/* ---------- Zeitplan ---------- */
/** Nächster Zeitpunkt nach `ab` (lokale Zeit). */
export function naechsterLauf(z: Zeitplan, ab = new Date()): Date {
  const [h, m] = z.uhrzeit.split(":").map(Number);
  const t = new Date(ab);
  t.setSeconds(0, 0);
  t.setHours(h, m);
  const passt = (d: Date) => {
    const wt = d.getDay() === 0 ? 7 : d.getDay();
    if (z.art === "werktags") return wt <= 5;
    if (z.art === "woechentlich") return wt === z.wochentag;
    if (z.art === "monatlich") return d.getDate() === z.tag;
    return true;
  };
  for (let i = 0; i < 400; i++) {
    if (t > ab && passt(t)) return t;
    t.setDate(t.getDate() + 1);
    t.setHours(h, m, 0, 0);
  }
  return t;
}

export function zeitplanText(z: Zeitplan): string {
  if (z.art === "taeglich") return `täglich um ${z.uhrzeit} Uhr`;
  if (z.art === "werktags") return `werktags um ${z.uhrzeit} Uhr`;
  if (z.art === "woechentlich") return `jeden ${WOCHENTAG[z.wochentag - 1]} um ${z.uhrzeit} Uhr`;
  return `am ${z.tag}. jedes Monats um ${z.uhrzeit} Uhr`;
}

export const datumZeit = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

/* ---------- Speicher ---------- */
export interface MeinHubSpeicher {
  laden(nutzer: string): Promise<MeinHub>;
  speichern(d: MeinHub): Promise<void>;
}

const MAX_LAEUFE = 40;
const lsKey = (nutzer: string) => `kihub-meinhub-v1:${nutzer}`;

/** Browser-Speicher. Wird es zu voll, fallen die ältesten Läufe weg. */
export class LokalerMeinHubSpeicher implements MeinHubSpeicher {
  async laden(nutzer: string): Promise<MeinHub> {
    let roh: unknown = {};
    try { roh = JSON.parse(localStorage.getItem(lsKey(nutzer)) || "{}"); } catch { /* leer */ }
    const r = MeinHubSchema.safeParse({ ...(roh as object), nutzer });
    const d = r.success ? r.data : MeinHubSchema.parse({ nutzer });
    // Läufe, die beim Schließen des Fensters noch liefen, gelten als abgebrochen.
    d.laeufe = d.laeufe.map((l) => (l.status === "laeuft" ? { ...l, status: "abgebrochen" as const, meldung: Object.keys(l.ergebnisse).length ? "Abgebrochen, weil der Hub geschlossen wurde. Die bis dahin fertigen Ergebnisse sind gespeichert." : "Abgebrochen, weil der Hub geschlossen wurde." } : l));
    return d;
  }
  async speichern(d: MeinHub): Promise<void> {
    const kopie = { ...d, laeufe: d.laeufe.slice(0, MAX_LAEUFE) };
    for (;;) {
      try { localStorage.setItem(lsKey(d.nutzer), JSON.stringify(kopie)); return; } catch (e) {
        if (!kopie.laeufe.length) throw e;
        kopie.laeufe = kopie.laeufe.slice(0, -1);
      }
    }
  }
}

/* ---------- Ausführung ohne Bildschirm ---------- */
export const neueId = (p: string) => rid(p);

/** Führt alle Schritte einer App mit den Werten einer Voreinstellung aus und liefert den fertigen Lauf. */
export async function ausfuehren(opts: {
  app: App; vorlage: Voreinstellung | null; auftrag: Auftrag | null; signal: AbortSignal;
  onUpdate?: (l: Lauf) => void;
}): Promise<Lauf> {
  const { app, vorlage, auftrag, signal } = opts;
  const lauf: Lauf = LaufSchema.parse({
    id: neueId("l"), auftragId: auftrag?.id ?? null, appId: app.id ?? "", appName: app.name,
    titel: auftrag?.name || vorlage?.name || app.name, voreinstellungId: vorlage?.id ?? null, start: new Date().toISOString(),
  });
  const werte: Werte = { ...(vorlage?.werte ?? {}) };
  const files: Record<string, FileInfo> = { ...(vorlage?.dateien ?? {}) };
  const steps = stepsFor(app, "alle");
  const fehlend = fehlendePflichtfelder(app, steps, werte, files);
  if (fehlend.length) {
    const namen = fieldsOf(app).filter((f) => fehlend.includes(f.props.key)).map((f) => f.props.label);
    return { ...lauf, status: "fehler", ende: new Date().toISOString(), meldung: `In der Voreinstellung fehlen Pflichtfelder: ${namen.join(", ")}.` };
  }
  const outs: Record<string, OutState> = {};
  const melden = () => opts.onUpdate?.({ ...lauf, ergebnisse: kurz(outs, app) });
  try {
    await ablaufStarten({
      app, aktion: "alle", werte, files, ergebnisse: {}, signal,
      setOut: (id, s) => { outs[id] = typeof s === "function" ? s(outs[id]) : s; melden(); },
    });
  } catch (e) {
    return { ...lauf, status: "fehler", ende: new Date().toISOString(), meldung: e instanceof Error ? e.message : "Der Lauf ist fehlgeschlagen.", ergebnisse: kurz(outs, app) };
  }
  const st = Object.values(outs).map((o) => o.status);
  const status = signal.aborted ? "abgebrochen" : st.includes("fehler") ? "fehler" : "fertig";
  return { ...lauf, status, ende: new Date().toISOString(), ergebnisse: kurz(outs, app), meldung: status === "fehler" ? "Mindestens ein Schritt ist fehlgeschlagen." : "" };
}

/** Nur das Nötige speichern, Texte begrenzen. */
export function kurz(outs: Record<string, OutState>, app: App): Lauf["ergebnisse"] {
  const r: Lauf["ergebnisse"] = {};
  for (const [id, o] of Object.entries(outs)) {
    const text = o.status === "simuliert" ? o.req?.nachricht : o.text;
    const step = app.steps.find((s) => s.id === id);
    r[id] = { status: o.status, text: text ? text.slice(0, 60_000) : undefined, meldung: o.meldung, key: step?.key, name: step?.name };
  }
  return r;
}
