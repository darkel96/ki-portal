/**
 * Kundenordner aus einer Frage erkennen (Netzlaufwerk, Modus „Kunde zuerst“): Ordnernamen wie „Printus_Offenburg“ oder
 * „Aumovio (ehem. Conti)_Villingen-Schwenningen“ werden in Wörter zerlegt und mit den Wörtern der Frage verglichen.
 * Umlaute und Akzente zählen nicht („Römer“ trifft „Roemer“). Rein, ohne Zugriff auf das Laufwerk.
 */

/** Klein, Umlaute ausgeschrieben, Akzente weg */
export const falten = (t: string) => t.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
const woerter = (t: string) => falten(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/**
 * Die Kundenordner, die am besten zur Frage passen: zuerst der, dessen Name zuletzt in der Frage vorkommt (im Chat
 * stehen die Vorfragen davor, die jüngste Nennung gilt), dann der mit den meisten passenden Wörtern. Mehrere Ordner mit
 * gleichem Rang („BASF“ bei vier BASF-Ordnern) kommen alle zurück: Der Kunde ist dann nicht eindeutig.
 * Leer, wenn kein Ordnername in der Frage vorkommt. füllwoerter: Wörter, die nie als Kunde zählen.
 */
export function kundeFinden(frage: string, namen: string[], fuellwoerter: Iterable<string> = []): string[] {
  const stopp = new Set([...fuellwoerter].map(falten));
  const stelle = new Map<string, number>();
  woerter(frage).filter((w) => !stopp.has(w)).forEach((w, i) => stelle.set(w, i));
  const treffer: { name: string; zuletzt: number; anzahl: number }[] = [];
  for (const name of namen) {
    let anzahl = 0, zuletzt = -1;
    for (const w of new Set(woerter(name))) {
      const i = stelle.get(w);
      if (i !== undefined) { anzahl++; zuletzt = Math.max(zuletzt, i); }
    }
    if (anzahl) treffer.push({ name, zuletzt, anzahl });
  }
  treffer.sort((a, b) => b.zuletzt - a.zuletzt || b.anzahl - a.anzahl);
  const spitze = treffer[0];
  return spitze ? treffer.filter((t) => t.zuletzt === spitze.zuletzt && t.anzahl === spitze.anzahl).map((t) => t.name) : [];
}
