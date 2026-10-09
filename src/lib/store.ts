/**
 * Speicher für Applikationen.
 * - "local": im Browser (für Tests und Einzelplätze)
 * - "sharepoint": eine JSON-Datei je App in einer SharePoint-Bibliothek über Microsoft Graph,
 *   damit alle Mitarbeitenden dieselben Apps sehen.
 *   TODO: Website, Ordner und Schreibrechte (z. B. Sites.ReadWrite.All oder Sites.Selected) mit der IT festlegen.
 */
import type { App } from "./schema";
import { loadApp } from "./sanitize";
import { KI_CONFIG } from "./ki/config";
import { graphToken } from "./ki/auth";

export interface AppStore {
  readonly name: string;
  list(): Promise<App[]>;
  save(app: App): Promise<void>;
  remove(id: string): Promise<void>;
}

const LS_KEY = "kihub-apps-v3";

class LocalStore implements AppStore {
  readonly name = "Dieser Browser";
  private read(): unknown[] {
    try { const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  private write(apps: App[]) { localStorage.setItem(LS_KEY, JSON.stringify(apps)); }
  async list() { return this.read().map(loadApp).filter((a): a is App => !!a && !!a.id); }
  async save(app: App) {
    const all = await this.list();
    const i = all.findIndex((a) => a.id === app.id);
    if (i >= 0) all[i] = app; else all.push(app);
    this.write(all);
  }
  async remove(id: string) { this.write((await this.list()).filter((a) => a.id !== id)); }
}

class SharePointStore implements AppStore {
  readonly name = "SharePoint";
  private base = () => `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(KI_CONFIG.spSiteId)}/drive/root:/${KI_CONFIG.spOrdner.split("/").map(encodeURIComponent).join("/")}`;
  private async req(url: string, init: RequestInit = {}) {
    const token = await graphToken();
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    if (!res.ok && res.status !== 404) throw new Error(`SharePoint antwortet mit Fehler ${res.status}.`);
    return res;
  }
  async list() {
    const res = await this.req(`${this.base()}:/children?$select=name,@microsoft.graph.downloadUrl&$top=500`);
    if (res.status === 404) return [];
    const data = (await res.json()) as { value?: { name: string; "@microsoft.graph.downloadUrl"?: string }[] };
    const files = (data.value ?? []).filter((f) => f.name.endsWith(".json") && f["@microsoft.graph.downloadUrl"]);
    const apps = await Promise.all(files.map(async (f) => {
      try { return loadApp(await (await fetch(f["@microsoft.graph.downloadUrl"]!)).json()); } catch { return null; }
    }));
    return apps.filter((a): a is App => !!a && !!a.id);
  }
  async save(app: App) {
    await this.req(`${this.base()}/${encodeURIComponent(app.id!)}.json:/content`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app),
    });
  }
  async remove(id: string) {
    await this.req(`${this.base()}/${encodeURIComponent(id)}.json`, { method: "DELETE" });
  }
}

export const appStore: AppStore = KI_CONFIG.store === "sharepoint" && KI_CONFIG.spSiteId ? new SharePointStore() : new LocalStore();
