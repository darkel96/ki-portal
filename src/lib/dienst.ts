/**
 * Hub-Dienst (server/): führt Läufe und Aufträge aus, auch wenn im Browser kein Tab mehr offen ist.
 * Der Hub spricht ihn über /api an und holt sich dafür ein Token für die Berechtigung des Dienstes.
 *
 * Adresse des Dienstes, in dieser Reihenfolge: im Browser eingetragen (Testen), hub-config.json „dienst.url“
 * („/“ = derselbe Ursprung, wenn der Dienst den Hub ausliefert), Build-Umgebung VITE_DIENST_URL. Leer = kein
 * Dienst, dann läuft alles wie bisher im Browser.
 */
import { graphToken } from "./ki/auth";
import { kiModus } from "./ki";
import { hubDatei } from "./speicher";
import type { OutState, Werte } from "./runner";
import type { FileInfo } from "./request";
import type { App, Step } from "./schema";
import type { Auftrag, Lauf, Voreinstellung, Ziel } from "./meinhub";
import type { LernStand, Rueckmeldung, Vorschlag } from "./lernen";

const LS_URL = "kihub-dienst-url";
const LS_NUTZER = "kihub-dienst-nutzer";

/** hubDaten: der Dienst speichert in den Git-Speicher (eigener Token), niemand braucht einen Token im Browser */
export type DienstInfo = { url: string; version: string; testmodus: boolean; apiScope: string; clientId: string; tenantId: string; hubDaten: boolean };
export class DienstFehler extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** Im Browser eingetragene Adresse (Verwaltung, Tests); null entfernt sie */
export function dienstUrlSetzen(url: string | null) {
  try { if (url?.trim()) localStorage.setItem(LS_URL, url.trim()); else localStorage.removeItem(LS_URL); } catch { /* gesperrt */ }
  info = null;
}
export function browserDienstUrl(): string { try { return localStorage.getItem(LS_URL)?.trim() ?? ""; } catch { return ""; } }

async function adresse(): Promise<string> {
  const b = browserDienstUrl();
  const d = (await hubDatei()).dienst as { url?: unknown } | undefined;
  const konfig = typeof d?.url === "string" ? d.url.trim() : "";
  const roh = b || konfig || String(import.meta.env.VITE_DIENST_URL ?? "").trim();
  if (!roh) return "";
  try { return new URL(roh, window.location.href).href.replace(/\/+$/, ""); } catch { return ""; }
}

let info: Promise<DienstInfo | null> | null = null;
let infoZeit = 0;
/** Erreichbarer Dienst mit seinen Eckdaten; höchstens einmal pro Minute nachgefragt */
export function dienstInfo(): Promise<DienstInfo | null> {
  if (info && Date.now() - infoZeit < 60_000) return info;
  infoZeit = Date.now();
  info = (async () => {
    const url = await adresse();
    if (!url) return null;
    try {
      const r = await fetch(`${url}/api/dienst`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as Partial<DienstInfo> & { dienst?: string };
      return j?.dienst === "KI-Hub" ? { url, version: String(j.version ?? ""), testmodus: !!j.testmodus, apiScope: String(j.apiScope ?? ""), clientId: String(j.clientId ?? ""), tenantId: String(j.tenantId ?? ""), hubDaten: !!j.hubDaten } : null;
    } catch { return null; }
  })();
  return info;
}

/** Dienst nutzbar: erreichbar und die KI läuft über Copilot (oder der Dienst ist im Testmodus) */
export async function dienstAktiv(): Promise<DienstInfo | null> {
  const i = await dienstInfo();
  if (!i) return null;
  return i.testmodus || kiModus() === "copilot" ? i : null;
}

async function token(i: DienstInfo): Promise<string> {
  if (i.testmodus) {
    let n = "";
    try { n = localStorage.getItem(LS_NUTZER) ?? ""; } catch { /* gesperrt */ }
    return `test:${n || "lokal"}`;
  }
  if (!i.apiScope) throw new DienstFehler(0, "Der Hub-Dienst nennt keine Berechtigung (HUB_API_SCOPE).");
  return graphToken([i.apiScope]);
}

async function ruf<T>(pfad: string, init: RequestInit = {}): Promise<T> {
  const i = await dienstAktiv();
  if (!i) throw new DienstFehler(0, "Der Hub-Dienst ist nicht erreichbar.");
  const r = await fetch(`${i.url}/api${pfad}`, {
    ...init, cache: "no-store",
    headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: `Bearer ${await token(i)}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!r.ok) {
    let m = "";
    try { m = String(((await r.json()) as { fehler?: string }).fehler ?? ""); } catch { /* kein JSON */ }
    throw new DienstFehler(r.status, m || `Der Hub-Dienst meldet Fehler ${r.status}.`);
  }
  return (await r.json()) as T;
}

export type LaufStatus = "laeuft" | "fertig" | "fehler" | "abgebrochen";
export type DienstLaufStand =
  | { unveraendert: true; id: string; version: number; status: LaufStatus }
  | { unveraendert?: false; id: string; version: number; status: LaufStatus; meldung: string; titel: string; appId: string; appName: string; auftragId: string | null; start: string; ende: string; gesehen: boolean; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>; outs: Record<string, OutState> };
export type DienstLaufKurz = { id: string; appId: string; appName: string; titel: string; auftragId: string | null; ziel: Ziel | null; start: string; ende: string; status: LaufStatus; meldung: string; zustellung?: string; version: number; gesehen: boolean; ergebnisse: Lauf["ergebnisse"] };
export type AuftragsAbgleich = { nutzer: string; auftraege: Auftrag[]; voreinstellungen: Voreinstellung[]; appIds: string[]; stand: string };

/** Lauf im Dienst starten; die Eingaben gehen mit (Dateien als gelesener Text) */
export const laufStarten = (b: { app: App; aktion: string; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>; titel: string }) =>
  ruf<{ id: string; version: number }>("/laeufe", { method: "POST", body: JSON.stringify(b) });
/** Stand eines Laufs; mit `ab` nur, wenn es seit dieser Version etwas Neues gibt */
export const laufStand = (id: string, ab = 0, mitDateien = false) =>
  ruf<DienstLaufStand>(`/laeufe/${encodeURIComponent(id)}?ab=${ab}${mitDateien ? "&mitDateien=1" : ""}`);
/** Laufenden Lauf abbrechen bzw. fertigen Lauf aus dem Dienst löschen */
export const laufEntfernen = (id: string) => ruf<{ ok: true }>(`/laeufe/${encodeURIComponent(id)}`, { method: "DELETE" });
export const laufGesehen = (id: string) => ruf<{ ok: true }>(`/laeufe/${encodeURIComponent(id)}/gesehen`, { method: "POST" });
export const laeufeListe = (q: { app?: string; auftraege?: boolean; seit?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.app) p.set("app", q.app);
  if (q.auftraege) p.set("auftraege", "1");
  if (q.seit) p.set("seit", q.seit);
  return ruf<DienstLaufKurz[]>(`/laeufe?${p}`);
};
export const auftraegeLesen = () => ruf<AuftragsAbgleich>("/auftraege");
export const auftraegeSchreiben = (b: { auftraege: Auftrag[]; voreinstellungen: Voreinstellung[]; apps: Record<string, App> }) =>
  ruf<AuftragsAbgleich>("/auftraege", { method: "PUT", body: JSON.stringify(b) });
/** Hub-Daten über den Dienst schreiben oder löschen (Pfad wie „apps/<id>.json“); der Dienst prüft die Rechte */
export const hubDatenSchreiben = (pfad: string, daten: unknown) => ruf<{ ok: true }>(`/hub-daten/${pfad.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body: JSON.stringify(daten) });
export const hubDatenLoeschen = (pfad: string) => ruf<{ ok: true }>(`/hub-daten/${pfad.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
/** Speichert der erreichbare Dienst für alle in den Git-Speicher? */
export async function dienstSpeichertHubDaten(): Promise<boolean> { return !!(await dienstAktiv())?.hubDaten; }
export const auftragJetzt = (id: string) => ruf<{ id: string }>(`/auftraege/${encodeURIComponent(id)}/jetzt`, { method: "POST" });
/* Lernschicht: Rückmeldungen und Vorschläge liegen im Dienst, die Auswertung läuft dort (auch nach Zeitplan) */
export const lernStandHolen = (appId: string) => ruf<LernStand>(`/lernen/${encodeURIComponent(appId)}`);
export const rueckmeldungSenden = (appId: string, r: Rueckmeldung) => ruf<{ ok: true }>(`/lernen/${encodeURIComponent(appId)}/rueckmeldungen`, { method: "POST", body: JSON.stringify(r) });
export const lernenAuswerten = (appId: string, b: { stepId: string; step: Step; appName: string; intervallTage?: number }) => ruf<LernStand>(`/lernen/${encodeURIComponent(appId)}/auswerten`, { method: "POST", body: JSON.stringify(b) });
export const vorschlagEinreichenDienst = (appId: string, v: Vorschlag) => ruf<LernStand>(`/lernen/${encodeURIComponent(appId)}/vorschlaege`, { method: "POST", body: JSON.stringify(v) });
export const vorschlagSetzen = (appId: string, id: string, stand: Vorschlag["stand"]) => ruf<LernStand>(`/lernen/${encodeURIComponent(appId)}/vorschlaege/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ stand }) });

/** Gespeicherte Anmeldung im Dienst löschen (danach laufen Aufträge erst nach dem nächsten Speichern wieder) */
export const kontoLoeschen = () => ruf<{ ok: true }>("/konto", { method: "DELETE" });

/** Merkt sich je Applikation den Lauf, der im Dienst läuft, damit die App ihn beim nächsten Öffnen wieder anzeigt */
export const LAUF_MARKE = (appId: string) => `kihub-lauf:${appId}`;
export function laufMerken(appId: string, id: string | null) {
  try { if (id) localStorage.setItem(LAUF_MARKE(appId), id); else localStorage.removeItem(LAUF_MARKE(appId)); } catch { /* gesperrt */ }
}
export function gemerkterLauf(appId: string): string { try { return localStorage.getItem(LAUF_MARKE(appId)) ?? ""; } catch { return ""; } }

/** Lauf aus dem Dienst als Verlaufseintrag von Mein Hub */
export function alsLauf(k: DienstLaufKurz): Lauf {
  return { id: k.id, auftragId: k.auftragId, appId: k.appId, appName: k.appName, titel: k.titel, voreinstellungId: null, start: k.start, ende: k.ende, status: k.status, meldung: k.meldung, zustellung: k.zustellung ?? "", ergebnisse: k.ergebnisse };
}

/** Benachrichtigung des Browsers, wenn ein Lauf fertig wird, während der Tab im Hintergrund liegt */
export function benachrichtigungErlauben() {
  try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined); } catch { /* nicht verfügbar */ }
}
export function benachrichtigen(titel: string, text: string) {
  try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(titel, { body: text }); } catch { /* nicht verfügbar */ }
}
