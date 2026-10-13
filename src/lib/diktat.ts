/**
 * Diktat nachbessern: Die Spracherkennung des Browsers kennt keine Fachbegriffe („Cyber Resilience Act“ wird zu
 * „Cyber result entdeckt“). Der Hub sammelt deshalb die Fachbegriffe einer App (Abkürzungen, großgeschriebene
 * Wortfolgen, lange Einzelwörter aus Name, Beschreibung, Rollen, Wissen und Quellen) und ersetzt im erkannten Text
 * Wortfolgen, die einem Begriff ähnlich genug klingen bzw. geschrieben sind.
 */
import type { App } from "./schema";
import { walk } from "./model";

/** Buchstaben ohne Groß-/Kleinschreibung, Umlaute und Satzzeichen, zum Vergleichen */
const norm = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z]/g, "");

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}
const aehnlich = (a: string, b: string) => (a && b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);

/** Fachbegriffe einer App: Abkürzungen (CRA, SBOM), großgeschriebene Wortfolgen (Cyber Resilience Act), lange Wörter */
export function fachbegriffe(app: App): string[] {
  const texte: string[] = [app.name, app.beschreibung, app.wissen.text, ...app.wissen.quellen.map((q) => q.titel)];
  for (const s of app.steps) texte.push(s.name, s.rolle, s.prompt, s.wissen, ...s.quellen.map((q) => q.titel));
  walk(app.blocks, (b) => {
    if (b.type === "chat") texte.push(b.props.titel, b.props.begruessung, b.props.platzhalter);
    if (b.type === "heading" || b.type === "text") texte.push(String((b.props as { text?: string }).text ?? ""));
  });
  const gefunden = new Map<string, string>();
  const merken = (t: string) => { const k = norm(t); if (k.length >= 3 && !gefunden.has(k)) gefunden.set(k, t); };
  for (const t of texte) {
    if (!t) continue;
    // Abkürzungen: 2–6 Großbuchstaben (auch mit Ziffern), z. B. CRA, SBOM, PSSA, EU
    for (const m of t.match(/\b[A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,5}\b/g) ?? []) if (norm(m).length >= 3) merken(m);
    // Großgeschriebene Wortfolgen aus 2–4 Wörtern, z. B. Cyber Resilience Act, Körber Supply Chain Automation
    for (const m of t.match(/\b[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüßA-Z]+){1,3}\b/g) ?? []) merken(m);
    // Lange Einzelwörter (ab 9 Buchstaben), z. B. Produktsicherheit, Meldepflicht
    for (const m of t.match(/\b[A-ZÄÖÜ][a-zäöüß]{8,}\b/g) ?? []) merken(m);
  }
  // Lange Begriffe zuerst, damit „Cyber Resilience Act“ vor „Act“ greift
  return [...gefunden.values()].sort((a, b) => norm(b).length - norm(a).length);
}

/** Ab welcher Ähnlichkeit (0–1) eine Wortfolge als dieser Begriff gilt */
function schwelle(begriff: string): number {
  const n = norm(begriff);
  if (/\s|-/.test(begriff)) return 0.65;   // mehrwortig: wenig Verwechslungsgefahr
  if (n.length <= 6) return 0.66;   // Abkürzung: ein Buchstabe daneben
  return 0.72;   // langes Einzelwort
}

/**
 * Ersetzt im erkannten Text Wortfolgen, die einem Fachbegriff ähnlich sind, durch den Begriff; setzt den ersten
 * Buchstaben groß und ein Fragezeichen, wenn der Satz wie eine Frage beginnt.
 */
export function diktatKorrigieren(text: string, begriffe: string[]): string {
  const woerter = text.trim().split(/\s+/).filter(Boolean);
  if (!woerter.length) return "";
  const aus: string[] = [];
  let i = 0;
  while (i < woerter.length) {
    let best: { begriff: string; n: number; sim: number } | null = null;
    for (const begriff of begriffe) {
      const nb = norm(begriff);
      const maxN = Math.min(5, woerter.length - i);
      for (let n = 1; n <= maxN; n++) {
        const folge = norm(woerter.slice(i, i + n).join(" "));
        if (!folge || Math.abs(folge.length - nb.length) > Math.max(4, nb.length * 0.5)) continue;
        const sim = aehnlich(folge, nb);
        if (sim < schwelle(begriff)) continue;
        // Ein Randwort, das die Ähnlichkeit nicht verbessert, gehört nicht zum Begriff („die Meldepflicht“, „Meldepflicht für“)
        if (n >= 2 && (aehnlich(norm(woerter.slice(i + 1, i + n).join(" ")), nb) >= sim || aehnlich(norm(woerter.slice(i, i + n - 1).join(" ")), nb) >= sim)) continue;
        if (!best || sim > best.sim || (sim === best.sim && nb.length > norm(best.begriff).length)) best = { begriff, n, sim };
      }
    }
    if (best) {
      const letztes = woerter[i + best.n - 1];
      const satzzeichen = /[.,;:!?]+$/.exec(letztes)?.[0] ?? "";
      aus.push(best.begriff + satzzeichen);
      i += best.n;
    } else aus.push(woerter[i++]);
  }
  let s = aus.join(" ");
  s = s[0].toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s) && /^(was|wie|welche[rsn]?|wer|wann|wo|woher|wohin|warum|wieso|weshalb|ab wann|bis wann|gibt es|muss|müssen|kann|können|soll|sollen|darf|dürfen|ist|sind|hat|haben|gilt|gelten|brauch[et]n?|wird|werden)\b/i.test(s)) s += "?";
  return s;
}
