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
import { KI_CONFIG } from "./ki/config";

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
export const RechteStandSchema = z.object({ nutzer: z.array(NutzerSchema).default([]) });
export type RechteStand = z.output<typeof RechteStandSchema>;

/** Angemeldete Person (aus Entra ID oder Testperson) */
export type Identitaet = { id: string; name: string; email: string };

/** Fest eingetragene Administration: Build-Variable VITE_ADMINS (E-Mails, mit Komma), sonst die Pilotleitung */
const env = import.meta.env as Record<string, string | undefined>;
export const ADMINS: string[] = (env.VITE_ADMINS ?? "dario.keller@koerber.com").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const istFesterAdmin = (email: string) => ADMINS.includes(email.trim().toLowerCase());

const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Wirksame Rechte einer Person: feste Administration und „admin“ haben alles; ohne Anmeldung gilt keine Einschränkung */
export function rechteVon(ich: Identitaet | null, stand: RechteStand): Set<Recht> {
  if (!ich) return new Set(RECHTE);
  const eintrag = stand.nutzer.find((n) => (n.id && n.id === ich.id) || (n.email && gleich(n.email, ich.email)));
  const r = new Set<Recht>(eintrag?.rechte ?? []);
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
const LS_KEY = "kihub-rechte";
interface RechteStore { readonly name: string; laden(): Promise<RechteStand>; speichern(s: RechteStand): Promise<void>; }

class LokalerRechteStore implements RechteStore {
  readonly name = "Dieser Browser";
  async laden() { try { return RechteStandSchema.parse(JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch { return { nutzer: [] }; } }
  async speichern(s: RechteStand) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
}
class SharePointRechteStore implements RechteStore {
  readonly name = "SharePoint";
  private url = () => `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(KI_CONFIG.spSiteId)}/drive/root:/${KI_CONFIG.spOrdner.split("/").map(encodeURIComponent).join("/")}/_rechte.json:/content`;
  async laden() {
    const { graphToken } = await import("./ki/auth");
    const r = await fetch(this.url(), { headers: { Authorization: `Bearer ${await graphToken()}` } });
    if (r.status === 404) return { nutzer: [] };
    if (!r.ok) throw new Error(`Rechte konnten nicht geladen werden (HTTP ${r.status}).`);
    return RechteStandSchema.parse(await r.json());
  }
  async speichern(s: RechteStand) {
    const { graphToken } = await import("./ki/auth");
    const r = await fetch(this.url(), { method: "PUT", headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(s) });
    if (!r.ok) throw new Error(`Rechte konnten nicht gespeichert werden (HTTP ${r.status}). Die Azure-Anwendung braucht Schreibrecht auf die Bibliothek.`);
  }
}
export const rechteStore: RechteStore = KI_CONFIG.store === "sharepoint" && KI_CONFIG.spSiteId ? new SharePointRechteStore() : new LokalerRechteStore();

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

/** Person in die Liste aufnehmen bzw. Anmeldung vermerken; liefert den neuen Stand oder null, wenn nichts zu ändern war */
export function nutzerVermerken(stand: RechteStand, ich: Identitaet): RechteStand | null {
  const jetzt = new Date().toISOString();
  const i = stand.nutzer.findIndex((n) => (n.id && n.id === ich.id) || (n.email && gleich(n.email, ich.email)));
  if (i >= 0) {
    const alt = stand.nutzer[i];
    // Nur einmal am Tag vermerken, damit nicht jeder Seitenaufruf speichert
    if (alt.id === ich.id && alt.name === ich.name && alt.zuletzt.slice(0, 10) === jetzt.slice(0, 10)) return null;
    const nutzer = [...stand.nutzer]; nutzer[i] = { ...alt, id: ich.id, name: ich.name, email: ich.email, zuletzt: jetzt };
    return { nutzer };
  }
  return { nutzer: [...stand.nutzer, { id: ich.id, name: ich.name, email: ich.email, zuletzt: jetzt, rechte: [] }] };
}
