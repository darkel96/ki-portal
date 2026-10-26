/**
 * Speicher für Applikationen: im Browser (Einzelplatz, Test) oder im gemeinsamen SharePoint-Ordner (siehe speicher.ts),
 * damit alle Mitarbeitenden dieselben Apps sehen. Welcher gilt, entscheidet die Speicher-Konfiguration bei jedem Aufruf.
 */
import type { App } from "./schema";
import { loadApp } from "./sanitize";
import { dateiLoeschen, dateiSchreiben, dateienLesen, speicherKonfig, speicherSchreibbar } from "./speicher";

/** Gelöschte App im Papierkorb: bleibt 30 Tage, lässt sich wiederherstellen */
export type Geloescht = { app: App; geloescht: string };

export interface AppStore {
  list(): Promise<App[]>;
  save(app: App): Promise<void>;
  /** Verschiebt die App in den Papierkorb (kein endgültiges Löschen) */
  remove(id: string): Promise<void>;
  papierkorb(): Promise<Geloescht[]>;
  wiederherstellen(id: string): Promise<App | null>;
  /** Endgültig aus dem Papierkorb entfernen */
  entsorgen(id: string): Promise<void>;
}

const LS_KEY = "kihub-apps-v3";
const LS_PAPIERKORB = "kihub-papierkorb-v1";
/** So lange bleibt eine gelöschte App im Papierkorb */
export const PAPIERKORB_TAGE = 30;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const geloeschtLesen = (r: unknown): Geloescht | null => {
  if (!isObj(r)) return null;
  const app = loadApp(r.app);
  return app?.id ? { app, geloescht: typeof r.geloescht === "string" ? r.geloescht : "" } : null;
};
const frisch = (g: Geloescht) => Date.now() - (Date.parse(g.geloescht) || 0) < PAPIERKORB_TAGE * 86_400_000;

class LocalStore implements AppStore {
  private read(): unknown[] {
    try { const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  private write(apps: unknown[]) { localStorage.setItem(LS_KEY, JSON.stringify(apps)); }
  /** Eine unlesbare App wird übersprungen, die anderen bleiben erhalten. */
  async list() {
    const out: App[] = [];
    for (const r of this.read()) { const a = loadApp(r); if (a?.id) out.push(a); else console.warn("Gespeicherte Applikation übersprungen:", r); }
    return out;
  }
  // Speichern und Löschen arbeiten auf den Rohdaten, damit eine übersprungene App nicht mitgelöscht wird.
  async save(app: App) {
    const all = this.read();
    const i = all.findIndex((a) => isObj(a) && a.id === app.id);
    if (i >= 0) all[i] = app; else all.push(app);
    this.write(all);
  }
  private korbLesen(): Geloescht[] {
    try { const v = JSON.parse(localStorage.getItem(LS_PAPIERKORB) || "[]"); return Array.isArray(v) ? v.map(geloeschtLesen).filter((g): g is Geloescht => !!g && frisch(g)) : []; } catch { return []; }
  }
  private korbSchreiben(liste: Geloescht[]) { localStorage.setItem(LS_PAPIERKORB, JSON.stringify(liste)); }
  async remove(id: string) {
    const alle = this.read();
    const roh = alle.find((a) => isObj(a) && a.id === id);
    const app = roh ? loadApp(roh) : null;
    if (app) this.korbSchreiben([...this.korbLesen().filter((g) => g.app.id !== id), { app, geloescht: new Date().toISOString() }]);
    this.write(alle.filter((a) => !(isObj(a) && a.id === id)));
  }
  async papierkorb() { return this.korbLesen(); }
  async wiederherstellen(id: string) {
    const g = this.korbLesen().find((x) => x.app.id === id);
    if (!g) return null;
    await this.save(g.app);
    this.korbSchreiben(this.korbLesen().filter((x) => x.app.id !== id));
    return g.app;
  }
  async entsorgen(id: string) { this.korbSchreiben(this.korbLesen().filter((x) => x.app.id !== id)); }
  /** Aus dem Browser entfernen, ohne Papierkorb (nachdem die App im gemeinsamen Speicher liegt) */
  async vergessen(id: string) {
    const alle = this.read(), rest = alle.filter((a) => !(isObj(a) && a.id === id));
    if (rest.length !== alle.length) this.write(rest);
  }
}

/** Dateiname einer App: nur sichere Zeichen */
const datei = (id: string) => `apps/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

const korbDatei = (id: string) => `papierkorb/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

/** Gemeinsamer Speicher (SharePoint-Ordner oder Git-Speicher) über die Dateischicht */
class GemeinsamerStore implements AppStore {
  async list() { return (await dateienLesen("apps")).map((r) => loadApp(r)).filter((a): a is App => !!a && !!a.id); }
  async save(app: App) { await dateiSchreiben(datei(app.id!), app); }
  async remove(id: string) {
    const app = (await this.list()).find((a) => a.id === id);
    if (app) await dateiSchreiben(korbDatei(id), { app, geloescht: new Date().toISOString() } satisfies Geloescht);
    await dateiLoeschen(datei(id));
  }
  async papierkorb() { return (await dateienLesen("papierkorb")).map(geloeschtLesen).filter((g): g is Geloescht => !!g && frisch(g)); }
  async wiederherstellen(id: string) {
    const g = (await this.papierkorb()).find((x) => x.app.id === id);
    if (!g) return null;
    await this.save(g.app);
    await dateiLoeschen(korbDatei(id));
    return g.app;
  }
  async entsorgen(id: string) { await dateiLoeschen(korbDatei(id)); }
}

/** Apps im Browser; für die Übernahme in den gemeinsamen Speicher */
export const lokalerAppStore = new LocalStore();
const gemeinsam = new GemeinsamerStore();
/**
 * Git-Speicher ohne Token: gemeinsame Apps lesen, eigene Änderungen bleiben im Browser (Lesen gemeinsam, Schreiben
 * lokal); mit Token oder in SharePoint läuft alles über den gemeinsamen Speicher.
 */
class GemischterStore implements AppStore {
  async list() {
    const [gem, lok] = await Promise.all([gemeinsam.list().catch(() => [] as App[]), lokalerAppStore.list()]);
    const lokIds = new Set(lok.map((a) => a.id));
    return [...gem.filter((a) => !lokIds.has(a.id)), ...lok];
  }
  save(app: App) { return lokalerAppStore.save(app); }
  async remove(id: string) {
    if ((await lokalerAppStore.list()).some((a) => a.id === id)) return lokalerAppStore.remove(id);
    throw new Error("Diese Applikation liegt im gemeinsamen Git-Speicher; zum Löschen braucht dieser Browser einen GitHub-Token (Verwaltung).");
  }
  async papierkorb() { const [gem, lok] = await Promise.all([gemeinsam.papierkorb().catch(() => [] as Geloescht[]), lokalerAppStore.papierkorb()]); return [...gem, ...lok]; }
  async wiederherstellen(id: string) { return (await lokalerAppStore.wiederherstellen(id)) ?? null; }
  entsorgen(id: string) { return lokalerAppStore.entsorgen(id); }
}
const gemischt = new GemischterStore();
/**
 * Gemeinsamer Speicher, beschreibbar: Apps, die noch aus der Zeit ohne Schreibzugang im Browser liegen, bleiben
 * sichtbar und wandern beim nächsten Speichern in den gemeinsamen Speicher (dann aus dem Browser entfernt).
 */
class GemeinsamMitBrowser extends GemeinsamerStore {
  async list() {
    const [gem, lok] = await Promise.all([super.list(), lokalerAppStore.list()]);
    const ids = new Set(gem.map((a) => a.id));
    return [...gem, ...lok.filter((a) => !ids.has(a.id))];
  }
  async save(app: App) {
    await super.save(app);
    await lokalerAppStore.vergessen(app.id!);
  }
  async remove(id: string) {
    if ((await super.list()).some((a) => a.id === id)) return super.remove(id);
    return lokalerAppStore.remove(id);
  }
}
const gemeinsamMitBrowser = new GemeinsamMitBrowser();
/** Apps, die nur in diesem Browser liegen, obwohl ein beschreibbarer gemeinsamer Speicher da ist (zum Übernehmen) */
export async function appsNurImBrowser(): Promise<App[]> {
  if ((await speicherKonfig()).art === "lokal" || !(await speicherSchreibbar())) return [];
  const [gem, lok] = await Promise.all([gemeinsam.list().catch(() => [] as App[]), lokalerAppStore.list()]);
  const ids = new Set(gem.map((a) => a.id));
  return lok.filter((a) => !ids.has(a.id));
}
const aktiv = async (): Promise<AppStore> => {
  const k = await speicherKonfig();
  if (k.art === "lokal") return lokalerAppStore;
  return (await speicherSchreibbar()) ? gemeinsamMitBrowser : gemischt;
};

/**
 * Wo eine neue oder geänderte App landet: „gemeinsam“ (alle sehen sie), „browser-git“ (Git-Speicher ohne Token,
 * nur dieser Browser) oder „browser“ (kein gemeinsamer Speicher eingerichtet).
 */
export async function appSpeicherOrt(): Promise<"gemeinsam" | "browser-git" | "browser"> {
  const k = await speicherKonfig();
  if (k.art === "lokal") return "browser";
  return (await speicherSchreibbar()) ? "gemeinsam" : "browser-git";
}

export const appStore: AppStore = {
  list: async () => (await aktiv()).list(),
  save: async (app) => (await aktiv()).save(app),
  remove: async (id) => (await aktiv()).remove(id),
  papierkorb: async () => (await aktiv()).papierkorb(),
  wiederherstellen: async (id) => (await aktiv()).wiederherstellen(id),
  entsorgen: async (id) => (await aktiv()).entsorgen(id),
};
