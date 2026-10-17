/**
 * Häufige Fragen (Lernschicht): freigegebene Frage-Antwort-Paare je Chat-Schritt. Passt eine Frage zu einem Eintrag,
 * antwortet der Chat sofort damit, ohne KI (die Person kann trotzdem die KI fragen). Die Zuordnung ist bewusst
 * schlicht und streng: gleiche Wörter ohne Füllwörter; lieber einmal die KI fragen als eine falsche Antwort geben.
 */
import type { Step } from "./schema";

export type FaqEintrag = Step["faq"]["eintraege"][number];

const FUELLWOERTER = new Set(["der", "die", "das", "ein", "eine", "einer", "eines", "einem", "einen", "und", "oder", "ist", "sind", "wie", "was", "wer", "wo", "wann", "warum", "fuer", "von", "im", "in", "am", "an", "zu", "zum", "zur", "bei", "mit", "auf", "es", "ich", "wir", "uns", "bitte", "gibt", "gilt", "welche", "welcher", "welches", "den", "dem", "des", "nach", "ueber", "auch", "noch", "mal", "denn", "dass", "kann", "man", "muss", "muessen", "haben", "hat", "habe", "mir", "mich", "eigentlich", "genau", "mal", "ja", "nein", "the", "a", "of", "is", "are"]);

/** Wörter einer Frage, klein, ohne Umlaute, Satzzeichen und Füllwörter */
export function wortliste(s: string): string[] {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !FUELLWOERTER.has(w));
}

/** Übereinstimmung zweier Wortlisten (0 … 1): gemeinsame Wörter durch alle Wörter */
export function aehnlichkeit(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let gemeinsam = 0;
  for (const w of A) if (B.has(w)) gemeinsam++;
  return gemeinsam / (A.size + B.size - gemeinsam);
}

/** Mindestübereinstimmung, ab der ein Eintrag gilt */
export const FAQ_SCHWELLE = 0.6;

/** Passender Eintrag zu einer Frage (bester Treffer über Frage und Varianten), sonst null */
export function faqTreffer(step: Pick<Step, "faq">, frage: string): { eintrag: FaqEintrag; wert: number } | null {
  const q = wortliste(frage);
  if (!q.length) return null;
  let best: { eintrag: FaqEintrag; wert: number } | null = null;
  for (const e of step.faq.eintraege) {
    for (const t of [e.frage, ...e.varianten]) {
      const w = wortliste(t);
      const wert = w.join(" ") === q.join(" ") ? 1 : aehnlichkeit(q, w);
      if (wert >= FAQ_SCHWELLE && (!best || wert > best.wert)) best = { eintrag: e, wert };
    }
  }
  return best;
}

export function faqEintrag(frage: string, antwort: string, quelle: FaqEintrag["quelle"]): FaqEintrag {
  return { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, frage: frage.trim().slice(0, 300), varianten: [], antwort: antwort.trim().slice(0, 4000), datum: new Date().toISOString().slice(0, 10), quelle };
}
