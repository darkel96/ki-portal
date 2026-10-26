/**
 * Hub-Daten im Git-Speicher (Apps, Papierkorb, Agenten, Rechte): Der Dienst liest sie frisch aus dem Repository und
 * schreibt sie im Namen der angemeldeten Person mit seinem eigenen Token (HUB_GIT_TOKEN). So braucht niemand einen
 * GitHub-Token im Browser. Wer was schreiben darf, prüft der Dienst mit denselben Regeln wie der Hub (src/lib/rechte).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { darfAppBearbeiten, festeRechteAus, rechteVon, RECHT_LABEL, RechteStandSchema, type Identitaet, type Recht } from "@/lib/rechte";
import type { Nutzer } from "./anmeldung";
import { UMGEBUNG } from "./umgebung";

export class HubDatenFehler extends Error { constructor(public status: number, msg: string) { super(msg); } }

const ORDNER = "public/hub-daten";
/** Sammlungen (je Eintrag ein Schlüssel) und das Recht, das sie zum Schreiben brauchen; „rechte.json“ nur die Verwaltung */
const SAMMLUNG: Record<string, Recht> = { apps: "bauen", papierkorb: "bauen", agenten: "bauen" };
const EINZEL: Record<string, Recht> = { rechte: "admin" };
const MAX_EINTRAG = 2 * 1024 * 1024;

/** Der Dienst kann schreiben: Repository und Token sind eingetragen */
export const hubDatenSchreibbar = () => !!UMGEBUNG.gitRepo && !!UMGEBUNG.gitToken;

const api = (datei: string) => `${UMGEBUNG.gitApi}/repos/${UMGEBUNG.gitRepo}/contents/${ORDNER}/${datei}`;
const kopf = () => ({ Authorization: `Bearer ${UMGEBUNG.gitToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

/* ---------- Lesen (frisch, kurz zwischengespeichert) ---------- */
const cache = new Map<string, { zeit: number; text: string | null }>();
/** Datei als Text, höchstens 20 Sekunden alt; null = nicht vorhanden oder GitHub nicht erreichbar (dann gilt der Build) */
export async function hubDatenLesen(datei: string): Promise<string | null> {
  const alt = cache.get(datei);
  if (alt && Date.now() - alt.zeit < 20_000) return alt.text;
  let text: string | null = null;
  try {
    const r = UMGEBUNG.gitToken
      ? await fetch(`${api(datei)}?ref=${encodeURIComponent(UMGEBUNG.gitBranch)}`, { headers: { ...kopf(), Accept: "application/vnd.github.raw" } })
      // Öffentliches Repository ohne Token: raw-Inhalt; der Zeitstempel umgeht den Zwischenspeicher von GitHub
      : await fetch(`https://raw.githubusercontent.com/${UMGEBUNG.gitRepo}/${encodeURIComponent(UMGEBUNG.gitBranch)}/${ORDNER}/${datei}?t=${Math.floor(Date.now() / 20_000)}`);
    if (r.ok) { const t = await r.text(); JSON.parse(t); text = t; }
    else if (r.status !== 404) console.warn(`[Hub-Dienst] Hub-Daten ${datei} aus GitHub: Fehler ${r.status}, nehme den Stand aus dem Build`);
  } catch (e) { console.warn(`[Hub-Dienst] Hub-Daten ${datei} aus GitHub nicht erreichbar (${e instanceof Error ? e.message : e}), nehme den Stand aus dem Build`); }
  cache.set(datei, { zeit: Date.now(), text });
  return text;
}

/** Datei samt Sha über die API (zum Schreiben) */
async function mitSha(datei: string): Promise<{ inhalt: unknown; sha: string | null }> {
  const r = await fetch(`${api(datei)}?ref=${encodeURIComponent(UMGEBUNG.gitBranch)}`, { headers: kopf() });
  if (r.status === 404) return { inhalt: null, sha: null };
  if (!r.ok) throw new HubDatenFehler(502, `GitHub antwortet beim Lesen von ${datei} mit Fehler ${r.status}.`);
  const j = (await r.json()) as { content?: string; sha?: string };
  try { return { inhalt: j.content ? JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) : null, sha: j.sha ?? null }; }
  catch { return { inhalt: null, sha: j.sha ?? null }; }
}

/** Lesen, ändern, schreiben; ändert jemand die Datei zwischendurch, einmal neu versuchen */
async function aendern(datei: string, f: (alt: unknown) => unknown | undefined, nachricht: string): Promise<void> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const { inhalt, sha } = await mitSha(datei);
    const neu = f(inhalt);
    if (neu === undefined) return;
    const text = JSON.stringify(neu, null, 2) + "\n";
    const r = await fetch(api(datei), { method: "PUT", headers: { ...kopf(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: nachricht, content: Buffer.from(text, "utf8").toString("base64"), branch: UMGEBUNG.gitBranch, ...(sha ? { sha } : {}) }) });
    if (r.ok) { cache.set(datei, { zeit: Date.now(), text }); return; }
    if ((r.status === 409 || r.status === 422) && versuch === 0) continue;
    const meldung = await r.json().then((j: { message?: string }) => j.message ?? "").catch(() => "");
    throw new HubDatenFehler(502, r.status === 401 || r.status === 403
      ? `Der Git-Token des Dienstes darf nicht schreiben (Fehler ${r.status}; braucht „Contents: Read and write“). ${meldung}`.trim()
      : `GitHub lehnt das Speichern ab (Fehler ${r.status}). ${meldung}`.trim());
  }
}

/* ---------- Rechte ---------- */
async function festeRechte() {
  try { return festeRechteAus((JSON.parse(await readFile(join(UMGEBUNG.statisch, "hub-config.json"), "utf8")) as { rechte?: unknown }).rechte); }
  catch { return {}; }
}
async function rechteVonNutzer(ich: Identitaet): Promise<Set<Recht>> {
  const { inhalt } = await mitSha("rechte.json");
  const stand = RechteStandSchema.safeParse(inhalt ?? {});
  return rechteVon(ich, stand.success ? stand.data : { nutzer: [], ausgeblendet: [] }, UMGEBUNG.statisch ? await festeRechte() : {});
}
type AppRechte = { rechte: { bearbeiten: string[]; nutzen: string[] }; erstelltVon: string };
const appRechte = (a: unknown): AppRechte | null => {
  if (!a || typeof a !== "object") return null;
  const o = a as { rechte?: { bearbeiten?: unknown; nutzen?: unknown }; erstelltVon?: unknown };
  const liste = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is string => typeof e === "string") : []);
  return { rechte: { bearbeiten: liste(o.rechte?.bearbeiten), nutzen: liste(o.rechte?.nutzen) }, erstelltVon: typeof o.erstelltVon === "string" ? o.erstelltVon : "" };
};

/**
 * Schreibt (daten) oder löscht (daten === undefined) einen Eintrag, z. B. „apps/<id>.json“, „papierkorb/<id>.json“,
 * „agenten/<id>.json“ oder „rechte.json“. Bestehende Apps darf nur ändern oder löschen, wer sie bearbeiten darf.
 */
export async function hubDatenAendern(nutzer: Nutzer, pfad: string, daten: unknown): Promise<void> {
  if (!hubDatenSchreibbar()) throw new HubDatenFehler(503, "Der Hub-Dienst hat keinen Schreibzugang zum Git-Speicher (HUB_GIT_TOKEN fehlt).");
  const teile = pfad.replace(/\.json$/i, "").split("/").filter(Boolean);
  if (!teile.length || teile.length > 2 || teile.some((t) => !/^[A-Za-z0-9_-]{1,120}$/.test(t))) throw new HubDatenFehler(400, "Ungültiger Pfad.");
  const [sammlung, schluessel] = teile as [string, string | undefined];
  const recht = schluessel ? SAMMLUNG[sammlung] : EINZEL[sammlung];
  if (!recht) throw new HubDatenFehler(403, "Diese Datei schreibt der Dienst nicht.");
  if (daten !== undefined && (typeof daten !== "object" || daten === null || JSON.stringify(daten).length > MAX_EINTRAG)) throw new HubDatenFehler(400, "Der Inhalt ist kein gültiges Objekt oder zu groß.");
  const ich: Identitaet = { id: nutzer.id, name: nutzer.name, email: nutzer.email };
  const rechte = await rechteVonNutzer(ich);
  if (!rechte.has(recht)) throw new HubDatenFehler(403, `Dafür fehlt dir das Recht „${RECHT_LABEL[recht][0]}“. Die Verwaltung kann es dir geben.`);
  if (sammlung === "apps" || sammlung === "papierkorb") {
    // Gegen die App im Repository prüfen (nicht gegen das, was der Browser schickt)
    const { inhalt: apps } = await mitSha("apps.json");
    const { inhalt: korb } = sammlung === "papierkorb" ? await mitSha("papierkorb.json") : { inhalt: null };
    const vorhanden = appRechte((apps as Record<string, unknown> | null)?.[schluessel!]) ?? appRechte(((korb as Record<string, { app?: unknown }> | null)?.[schluessel!])?.app);
    if (vorhanden && !darfAppBearbeiten(vorhanden, ich, rechte)) throw new HubDatenFehler(403, "Diese Applikation darfst du nicht ändern. Bearbeiten dürfen die Person, die sie angelegt hat, und die unter „Freigabe“ Eingetragenen.");
    // Neue App: gehört der Person, die sie anlegt (kein fremder Name als Besitzer)
    if (!vorhanden && sammlung === "apps" && daten && !rechte.has("admin")) (daten as { erstelltVon?: string }).erstelltVon = nutzer.email;
  }
  const datei = `${sammlung}.json`;
  const wer = nutzer.email || nutzer.name;
  if (!schluessel) { await aendern(datei, () => daten ?? {}, `Hub-Daten: ${datei} (${wer})`); return; }
  await aendern(datei, (alt) => {
    const m = alt && typeof alt === "object" && !Array.isArray(alt) ? { ...(alt as Record<string, unknown>) } : {};
    if (daten === undefined) { if (!(schluessel in m)) return undefined; delete m[schluessel]; }
    else m[schluessel] = daten;
    return m;
  }, `Hub-Daten: ${sammlung}/${schluessel}${daten === undefined ? " entfernt" : ""} (${wer})`);
}
