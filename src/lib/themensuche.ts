/**
 * Themensuche im Postfach (Prozeduren): Welche Mails gehören zu „Alles zum Projekt KTE“? Füllwörter („alles“, „zum“,
 * „Projekt“, „Mails“) zählen nicht, sonst trifft fast jede Mail. Ein Suchwort zählt nur am Wortanfang: „KTE“ trifft
 * „KTE:“ und „KTE-Projekt“, aber nicht „Projekte“; „Remotezugriff“ trifft auch „Remotezugriffe“.
 */
const FUELL = new Set([
  "alle", "alles", "allem", "allen", "aller", "zum", "zur", "zu", "von", "vom", "mit", "und", "oder", "für", "fuer", "über", "ueber",
  "im", "in", "am", "an", "auf", "aus", "bei", "das", "der", "die", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
  "rund", "um", "bezüglich", "bzgl", "betreffend", "betreff", "thema", "themen", "projekt", "projekte", "projekts", "projektes",
  "mail", "mails", "e-mail", "e-mails", "email", "emails", "nachricht", "nachrichten", "sachen", "dinge", "infos", "informationen",
  "kunde", "kunden", "zeug", "the", "and", "all", "about", "project",
]);

/** Suchwörter aus dem Themenfeld: Komma, Semikolon oder Leerzeichen trennen; Satzzeichen und Füllwörter fallen weg */
export function suchWorte(thema: string): string[] {
  const roh = thema.toLowerCase().split(/[,;]+|\s+/).map((w) => w.replace(/^[„"'“”‚‘’(\[]+|[„"'“”‚‘’)\].:!?]+$/g, "").trim()).filter((w) => w.length >= 2);
  const echte = roh.filter((w) => !FUELL.has(w));
  // Nur Füllwörter (z. B. „Projekt“): dann doch nach ihnen suchen
  return [...new Set(echte.length ? echte : roh)];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Trifft eines der Wörter am Wortanfang? */
export function passtZumThema(text: string, worte: string[]): boolean {
  return worte.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}`, "iu").test(text));
}
