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
/** Git-Speicher: JSON-Dateien im Repository, mit der Seite veröffentlicht; Schreiben über die GitHub-API mit persönlichem Token */
export type GitKonfig = { repo: string; branch: string; pfad: string };
export type SpeicherKonfig = { art: "lokal" } | { art: "sharepoint"; ordner: string; quelle: SpeicherQuelle } | ({ art: "github"; quelle: SpeicherQuelle } & GitKonfig);
const LS_TOKEN = "kihub-github-token";

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
  try { const alt = browserGit(); if (ordner?.trim() || alt) localStorage.setItem(LS, JSON.stringify({ ...(ordner?.trim() ? { ordner: ordner.trim() } : {}), ...(alt ? { git: alt } : {}) })); else localStorage.removeItem(LS); } catch { /* gesperrt */ }
  konfig = null; ort = null;
}
/** Im Browser eingetragener Git-Speicher (zum Testen, bevor er in hub-config.json steht) */
export function browserGit(): GitKonfig | null {
  try { const g = (JSON.parse(localStorage.getItem(LS) || "{}") as { git?: Partial<GitKonfig> }).git; return g?.repo?.trim() ? gitNorm(g) : null; } catch { return null; }
}
export function browserGitSetzen(g: GitKonfig | null) {
  try { const ordner = browserOrdner(); if (g?.repo.trim() || ordner) localStorage.setItem(LS, JSON.stringify({ ...(ordner ? { ordner } : {}), ...(g?.repo.trim() ? { git: gitNorm(g) } : {}) })); else localStorage.removeItem(LS); } catch { /* gesperrt */ }
  konfig = null; ort = null;
}
const gitNorm = (g: Partial<GitKonfig>): GitKonfig => ({ repo: (g.repo ?? "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, ""), branch: (g.branch ?? "").trim() || "main", pfad: ((g.pfad ?? "").trim() || "public/hub-daten").replace(/^\/+|\/+$/g, "") });
/** Persönlicher GitHub-Token (nur dieser Browser); ohne Token ist der Git-Speicher nur lesbar */
export function gitToken(): string { try { return localStorage.getItem(LS_TOKEN)?.trim() ?? ""; } catch { return ""; } }
export function gitTokenSetzen(t: string | null) { try { if (t?.trim()) localStorage.setItem(LS_TOKEN, t.trim()); else localStorage.removeItem(LS_TOKEN); } catch { /* gesperrt */ } }

/** Wirksame Speicher-Konfiguration (einmal geladen, danach zwischengespeichert) */
export function speicherKonfig(): Promise<SpeicherKonfig> {
  return (konfig ??= (async (): Promise<SpeicherKonfig> => {
    const b = browserOrdner();
    if (b) return { art: "sharepoint", ordner: b, quelle: "browser" };
    const bg = browserGit();
    if (bg) return { art: "github", ...bg, quelle: "browser" };
    const sp = (await hubDatei()).speicher as { ordner?: unknown; git?: Partial<GitKonfig> } | undefined;
    const o = sp?.ordner;
    if (typeof o === "string" && o.trim()) return { art: "sharepoint", ordner: o.trim(), quelle: "datei" };
    if (sp?.git && typeof sp.git === "object" && typeof sp.git.repo === "string" && sp.git.repo.trim()) return { art: "github", ...gitNorm(sp.git), quelle: "datei" };
    if (KI_CONFIG.spOrdnerUrl) return { art: "sharepoint", ordner: KI_CONFIG.spOrdnerUrl, quelle: "build" };
    return { art: "lokal" };
  })());
}

/** Lesbare Beschreibung für die Oberfläche */
export async function speicherName(): Promise<string> {
  const k = await speicherKonfig();
  return k.art === "lokal" ? "Dieser Browser" : k.art === "github" ? `GitHub (${k.repo})` : "SharePoint";
}
/** Gemeinsamer Speicher vorhanden und von diesem Browser aus beschreibbar? (Git: nur mit Token) */
export async function speicherSchreibbar(): Promise<boolean> {
  const k = await speicherKonfig();
  return k.art === "sharepoint" || (k.art === "github" && !!gitToken());
}

/* ---------- Gemeinsame Dateischicht: SharePoint-Ordner oder Git-Speicher ---------- */
/**
 * Pfade wie im SharePoint-Ordner („apps/<id>.json“, „rechte.json“). Im Git-Speicher liegt je Sammlung eine Datei
 * („apps.json“ als Objekt id → Inhalt), damit die veröffentlichte Seite sie ohne Verzeichnisliste lesen kann.
 */
export async function dateiLesen<T>(pfad: string): Promise<T | null> {
  return (await speicherKonfig()).art === "github" ? gitLesen<T>(pfad) : spLesen<T>(pfad);
}
export async function dateiSchreiben(pfad: string, daten: unknown, still = false): Promise<void> {
  return (await speicherKonfig()).art === "github" ? gitSchreiben(pfad, daten) : spSchreiben(pfad, daten, still);
}
export async function dateiLoeschen(pfad: string): Promise<void> {
  return (await speicherKonfig()).art === "github" ? gitLoeschen(pfad) : spLoeschen(pfad);
}
export async function dateienLesen(unter: string): Promise<unknown[]> {
  return (await speicherKonfig()).art === "github" ? gitAlleLesen(unter) : spAlleLesen(unter);
}

/* ---------- Git-Speicher (GitHub-Repository) ---------- */
const API = "https://api.github.com";
async function gitKonfig(): Promise<GitKonfig> {
  const k = await speicherKonfig();
  if (k.art !== "github") throw new Error("Kein Git-Speicher eingerichtet.");
  return k;
}
/** Sammlung und Schlüssel aus einem Pfad: „apps/x.json“ → apps, x; „rechte.json“ → rechte, null */
function gitZiel(pfad: string): { datei: string; schluessel: string | null } {
  const t = pfad.replace(/\.json$/i, "").split("/").filter(Boolean);
  return t.length >= 2 ? { datei: `${t[0]}.json`, schluessel: t.slice(1).join("/") } : { datei: `${t[0]}.json`, schluessel: null };
}
const utf8Base64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const base64Utf8 = (b: string) => decodeURIComponent(escape(atob(b.replace(/\n/g, ""))));
function gitFehler(status: number, was: string): Error {
  return new Error(status === 401 ? `${was}: Der GitHub-Token wird nicht akzeptiert (abgelaufen oder falsch).` : status === 403 ? `${was}: kein Zugriff auf das Repository (Token ohne Schreibrecht „Contents“ oder Limit erreicht).` : status === 404 ? `${was}: Repository, Branch oder Pfad nicht gefunden.` : `${was}: GitHub antwortet mit Fehler ${status}.`);
}
/** Datei im Repository lesen: mit Token über die API (aktuell), sonst von der veröffentlichten Seite (nach dem Deploy) */
async function gitDateiLesen(datei: string): Promise<{ inhalt: unknown; sha: string | null }> {
  const g = await gitKonfig();
  const token = gitToken();
  if (token) {
    const r = await fetch(`${API}/repos/${g.repo}/contents/${g.pfad}/${datei}?ref=${encodeURIComponent(g.branch)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (r.status === 404) return { inhalt: null, sha: null };
    if (!r.ok) throw gitFehler(r.status, "Lesen");
    const j = (await r.json()) as { content?: string; sha?: string };
    try { return { inhalt: j.content ? JSON.parse(base64Utf8(j.content)) : null, sha: j.sha ?? null }; } catch { return { inhalt: null, sha: j.sha ?? null }; }
  }
  const oeffentlich = g.pfad.replace(/^public\/?/, "");
  const r = await fetch(`${import.meta.env.BASE_URL}${oeffentlich ? `${oeffentlich}/` : ""}${datei}`, { cache: "no-store" });
  if (r.status === 404) return { inhalt: null, sha: null };
  if (!r.ok) throw gitFehler(r.status, "Lesen");
  try { return { inhalt: await r.json(), sha: null }; } catch { return { inhalt: null, sha: null }; }
}
async function gitDateiSchreiben(datei: string, inhalt: unknown, sha: string | null, nachricht: string): Promise<void> {
  const g = await gitKonfig();
  const token = gitToken();
  if (!token) throw new Error("Speichern im Git-Speicher braucht einen GitHub-Token (Verwaltung → Gemeinsamer Speicher). Ohne Token ist der Speicher nur lesbar.");
  const r = await fetch(`${API}/repos/${g.repo}/contents/${g.pfad}/${datei}`, {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message: nachricht, content: utf8Base64(JSON.stringify(inhalt, null, 2) + "\n"), branch: g.branch, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw gitFehler(r.status, "Speichern");
}
/** Eine Sammlung ändern (lesen, ändern, schreiben; bei zwischenzeitlicher Änderung einmal neu versuchen) */
async function gitSammlungAendern(datei: string, aendern: (alt: Record<string, unknown>) => Record<string, unknown> | null, nachricht: string): Promise<void> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const { inhalt, sha } = await gitDateiLesen(datei);
    const alt = inhalt && typeof inhalt === "object" && !Array.isArray(inhalt) ? (inhalt as Record<string, unknown>) : {};
    const neu = aendern(alt);
    if (!neu) return;
    try { await gitDateiSchreiben(datei, neu, sha, nachricht); return; }
    catch (e) { if (versuch === 1 || !/409|422/.test(e instanceof Error ? e.message : "")) throw e; }
  }
}
async function gitLesen<T>(pfad: string): Promise<T | null> {
  const z = gitZiel(pfad);
  const { inhalt } = await gitDateiLesen(z.datei);
  if (z.schluessel === null) return (inhalt as T) ?? null;
  const m = inhalt && typeof inhalt === "object" ? (inhalt as Record<string, unknown>) : {};
  return (m[z.schluessel] as T) ?? null;
}
async function gitSchreiben(pfad: string, daten: unknown): Promise<void> {
  const z = gitZiel(pfad);
  if (z.schluessel === null) { const { sha } = await gitDateiLesen(z.datei); await gitDateiSchreiben(z.datei, daten, sha, `Hub-Daten: ${z.datei}`); return; }
  await gitSammlungAendern(z.datei, (alt) => ({ ...alt, [z.schluessel!]: daten }), `Hub-Daten: ${pfad}`);
}
async function gitLoeschen(pfad: string): Promise<void> {
  const z = gitZiel(pfad);
  if (z.schluessel === null) { await gitSammlungAendern(z.datei, () => ({}), `Hub-Daten: ${z.datei} geleert`); return; }
  await gitSammlungAendern(z.datei, (alt) => { if (!(z.schluessel! in alt)) return null; const { [z.schluessel!]: _weg, ...rest } = alt; void _weg; return rest; }, `Hub-Daten: ${pfad} entfernt`);
}
async function gitAlleLesen(unter: string): Promise<unknown[]> {
  const { inhalt } = await gitDateiLesen(`${unter}.json`);
  return inhalt && typeof inhalt === "object" && !Array.isArray(inhalt) ? Object.values(inhalt as Record<string, unknown>) : [];
}
/** Prüft Repository und Token: Lesen über API oder Seite, Schreibrecht laut Repository-Berechtigung (ohne Probe-Commit) */
export async function gitPruefen(g: GitKonfig, token: string): Promise<{ lesen: boolean; schreiben: boolean; meldung: string }> {
  const vorher = browserGit(), vorherToken = gitToken();
  browserGitSetzen(g); gitTokenSetzen(token || null);
  try {
    try { await gitAlleLesen("apps"); } catch (e) { return { lesen: false, schreiben: false, meldung: e instanceof Error ? e.message : String(e) }; }
    if (!token) return { lesen: true, schreiben: false, meldung: "Lesen funktioniert (von der veröffentlichten Seite). Zum Schreiben einen GitHub-Token eintragen." };
    const r = await fetch(`${API}/repos/${gitNorm(g).repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) return { lesen: true, schreiben: false, meldung: gitFehler(r.status, "Schreiben").message };
    const j = (await r.json()) as { permissions?: { push?: boolean } };
    return j.permissions?.push ? { lesen: true, schreiben: true, meldung: "Lesen und Schreiben funktionieren. Jedes Speichern ist ein Commit; die Seite wird danach neu veröffentlicht (etwa eine Minute)." } : { lesen: true, schreiben: false, meldung: "Der Token darf in diesem Repository nicht schreiben (Berechtigung „Contents: Read and write“ fehlt)." };
  } finally { browserGitSetzen(vorher); gitTokenSetzen(vorherToken || null); }
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
