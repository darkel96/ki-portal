/**
 * Gemeinsamer Speicher des Hubs: ein SharePoint-Ordner, in dem Applikationen, Rechte und Anmeldungen liegen, damit
 * alle Personen dasselbe sehen. Ohne Ordner bleibt alles im Browser (Einzelplatz, Test).
 *
 * Woher der Ordner kommt (erste Angabe gewinnt):
 *   1. nur dieser Browser: in der Verwaltung zum Testen eingetragen (localStorage „kihub-speicher“)
 *   2. für alle: „speicher.ordner“ in public/hub-config.json (wird mit der Seite veröffentlicht)
 *   3. für alle: Build-Variable VITE_SP_ORDNER_URL
 *
 * Aufbau des Ordners:
 *   apps/<id>.json         je Applikation eine Datei
 *   rechte.json            Rechte der Personen (schreibt nur die Verwaltung)
 *   anmeldungen/<…>.json   je Person eine Datei, die sie bei der Anmeldung selbst schreibt
 *
 * Lesen braucht nur Sites.Read.All. Schreiben braucht zusätzlich Sites.ReadWrite.All (delegiert, mit
 * Administratorzustimmung); wer in SharePoint kein Schreibrecht auf den Ordner hat, kann dort auch nichts ändern.
 * Damit setzen die SharePoint-Berechtigungen die Rechte des Hubs auch technisch durch.
 */
import { KI_CONFIG } from "./ki/config";

const GRAPH_SCHREIBEN = "https://graph.microsoft.com/Sites.ReadWrite.All";
const LS = "kihub-speicher";

export type SpeicherQuelle = "browser" | "datei" | "build";
export type SpeicherKonfig = { art: "lokal" } | { art: "sharepoint"; ordner: string; quelle: SpeicherQuelle };

let konfig: Promise<SpeicherKonfig> | null = null;
let hubDateiCache: Promise<Record<string, unknown>> | null = null;

/** public/hub-config.json (wird mit der Seite veröffentlicht und gilt für alle Browser); leer, wenn es sie nicht gibt */
export function hubDatei(): Promise<Record<string, unknown>> {
  return (hubDateiCache ??= (async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}hub-config.json`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>; }
    } catch { /* keine Datei */ }
    return {};
  })());
}

/** Im Browser zum Testen eingetragener Ordner */
export function browserOrdner(): string {
  try { return (JSON.parse(localStorage.getItem(LS) || "{}") as { ordner?: string }).ordner?.trim() ?? ""; } catch { return ""; }
}
export function browserOrdnerSetzen(ordner: string | null) {
  try { if (ordner?.trim()) localStorage.setItem(LS, JSON.stringify({ ordner: ordner.trim() })); else localStorage.removeItem(LS); } catch { /* gesperrt */ }
  konfig = null; ort = null;
}

/** Wirksame Speicher-Konfiguration (einmal geladen, danach zwischengespeichert) */
export function speicherKonfig(): Promise<SpeicherKonfig> {
  return (konfig ??= (async (): Promise<SpeicherKonfig> => {
    const b = browserOrdner();
    if (b) return { art: "sharepoint", ordner: b, quelle: "browser" };
    const o = ((await hubDatei()).speicher as { ordner?: unknown } | undefined)?.ordner;
    if (typeof o === "string" && o.trim()) return { art: "sharepoint", ordner: o.trim(), quelle: "datei" };
    if (KI_CONFIG.spOrdnerUrl) return { art: "sharepoint", ordner: KI_CONFIG.spOrdnerUrl, quelle: "build" };
    return { art: "lokal" };
  })());
}

/** Lesbare Beschreibung für die Oberfläche */
export async function speicherName(): Promise<string> {
  const k = await speicherKonfig();
  return k.art === "lokal" ? "Dieser Browser" : "SharePoint";
}

/* ---------- Zugriff auf den Ordner ---------- */
let ort: Promise<{ basis: string }> | null = null;
async function ordnerOrt(): Promise<{ basis: string }> {
  const k = await speicherKonfig();
  if (k.art !== "sharepoint") throw new Error("Kein gemeinsamer Speicher eingerichtet.");
  return (ort ??= (async () => {
    const { graphToken } = await import("./ki/auth");
    const { ordnerAufloesen } = await import("./ki/vorlagen");
    return ordnerAufloesen(k.ordner, await graphToken());
  })().catch((e) => { ort = null; throw e; }));
}
async function pfadUrl(pfad: string): Promise<string> {
  const { unterordner } = await import("./ki/vorlagen");
  return unterordner(await ordnerOrt(), pfad);
}
const leseToken = async () => (await import("./ki/auth")).graphToken();
/** Token mit Schreibrecht; interaktiv nur, wenn eine Person bewusst speichert */
async function schreibToken(still = false): Promise<string | null> {
  const auth = await import("./ki/auth");
  if (still) return auth.graphTokenStill([GRAPH_SCHREIBEN]);
  const { copilotVerbindung } = await import("./ki/config");
  try { return await auth.graphToken([...(copilotVerbindung()?.scopes ?? []), GRAPH_SCHREIBEN]); }
  catch (e) { throw new Error(`Speichern in SharePoint braucht die Berechtigung Sites.ReadWrite.All mit Administratorzustimmung (${e instanceof Error ? e.message : String(e)})`); }
}
function fehler(status: number, was: string): Error {
  return new Error(status === 403 ? `${was}: kein Zugriff auf den SharePoint-Ordner (Berechtigung in SharePoint oder Sites.ReadWrite.All fehlt).` : status === 404 ? `${was}: Ordner nicht gefunden.` : `${was}: SharePoint antwortet mit Fehler ${status}.`);
}

/** JSON-Datei lesen; null, wenn es sie nicht gibt */
export async function spLesen<T>(pfad: string): Promise<T | null> {
  const r = await fetch(`${await pfadUrl(pfad)}/content`, { headers: { Authorization: `Bearer ${await leseToken()}` }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw fehler(r.status, "Lesen");
  return (await r.json()) as T;
}
/** JSON-Datei schreiben (Ordner entstehen dabei von selbst); still = ohne Anmeldefenster, sonst Fehler */
export async function spSchreiben(pfad: string, daten: unknown, still = false): Promise<void> {
  const token = await schreibToken(still);
  if (!token) throw new Error("Kein Schreibrecht ohne Anmeldefenster.");
  const r = await fetch(`${await pfadUrl(pfad)}/content`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(daten) });
  if (!r.ok) throw fehler(r.status, "Speichern");
}
export async function spLoeschen(pfad: string): Promise<void> {
  const token = await schreibToken();
  const r = await fetch(await pfadUrl(pfad), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok && r.status !== 404) throw fehler(r.status, "Löschen");
}
/** Alle JSON-Dateien eines Unterordners mit Inhalt (leer, wenn es den Unterordner noch nicht gibt) */
export async function spAlleLesen(unter: string): Promise<unknown[]> {
  const token = await leseToken();
  const aus: unknown[] = [];
  let url: string | undefined = `${await pfadUrl(unter)}/children?$select=name,@microsoft.graph.downloadUrl&$top=500`;
  while (url) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404) return aus;
    if (!r.ok) throw fehler(r.status, "Lesen");
    const j = (await r.json()) as { value?: { name: string; "@microsoft.graph.downloadUrl"?: string }[]; "@odata.nextLink"?: string };
    const dateien = (j.value ?? []).filter((f) => f.name.endsWith(".json") && f["@microsoft.graph.downloadUrl"]);
    aus.push(...(await Promise.all(dateien.map(async (f) => { try { return await (await fetch(f["@microsoft.graph.downloadUrl"]!)).json(); } catch { return null; } }))).filter(Boolean));
    url = j["@odata.nextLink"];
  }
  return aus;
}

/** Prüft einen Ordner: auflösen, lesen, Probedatei schreiben und wieder löschen */
export async function ordnerPruefen(ordner: string): Promise<{ lesen: boolean; schreiben: boolean; meldung: string }> {
  const vorher = browserOrdner();
  browserOrdnerSetzen(ordner);
  try {
    try { await ordnerOrt(); await spAlleLesen("apps"); } catch (e) { return { lesen: false, schreiben: false, meldung: e instanceof Error ? e.message : String(e) }; }
    try {
      await spSchreiben("verbindungstest.json", { geprueft: new Date().toISOString() });
      await spLoeschen("verbindungstest.json");
      return { lesen: true, schreiben: true, meldung: "Lesen und Schreiben funktionieren." };
    } catch (e) { return { lesen: true, schreiben: false, meldung: e instanceof Error ? e.message : String(e) }; }
  } finally { browserOrdnerSetzen(vorher || null); }
}
