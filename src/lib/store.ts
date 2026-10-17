/**
 * Speicher für Applikationen: im Browser (Einzelplatz, Test) oder im gemeinsamen SharePoint-Ordner (siehe speicher.ts),
 * damit alle Mitarbeitenden dieselben Apps sehen. Welcher gilt, entscheidet die Speicher-Konfiguration bei jedem Aufruf.
 */
import type { App } from "./schema";
import { loadApp } from "./sanitize";
import { spAlleLesen, spLoeschen, spSchreiben, speicherKonfig } from "./speicher";

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
}

/** Dateiname einer App: nur sichere Zeichen */
const datei = (id: string) => `apps/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

const korbDatei = (id: string) => `papierkorb/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

class SharePointStore implements AppStore {
  async list() { return (await spAlleLesen("apps")).map((r) => loadApp(r)).filter((a): a is App => !!a && !!a.id); }
  async save(app: App) { await spSchreiben(datei(app.id!), app); }
  async remove(id: string) {
    const app = (await this.list()).find((a) => a.id === id);
    if (app) await spSchreiben(korbDatei(id), { app, geloescht: new Date().toISOString() } satisfies Geloescht);
    await spLoeschen(datei(id));
  }
  async papierkorb() { return (await spAlleLesen("papierkorb")).map(geloeschtLesen).filter((g): g is Geloescht => !!g && frisch(g)); }
  async wiederherstellen(id: string) {
    const g = (await this.papierkorb()).find((x) => x.app.id === id);
    if (!g) return null;
    await this.save(g.app);
    await spLoeschen(korbDatei(id));
    return g.app;
  }
  async entsorgen(id: string) { await spLoeschen(korbDatei(id)); }
}

/** Apps im Browser; für die Übernahme in den gemeinsamen Speicher */
export const lokalerAppStore = new LocalStore();
const spStore = new SharePointStore();
const aktiv = async (): Promise<AppStore> => ((await speicherKonfig()).art === "sharepoint" ? spStore : lokalerAppStore);

export const appStore: AppStore = {
  list: async () => (await aktiv()).list(),
  save: async (app) => (await aktiv()).save(app),
  remove: async (id) => (await aktiv()).remove(id),
  papierkorb: async () => (await aktiv()).papierkorb(),
  wiederherstellen: async (id) => (await aktiv()).wiederherstellen(id),
  entsorgen: async (id) => (await aktiv()).entsorgen(id),
};
