/**
 * Rechte im Portal: Wer darf bauen, den KI-Assistenten nutzen, freigeben, verwalten; und je Applikation, wer sie
 * bearbeiten und wer sie nutzen darf. Die Personen kommen aus der Anmeldung (Copilot/Entra ID): Wer sich einmal
 * angemeldet hat, steht in der Liste und bekommt von der Verwaltung Rechte. Ohne Anmeldung (Simulation, eigener
 * Schlüssel) gelten keine Einschränkungen; dann lässt sich eine Testperson über localStorage „kihub-testnutzer“ setzen.
 *
 * Gespeichert wird wie die Applikationen: im Browser (Einzelplatz/Test) oder als „_rechte.json“ in der
 * SharePoint-Bibliothek der Apps, damit alle dieselben Rechte sehen.
 */
import { z } from "zod";
import type { App } from "./schema";

export const RECHTE = ["admin", "bauen", "assistent", "freigeben"] as const;
export type Recht = (typeof RECHTE)[number];
export const RECHT_LABEL: Record<Recht, [string, string]> = {
  admin: ["Verwaltung", "Alle Rechte, Personen und Rechte verwalten"],
  bauen: ["Baukasten", "Applikationen bauen und bearbeiten (eigene und freigegebene)"],
  assistent: ["KI-Assistent", "Applikationen per Beschreibung von der KI bauen lassen"],
  freigeben: ["Freigeben", "Applikationen auf „Freigegeben“ setzen"],
};

export const NutzerSchema = z.object({
  id: z.string().max(200).default(""),
  name: z.string().max(200).default(""),
  email: z.string().max(200).default(""),
  zuletzt: z.string().default(""),
  rechte: z.array(z.enum(RECHTE)).default([]),
});
export type Nutzer = z.output<typeof NutzerSchema>;
/** ausgeblendet: IDs mitgelieferter Vorlagen, die die Verwaltung aus dem Hub genommen hat (lassen sich wieder einblenden) */
export const RechteStandSchema = z.object({ nutzer: z.array(NutzerSchema).default([]), ausgeblendet: z.array(z.string().max(80)).default([]) });
export type RechteStand = z.output<typeof RechteStandSchema>;

/** Angemeldete Person (aus Entra ID oder Testperson) */
export type Identitaet = { id: string; name: string; email: string };

/** Fest eingetragene Administration: Build-Variable VITE_ADMINS (E-Mails, mit Komma), sonst die Pilotleitung */
const env = import.meta.env as Record<string, string | undefined>;
export const ADMINS: string[] = (env.VITE_ADMINS ?? "dario.keller@koerber.com").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const istFesterAdmin = (email: string) => ADMINS.includes(email.trim().toLowerCase());

const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Feste Rechte je E-Mail aus public/hub-config.json („rechte“): gelten in jedem Browser, auch ohne gemeinsamen Speicher */
export type FesteRechte = Record<string, Recht[]>;
export function festeRechteAus(roh: unknown): FesteRechte {
  const out: FesteRechte = {};
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return out;
  for (const [email, liste] of Object.entries(roh as Record<string, unknown>)) {
    const r = Array.isArray(liste) ? liste.filter((x): x is Recht => (RECHTE as readonly string[]).includes(x as string)) : [];
    if (email.includes("@") && r.length) out[email.trim().toLowerCase()] = r;
  }
  return out;
}
export async function festeRechteLaden(): Promise<FesteRechte> {
  const { hubDatei } = await import("./speicher");
  return festeRechteAus((await hubDatei()).rechte);
}

/** Wirksame Rechte einer Person: feste Administration und „admin“ haben alles; ohne Anmeldung gilt keine Einschränkung */
export function rechteVon(ich: Identitaet | null, stand: RechteStand, fest: FesteRechte = {}): Set<Recht> {
  if (!ich) return new Set(RECHTE);
  const eintrag = stand.nutzer.find((n) => (n.id && n.id === ich.id) || (n.email && gleich(n.email, ich.email)));
  const r = new Set<Recht>([...(eintrag?.rechte ?? []), ...(fest[ich.email.trim().toLowerCase()] ?? [])]);
  if (istFesterAdmin(ich.email) || r.has("admin")) return new Set(RECHTE);
  return r;
}

type AppRechte = Pick<App, "rechte" | "erstelltVon">;
/** Darf die Person diese Applikation bearbeiten (und löschen)? Besitz, Eintrag in „bearbeiten“ oder Verwaltung */
export function darfAppBearbeiten(app: AppRechte, ich: Identitaet | null, rechte: Set<Recht>): boolean {
  if (rechte.has("admin")) return true;
  if (!rechte.has("bauen")) return false;
  if (!ich) return true;
  if (app.erstelltVon && gleich(app.erstelltVon, ich.email)) return true;
  if (app.rechte.bearbeiten.some((e) => gleich(e, ich.email))) return true;
  // Ohne Besitz und ohne Liste (ältere Apps) darf jede Person mit Baukasten-Recht
  return !app.erstelltVon && app.rechte.bearbeiten.length === 0;
}
/** Darf die Person diese Applikation nutzen? Leere Liste = alle */
export function darfAppNutzen(app: AppRechte, ich: Identitaet | null, rechte: Set<Recht>): boolean {
  if (rechte.has("admin") || !ich) return true;
  if (app.rechte.nutzen.length === 0) return true;
  if (app.rechte.nutzen.some((e) => gleich(e, ich.email))) return true;
  return darfAppBearbeiten(app, ich, rechte);
}

/* ---------- Speicher ---------- */
/** Anmeldung einer Person (je Person eine eigene Datei bzw. ein Eintrag; so überschreibt keine Anmeldung die Rechte) */
export type Anmeldung = { id: string; name: string; email: string; zuletzt: string };

interface RechteStore {
  laden(): Promise<RechteStand>;
  speichern(s: RechteStand): Promise<void>;
  vermerken(ich: Identitaet): Promise<void>;
  anmeldungen(): Promise<Anmeldung[]>;
}
const LS_KEY = "kihub-rechte";
const LS_ANM = "kihub-anmeldungen";
const heute = () => new Date().toISOString().slice(0, 10);

class LokalerRechteStore implements RechteStore {
  async laden() { try { return RechteStandSchema.parse(JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch { return { nutzer: [], ausgeblendet: [] }; } }
  async speichern(s: RechteStand) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
  async anmeldungen(): Promise<Anmeldung[]> { try { const v = JSON.parse(localStorage.getItem(LS_ANM) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
  async vermerken(ich: Identitaet) {
    const liste = await this.anmeldungen();
    const i = liste.findIndex((n) => n.id === ich.id || gleich(n.email, ich.email));
    const eintrag = { ...ich, zuletzt: new Date().toISOString() };
    if (i >= 0 && liste[i].zuletzt.slice(0, 10) === heute() && liste[i].name === ich.name) return;
    if (i >= 0) liste[i] = eintrag; else liste.push(eintrag);
    localStorage.setItem(LS_ANM, JSON.stringify(liste));
  }
}

/** Gemeinsamer Speicher (SharePoint oder Git) über die Dateischicht */
class GemeinsamerRechteStore implements RechteStore {
  async laden() { const { dateiLesen } = await import("./speicher"); return RechteStandSchema.parse((await dateiLesen("rechte.json")) ?? {}); }
  async speichern(s: RechteStand) { const { dateiSchreiben } = await import("./speicher"); await dateiSchreiben("rechte.json", s); }
  async anmeldungen(): Promise<Anmeldung[]> {
    const { dateienLesen, speicherKonfig } = await import("./speicher");
    // Im Git-Speicher bleiben Anmeldungen im Browser (jede Anmeldung wäre sonst ein Commit)
    if ((await speicherKonfig()).art === "github") return lokalerRechteStore.anmeldungen();
    return (await dateienLesen("anmeldungen")).filter((x): x is Anmeldung => !!x && typeof (x as Anmeldung).email === "string");
  }
  /** Höchstens einmal am Tag und nur still: ohne Schreibrecht bleibt die Anmeldung unvermerkt, es öffnet sich kein Fenster */
  async vermerken(ich: Identitaet) {
    const { speicherKonfig, dateiSchreiben } = await import("./speicher");
    if ((await speicherKonfig()).art === "github") return lokalerRechteStore.vermerken(ich);
    const marke = `kihub-vermerkt-${ich.email.toLowerCase()}`;
    try { if (localStorage.getItem(marke) === heute()) return; } catch { /* egal */ }
    await dateiSchreiben(`anmeldungen/${ich.email.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}.json`, { ...ich, zuletzt: new Date().toISOString() }, true);
    try { localStorage.setItem(marke, heute()); } catch { /* egal */ }
  }
}
export const lokalerRechteStore = new LokalerRechteStore();
const gemeinsamerRechteStore = new GemeinsamerRechteStore();
/** Git-Speicher ohne Token: gemeinsame Rechte gelten (gelesen), eigene Änderungen bleiben im Browser */
class GemischterRechteStore implements RechteStore {
  async laden() {
    const [gem, lok] = await Promise.all([gemeinsamerRechteStore.laden().catch(() => ({ nutzer: [], ausgeblendet: [] } as RechteStand)), lokalerRechteStore.laden()]);
    const nutzer = [...gem.nutzer];
    for (const n of lok.nutzer) {
      const i = nutzer.findIndex((x) => gleich(x.email, n.email));
      if (i < 0) nutzer.push(n); else nutzer[i] = { ...nutzer[i], rechte: [...new Set([...nutzer[i].rechte, ...n.rechte])] };
    }
    return { nutzer, ausgeblendet: [...new Set([...gem.ausgeblendet, ...lok.ausgeblendet])] };
  }
  speichern(s: RechteStand) { return lokalerRechteStore.speichern(s); }
  anmeldungen() { return lokalerRechteStore.anmeldungen(); }
  vermerken(ich: Identitaet) { return lokalerRechteStore.vermerken(ich); }
}
const gemischterRechteStore = new GemischterRechteStore();
const aktiv = async (): Promise<RechteStore> => {
  const { speicherKonfig, speicherSchreibbar } = await import("./speicher");
  const k = await speicherKonfig();
  if (k.art === "lokal") return lokalerRechteStore;
  return (await speicherSchreibbar()) ? gemeinsamerRechteStore : gemischterRechteStore;
};
/** Läuft der Hub-Dienst, vermerkt er die Anmeldungen aller Personen (sonst sähe die Verwaltung im Git-Speicher nur den eigenen Browser) */
const mitDienst = async () => {
  try {
    const d = await import("./dienst");
    const i = await d.dienstAktiv();
    if (!i) return null;
    // Nur mit vorhandener Anmeldung (sonst öffnete der Token-Abruf beim Laden ein Anmeldefenster)
    if (!i.testmodus && !(await (await import("./ki/auth")).aktuellesKonto())) return null;
    return d;
  } catch { return null; }
};
const MARKE_DIENST = "kihub-dienst-vermerkt";
export const rechteStore: RechteStore = {
  laden: async () => (await aktiv()).laden(),
  speichern: async (s) => (await aktiv()).speichern(s),
  vermerken: async (ich) => {
    await (await aktiv()).vermerken(ich);
    const d = await mitDienst();
    if (!d) return;
    // Höchstens einmal in der Stunde; jeder andere Aufruf des Dienstes vermerkt ohnehin mit
    const marke = `${ich.email.toLowerCase()}|${new Date().toISOString().slice(0, 13)}`;
    try { if (localStorage.getItem(MARKE_DIENST) === marke) return; } catch { /* egal */ }
    await d.anmeldungMelden();
    try { localStorage.setItem(MARKE_DIENST, marke); } catch { /* egal */ }
  },
  anmeldungen: async () => {
    const eigene = await (await aktiv()).anmeldungen();
    const d = await mitDienst();
    const vomDienst = d ? await d.personenHolen().catch((e) => { console.warn("Personenliste vom Dienst nicht geladen:", e); return []; }) : [];
    // Je Person der jüngste Stand
    const aus = new Map<string, Anmeldung>();
    for (const a of [...vomDienst, ...eigene]) {
      const k = a.email.trim().toLowerCase(), alt = aus.get(k);
      if (!alt || a.zuletzt > alt.zuletzt) aus.set(k, { ...a, name: a.name || alt?.name || "" });
    }
    return [...aus.values()];
  },
};

/** Personenliste der Verwaltung: Einträge mit Rechten plus alle, die sich angemeldet haben; „zuletzt“ aus der Anmeldung */
export function personenListe(stand: RechteStand, anm: Anmeldung[], fest: FesteRechte = {}): Nutzer[] {
  const aus: Nutzer[] = stand.nutzer.map((n) => {
    const a = anm.find((x) => (n.id && x.id === n.id) || gleich(x.email, n.email));
    return a ? { ...n, id: n.id || a.id, name: a.name || n.name, zuletzt: a.zuletzt > n.zuletzt ? a.zuletzt : n.zuletzt } : n;
  });
  for (const a of anm) if (!aus.some((n) => (n.id && n.id === a.id) || gleich(n.email, a.email))) aus.push({ id: a.id, name: a.name, email: a.email, zuletzt: a.zuletzt, rechte: [] });
  for (const email of Object.keys(fest)) if (!aus.some((n) => gleich(n.email, email))) aus.push({ id: "", name: "", email, zuletzt: "", rechte: [] });
  return aus;
}

/** Angemeldete Person; ohne Copilot-Anmeldung eine Testperson aus localStorage „kihub-testnutzer“ ({id, name, email}) */
export async function identitaetLaden(): Promise<Identitaet | null> {
  try {
    const { aktuellesKonto } = await import("./ki/auth");
    const k = await aktuellesKonto();
    if (k) return { id: k.localAccountId || k.homeAccountId, name: k.name || k.username, email: k.username };
  } catch { /* keine Anmeldung */ }
  try {
    const t = JSON.parse(localStorage.getItem("kihub-testnutzer") || "null") as Partial<Identitaet> | null;
    if (t?.email) return { id: t.id || t.email, name: t.name || t.email, email: t.email };
  } catch { /* kein Testnutzer */ }
  return null;
}
