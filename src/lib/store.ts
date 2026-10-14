/**
 * Speicher für Applikationen: im Browser (Einzelplatz, Test) oder im gemeinsamen SharePoint-Ordner (siehe speicher.ts),
 * damit alle Mitarbeitenden dieselben Apps sehen. Welcher gilt, entscheidet die Speicher-Konfiguration bei jedem Aufruf.
 */
import type { App } from "./schema";
import { loadApp } from "./sanitize";
import { spAlleLesen, spLoeschen, spSchreiben, speicherKonfig } from "./speicher";

export interface AppStore {
  list(): Promise<App[]>;
  save(app: App): Promise<void>;
  remove(id: string): Promise<void>;
}

const LS_KEY = "kihub-apps-v3";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

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
  async remove(id: string) { this.write(this.read().filter((a) => !(isObj(a) && a.id === id))); }
}

/** Dateiname einer App: nur sichere Zeichen */
const datei = (id: string) => `apps/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

class SharePointStore implements AppStore {
  async list() { return (await spAlleLesen("apps")).map((r) => loadApp(r)).filter((a): a is App => !!a && !!a.id); }
  async save(app: App) { await spSchreiben(datei(app.id!), app); }
  async remove(id: string) { await spLoeschen(datei(id)); }
}

/** Apps im Browser; für die Übernahme in den gemeinsamen Speicher */
export const lokalerAppStore = new LocalStore();
const spStore = new SharePointStore();
const aktiv = async (): Promise<AppStore> => ((await speicherKonfig()).art === "sharepoint" ? spStore : lokalerAppStore);

export const appStore: AppStore = {
  list: async () => (await aktiv()).list(),
  save: async (app) => (await aktiv()).save(app),
  remove: async (id) => (await aktiv()).remove(id),
};
