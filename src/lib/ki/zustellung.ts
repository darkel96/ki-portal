/** Zustellung aus dem Browser: Microsoft Graph mit dem Token der angemeldeten Person (Copilot-Anmeldung). */
import type { Lauf, Ziel } from "@/lib/meinhub";
import { zustellen, zustellScopes, type GraphRuf, type ZustellInhalt } from "@/lib/versand";
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";

/** Nur in der Entwicklung: Tests legen hier ein Ersatz-Token ab und fangen Graph mit einer Attrappe ab. */
const testToken = () => { try { return import.meta.env.DEV ? localStorage.getItem("kihub-graph-test") : null; } catch { return null; } };

/** Ob eine Zustellung aus diesem Browser möglich ist (Graph erreichbar) */
export const zustellungMoeglich = () => kiModus() === "copilot" || !!testToken();

export async function zustellenImBrowser(ziel: Ziel, inhalt: ZustellInhalt): Promise<string> {
  const scopes = zustellScopes(ziel);
  const graph: GraphRuf = async (pfad, init) => {
    const token = scopes.length ? (testToken() ?? await graphToken(scopes)) : "";
    return fetch(`${KI_CONFIG.graph}${pfad}`, {
      method: init?.method ?? "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };
  return zustellen(ziel, inhalt, graph);
}

/** Inhalt aus einem gespeicherten Lauf (Browser) */
export function laufInhalt(lauf: Lauf): ZustellInhalt {
  const teile = Object.values(lauf.ergebnisse).map((e) => ({ name: e.name ?? e.key ?? "Ergebnis", text: e.text ?? "", status: e.status, meldung: e.meldung }));
  return { titel: lauf.titel, appName: lauf.appName, stand: lauf.status === "laeuft" ? "fertig" : lauf.status, meldung: lauf.meldung, teile };
}

/** Kurze Testnachricht, damit sich Adresse und Berechtigung vor dem ersten Lauf prüfen lassen */
export const testInhalt = (appName: string): ZustellInhalt => ({
  titel: `Test aus „${appName}“`, appName, stand: "test",
  teile: [{ name: "Testnachricht", status: "fertig", text: "Wenn diese Nachricht ankommt, funktioniert die Zustellung. Die Ergebnisse des Auftrags kommen künftig auf diesem Weg." }],
});
