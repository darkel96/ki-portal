/** Ergebnis eines Auftrags an sein Ziel bringen (E-Mail, Teams): gemeinsame Logik aus src/lib/versand.ts, Token aus der gespeicherten Anmeldung. */
import { KI_CONFIG } from "@/lib/ki/config";
import { zustellen, type GraphRuf, type ZustellInhalt } from "@/lib/versand";
import type { Ziel } from "@/lib/meinhub";
import { emailVon, graphTokenFuer } from "./anmeldung";
import type { DienstLauf } from "./laeufe";
import type { DateiSpeicher } from "./speicher";
import { diagrammMalerImDienst } from "./diagramm";

export function laufInhalt(l: DienstLauf): ZustellInhalt {
  const teile = l.app.steps.filter((s) => l.outs[s.id]).map((s) => {
    const o = l.outs[s.id]!;
    return { name: s.name, status: o.status, text: o.text ?? "", meldung: o.meldung };
  });
  return { titel: l.titel, appName: l.appName, stand: l.status === "laeuft" ? "fertig" : l.status, meldung: l.meldung, teile };
}

export async function zustellenImDienst(speicher: DateiSpeicher, l: DienstLauf): Promise<string> {
  const ziel: Ziel = { ...l.ziel!, adresse: l.ziel?.adresse ?? "" };
  // E-Mail ohne Adresse: an die Person selbst (aus der gespeicherten Anmeldung, sonst fragt das Modul Graph)
  if (ziel.art === "email" && !ziel.adresse.trim()) ziel.adresse = await emailVon(speicher, l.nutzer);
  const graph: GraphRuf = async (pfad, init) => {
    const token = await graphTokenFuer(speicher, l.nutzer);
    return fetch(`${KI_CONFIG.graph}${pfad}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };
  return zustellen(ziel, laufInhalt(l), graph, diagrammMalerImDienst());
}
