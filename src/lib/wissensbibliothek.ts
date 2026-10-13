/**
 * Wissensbibliothek: Quellen, die in vielen Apps gebraucht werden (SharePoint-Bereiche, Dateien, Webseiten), einmal
 * eingetragen und in jeder App auswählbar. Testfassung im Browser (localStorage); Zielbild: zentral in SharePoint
 * gepflegt, vom Hub beim Start geladen.
 */
import type { Quelle } from "./schema";

export type BibliotheksEintrag = Quelle & { id: string; beschreibung: string };

const SCHLUESSEL = "kihub-wissensbibliothek";
/** Vorbelegung mit den Quellen des Piloten */
const START: BibliotheksEintrag[] = [
  { id: "sa-vorlagen", typ: "sharepoint", titel: "Service: Vorlagen und Formblätter", url: "https://koerbergroup.sharepoint.com/sites/aberle-doc/Prozessdokumente/Service/Vorlagen und Formblätter", beschreibung: "Angebots- und Vertragsvorlagen, Kalkulationen, Formblätter des Sales-Service (aberle-doc, Prozessdokumente)" },
];

export function bibliothek(): BibliotheksEintrag[] {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (!roh) return START.map((e) => ({ ...e }));
    const liste = JSON.parse(roh) as unknown;
    return Array.isArray(liste) ? liste.filter((e): e is BibliotheksEintrag => !!e && typeof e === "object" && typeof (e as BibliotheksEintrag).url === "string").slice(0, 100) : START.map((e) => ({ ...e }));
  } catch { return START.map((e) => ({ ...e })); }
}

function speichern(liste: BibliotheksEintrag[]) {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify(liste)); } catch { /* voll oder gesperrt */ }
}

/** Nimmt eine Quelle auf (gleiche Adresse wird aktualisiert statt doppelt angelegt). */
export function merken(q: Quelle, beschreibung = ""): BibliotheksEintrag {
  const liste = bibliothek();
  const url = q.url.trim();
  const vorhanden = liste.find((e) => e.url.trim().toLowerCase() === url.toLowerCase());
  const eintrag: BibliotheksEintrag = vorhanden ? { ...vorhanden, titel: q.titel || vorhanden.titel, typ: q.typ, beschreibung: beschreibung || vorhanden.beschreibung }
    : { id: `w${Date.now().toString(36)}`, typ: q.typ, titel: q.titel, url, beschreibung };
  speichern(vorhanden ? liste.map((e) => (e.id === eintrag.id ? eintrag : e)) : [...liste, eintrag]);
  return eintrag;
}

export function vergessen(id: string) {
  speichern(bibliothek().filter((e) => e.id !== id));
}
