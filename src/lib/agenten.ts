/**
 * Agentenbibliothek: Agenten (Name, Rolle, Feinjustierung) einmal global anlegen und in jedem Agenten-Team verwenden.
 * Ein Team-Agent mit „vorlage“ verweist auf einen Bibliotheksagenten; beim Lauf setzt der Hub dessen aktuelle Rolle ein,
 * sodass eine Feinjustierung sofort in allen Apps wirkt. Ablage wie die Apps: Browser oder gemeinsamer SharePoint-Ordner.
 */
import { AgentVorlageSchema, type Agent, type AgentVorlage, type App } from "./schema";
import { dateiLoeschen, dateiSchreiben, dateienLesen, speicherKonfig, speicherSchreibbar } from "./speicher";

const LS_KEY = "kihub-agenten-v1";
const datei = (id: string) => `agenten/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
const lesen = (roh: unknown): AgentVorlage | null => { const r = AgentVorlageSchema.safeParse(roh); return r.success ? r.data : null; };

async function lokalLesen(): Promise<AgentVorlage[]> {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(v) ? v.map(lesen).filter((a): a is AgentVorlage => !!a) : []; } catch { return []; }
}
const lokalSchreiben = (liste: AgentVorlage[]) => localStorage.setItem(LS_KEY, JSON.stringify(liste));

let cache: { zeit: number; liste: AgentVorlage[] } | null = null;
const CACHE_MS = 30_000;

/** Alle Agenten der Bibliothek (kurz zwischengespeichert; frisch = neu lesen) */
export async function agentenLaden(frisch = false): Promise<AgentVorlage[]> {
  if (!frisch && cache && Date.now() - cache.zeit < CACHE_MS) return cache.liste;
  const k = await speicherKonfig();
  // Gemeinsamer Speicher plus Browser (im Git-Speicher ohne Token bleiben eigene Agenten im Browser)
  const gemeinsam = k.art === "lokal" ? [] : (await dateienLesen("agenten").catch(() => [] as unknown[])).map(lesen).filter((a): a is AgentVorlage => !!a);
  const lokal = k.art === "lokal" || !(await speicherSchreibbar()) ? await lokalLesen() : [];
  const ids = new Set(lokal.map((a) => a.id));
  const liste = [...gemeinsam.filter((a) => !ids.has(a.id)), ...lokal];
  liste.sort((a, b) => a.name.localeCompare(b.name, "de"));
  cache = { zeit: Date.now(), liste };
  return liste;
}

export async function agentSpeichern(a: AgentVorlage): Promise<AgentVorlage> {
  const eintrag = AgentVorlageSchema.parse({ ...a, name: a.name.trim(), geaendert: new Date().toISOString() });
  if (await speicherSchreibbar()) await dateiSchreiben(datei(eintrag.id), eintrag);
  else { const liste = await lokalLesen(); const i = liste.findIndex((x) => x.id === eintrag.id); if (i >= 0) liste[i] = eintrag; else liste.push(eintrag); lokalSchreiben(liste); }
  cache = null;
  return eintrag;
}

export async function agentLoeschen(id: string): Promise<void> {
  if (await speicherSchreibbar()) await dateiLoeschen(datei(id));
  else lokalSchreiben((await lokalLesen()).filter((x) => x.id !== id));
  cache = null;
}

export const neueAgentId = () => `ag${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Vollständige Rolle eines Bibliotheksagenten: Rolle plus Feinjustierung */
export const agentRolle = (v: Pick<AgentVorlage, "rolle" | "hinweise">) => [v.rolle.trim(), v.hinweise.trim() ? `Feinjustierung (gilt immer):\n${v.hinweise.trim()}` : ""].filter(Boolean).join("\n\n");

/** Team-Agent aus einem Bibliotheksagenten (verknüpft) */
export const agentAusVorlage = (v: AgentVorlage, id: string): Agent => ({ id, name: v.name, rolle: agentRolle(v), vorlage: v.id });

/**
 * Vor einem Lauf: verknüpfte Agenten bekommen Name und Rolle aus der Bibliothek. Fehlt der Bibliotheksagent inzwischen,
 * bleibt die in der App gespeicherte Fassung. Liefert dieselbe App zurück, wenn nichts zu ersetzen ist.
 */
export function agentenEinsetzen(app: App, bibliothek: AgentVorlage[]): App {
  if (!app.steps.some((s) => s.team?.agenten.some((a) => a.vorlage))) return app;
  const je = new Map(bibliothek.map((v) => [v.id, v]));
  return { ...app, steps: app.steps.map((s) => (!s.team ? s : { ...s, team: { ...s.team, agenten: s.team.agenten.map((a) => { const v = a.vorlage ? je.get(a.vorlage) : undefined; return v ? { ...a, name: v.name, rolle: agentRolle(v) } : a; }) } })) };
}

/** Beim Lauf im Browser und beim Start im Hub-Dienst: App mit den aktuellen Bibliotheksagenten */
export async function mitBibliotheksAgenten(app: App): Promise<App> {
  if (!app.steps.some((s) => s.team?.agenten.some((a) => a.vorlage))) return app;
  try { return agentenEinsetzen(app, await agentenLaden()); } catch { return app; }
}

/** In welchen Apps ein Bibliotheksagent verwendet wird */
export const agentNutzung = (apps: Pick<App, "id" | "name" | "steps">[], id: string) => apps.filter((a) => a.steps.some((s) => s.team?.agenten.some((x) => x.vorlage === id)));
