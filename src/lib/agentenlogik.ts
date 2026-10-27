/**
 * Agentenbibliothek, reine Logik (auch im Hub-Dienst): Verknüpfte Team-Agenten („vorlage“) und KI-Schritte mit einem
 * Agenten als Rolle („agent“) bekommen beim Lauf Name bzw. Rolle und Feinjustierung aus der Bibliothek.
 */
import type { Agent, AgentVorlage, App } from "./schema";

/** Vollständige Rolle eines Bibliotheksagenten: Rolle plus Feinjustierung */
export const agentRolle = (v: Pick<AgentVorlage, "rolle" | "hinweise">) => [v.rolle.trim(), v.hinweise.trim() ? `Feinjustierung (gilt immer):\n${v.hinweise.trim()}` : ""].filter(Boolean).join("\n\n");

/** Team-Agent aus einem Bibliotheksagenten (verknüpft) */
export const agentAusVorlage = (v: AgentVorlage, id: string): Agent => ({ id, name: v.name, rolle: agentRolle(v), vorlage: v.id });

/** Verweist die App auf die Bibliothek (Team-Agent oder Schritt mit Agent als Rolle)? */
export const brauchtBibliothek = (app: Pick<App, "steps">) => app.steps.some((s) => !!s.agent || !!s.team?.agenten.some((a) => a.vorlage));

/**
 * Vor einem Lauf: verknüpfte Agenten bekommen Name und Rolle aus der Bibliothek, Schritte mit Agent als Rolle dessen
 * Rolle und Feinjustierung. Fehlt der Bibliotheksagent inzwischen, bleibt die in der App gespeicherte Fassung.
 * Liefert dieselbe App zurück, wenn nichts zu ersetzen ist.
 */
export function agentenEinsetzen(app: App, bibliothek: AgentVorlage[]): App {
  if (!brauchtBibliothek(app)) return app;
  const je = new Map(bibliothek.map((v) => [v.id, v]));
  return { ...app, steps: app.steps.map((s) => {
    const v = s.agent ? je.get(s.agent) : undefined;
    const mitRolle = v ? { ...s, rolle: agentRolle(v) } : s;
    return !mitRolle.team ? mitRolle : { ...mitRolle, team: { ...mitRolle.team, agenten: mitRolle.team.agenten.map((a) => { const t = a.vorlage ? je.get(a.vorlage) : undefined; return t ? { ...a, name: t.name, rolle: agentRolle(t) } : a; }) } };
  }) };
}

/** In welchen Apps ein Bibliotheksagent verwendet wird (im Team oder als Rolle eines Schritts) */
export const agentNutzung = (apps: Pick<App, "id" | "name" | "steps">[], id: string) => apps.filter((a) => a.steps.some((s) => s.agent === id || s.team?.agenten.some((x) => x.vorlage === id)));
