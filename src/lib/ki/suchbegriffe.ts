/**
 * Suchbegriffe für das Netzlaufwerk: Die Volltextsuche findet nur Wörter, die so in den Dokumenten stehen. Vor der Suche
 * macht die KI aus der Chatfrage Fachbegriffe, Synonyme und Dokumentarten („Was muss die Projekt-IT liefern?“ →
 * IT-Infrastruktur, Server, VM, Oracle, Pflichtenheft …). Sie hängen an der aktuellen Frage (letzter Teil nach „ | “).
 * Antwortet die KI nicht rechtzeitig, wird mit der Frage allein gesucht.
 */
import { kiFragen, kiModus } from "./index";

const ZEIT_MS = 15_000;
const MAX_BEGRIFFE = 12;

/** Begriffe aus der Antwort der KI: mit Komma, Semikolon oder Zeilen getrennt, ohne Aufzählungszeichen und Erklärungen */
export function suchbegriffeAus(antwort: string): string[] {
  const begriffe = antwort.replace(/\*\*/g, "").split(/[,;\n]/)
    .map((b) => b.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/[„“"'.:]+/g, "").trim())
    .filter((b) => b.length >= 2 && b.length <= 40 && b.split(/\s+/).length <= 4);
  return [...new Set(begriffe)].slice(0, MAX_BEGRIFFE);
}

export async function suchbegriffeErgaenzen(suche: string, signal?: AbortSignal): Promise<string> {
  if (kiModus() === "simulation") return suche;
  const teile = suche.split(" | ");
  const frage = teile.pop() ?? suche;
  const prompt = `Du bereitest eine Volltextsuche in den Projektordnern eines Anlagenbauers für Intralogistik vor (Angebote, Pflichtenhefte, Lastenhefte, Protokolle, Terminpläne, Betriebsanleitungen, Stücklisten als Word, Excel und PDF).
Gib zur Frage 6 bis 12 Suchbegriffe aus, die wörtlich in den passenden Dokumenten oder ihren Dateinamen stehen dürften: Fachbegriffe, Synonyme, übliche Abkürzungen und Dokumentarten. Beispiel: „Was muss die Projekt-IT liefern?“ → IT-Infrastruktur, Server, VM, Datenbank, Oracle, Netzwerk, Hardware, Pflichtenheft, Lieferumfang.
Keine Firmen- oder Kundennamen, keine Erklärung. Antworte nur mit einer Zeile, die Begriffe mit Komma getrennt.
${teile.length ? `Bisherige Fragen im Gespräch: ${teile.join(" / ")}\n` : ""}Frage: ${frage}`;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ZEIT_MS);
  const ab = () => c.abort();
  signal?.addEventListener("abort", ab);
  try {
    const begriffe = suchbegriffeAus(await kiFragen(prompt, c.signal));
    return begriffe.length ? [...teile, `${frage} ${begriffe.join(", ")}`].join(" | ") : suche;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("[KI-Hub] Suchbegriffe nicht ermittelt, Suche mit der Frage allein:", e);
    return suche;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", ab);
  }
}
