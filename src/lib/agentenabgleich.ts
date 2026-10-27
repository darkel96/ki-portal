/**
 * Agenten und Aufgaben aufeinander abstimmen (Baukasten): Die KI trennt eine Rolle in den wiederverwendbaren Teil
 * (wer der Agent ist, wie er prüft, Regeln) und den Teil, der nur in diese App gehört (Ausgabe, Zeitraum, Versand);
 * und sie stimmt die Aufgabe eines Schritts auf einen verknüpften Agenten ab (Doppeltes raus, Gliederung passend).
 * Beides sind Vorschläge; übernommen wird erst nach Bestätigung im Baukasten.
 */
import { jsonAus, kiFragen } from "./ki";
import { varsIn } from "./model";
import type { AgentVorlage } from "./schema";

export type RollenAufteilung = { name: string; beschreibung: string; rolle: string; hinweise: string; aufgabe: string };
export type AufgabenAbgleich = { aufgabe: string; aenderungen: string[]; fehlend: string[] };

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** Platzhalter der alten Aufgabe, die in der neuen fehlen (die KI darf keine verlieren) */
export const fehlendePlatzhalter = (alt: string, neu: string) => {
  const jetzt = new Set(varsIn(neu));
  return [...new Set(varsIn(alt))].filter((v) => !jetzt.has(v));
};

/** Rolle eines Schritts in Agent (Rolle, Feinjustierung) und App-Teil (gehört in die Aufgabe) aufteilen */
export async function rolleAufteilen(rolle: string, schritt: { name: string; prompt: string }, signal?: AbortSignal): Promise<RollenAufteilung> {
  const antwort = await kiFragen(`Aus einer Rolle für einen KI-Schritt soll ein wiederverwendbarer Agent für eine Agentenbibliothek werden. Andere Apps nutzen denselben Agenten mit ihrer eigenen Aufgabe.

Teile die Rolle auf:
- "rolle": wer der Agent ist, sein Fachgebiet, wie er vorgeht und prüft (gilt in jeder App).
- "hinweise": Regeln, die immer gelten (Belege, Umgang mit Unsicherheit, Grenzen, Tonfall), knapp als Sätze.
- "aufgabe": was nur in diese App gehört: Aufbau und Form der Ausgabe (Tabellen, Abschnitte, E-Mail-Briefing), Zeitraum, Stichtag, Empfänger. Leer, wenn es nichts davon gibt.
- "name": kurzer Name des Agenten (2 bis 4 Wörter, z. B. „Projekt- und Vertragsprüfer“).
- "beschreibung": ein Satz, wofür der Agent da ist.
Übernimm die Formulierungen möglichst wörtlich, erfinde nichts dazu und lass nichts weg; jeder Satz landet in genau einem Teil. Sätze, die etwas tun, was ein Agent nicht kann (z. B. „Versende die E-Mail erst nach Bestätigung“), lässt du weg.
Antworte nur mit JSON: {"name": "…", "beschreibung": "…", "rolle": "…", "hinweise": "…", "aufgabe": "…"}

Name des Schritts: ${schritt.name}
Bisherige Aufgabe des Schritts (nur zur Orientierung, nicht aufteilen):
"""
${schritt.prompt.slice(0, 3000)}
"""

Rolle:
"""
${rolle}
"""`, signal);
  const j = jsonAus(antwort) as Record<string, unknown>;
  const aus = { name: text(j.name, 60), beschreibung: text(j.beschreibung, 300), rolle: text(j.rolle, 4000), hinweise: text(j.hinweise, 4000), aufgabe: text(j.aufgabe, 4000) };
  if (!aus.rolle) throw new Error("Die KI hat keine Rolle geliefert. Bitte noch einmal versuchen oder ohne Aufteilung speichern.");
  return aus;
}

/** Aufgabe eines Schritts auf den verknüpften Agenten abstimmen: Doppeltes streichen, Gliederung mit der Rolle verzahnen */
export async function aufgabeAbstimmen(agent: Pick<AgentVorlage, "name" | "rolle" | "hinweise">, aufgabe: string, signal?: AbortSignal): Promise<AufgabenAbgleich> {
  const antwort = await kiFragen(`Ein KI-Schritt bekommt seine Rolle aus dem Agenten „${agent.name}“. Stimme die Aufgabe des Schritts auf diese Rolle ab:
- Streiche aus der Aufgabe, was die Rolle oder ihre Regeln schon sagen (Haltung, Prüfregeln, Umgang mit Belegen und Vermutungen).
- Behalte alles, was nur in diese App gehört: Quellen, Thema, Zeitraum, Aufbau und Form der Ausgabe.
- Bringt die Rolle eine Einordnung oder Struktur mit (z. B. Arten von Abweichungen), sag in der Gliederung der Aufgabe, wo sie hingehört, statt sie zu wiederholen.
- Alle Platzhalter in doppelten geschweiften Klammern (z. B. {{kunde}}) bleiben genau so erhalten.
- Ändere nichts am Inhalt, was nicht nötig ist; erfinde keine neuen Anforderungen.
Antworte nur mit JSON: {"aufgabe": "die neue Aufgabe", "aenderungen": ["kurz, was du geändert hast", "…"]}. Passt die Aufgabe schon, gib sie unverändert zurück und "aenderungen": [].

Rolle des Agenten:
"""
${[agent.rolle, agent.hinweise].filter(Boolean).join("\n\n")}
"""

Aufgabe:
"""
${aufgabe}
"""`, signal);
  const j = jsonAus(antwort) as Record<string, unknown>;
  const neu = text(j.aufgabe, 8000) || aufgabe;
  const aenderungen = Array.isArray(j.aenderungen) ? j.aenderungen.map((x) => text(x, 300)).filter(Boolean).slice(0, 8) : [];
  return { aufgabe: neu, aenderungen: neu.trim() === aufgabe.trim() ? [] : aenderungen, fehlend: fehlendePlatzhalter(aufgabe, neu) };
}
