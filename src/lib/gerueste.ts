/**
 * Grundgerüste für „Neu aus Vorlage“: typische Applikationsmuster, fertig verdrahtet (Eingaben, KI-Schritte,
 * Ergebnisseiten) und ohne offene Punkte in der Prüfung. Sie öffnen sich als ungespeicherter Entwurf im Baukasten,
 * dort passt man Texte, Felder und Aufgaben an.
 */
import type { App } from "./schema";
import { loadApp } from "./sanitize";

export type Geruest = { id: string; titel: string; text: string; bauen: () => App };

const f = (type: string, key: string, label: string, extra: Record<string, unknown> = {}) => ({ id: `${key}-f`, type, props: { key, label, keyAuto: false, ...extra } });
const seite = (id: string, titel: string, children: unknown[]) => ({ id, type: "seite", props: { titel }, children });
const h1 = (id: string, text: string) => ({ id, type: "heading", props: { text, level: 1 } });
const txt = (id: string, text: string) => ({ id, type: "text", props: { text } });
const out = (id: string, titel: string, quelle: string) => ({ id, type: "output", props: { titel, quelle } });
const sektion = (id: string, titel: string, kinder: unknown[]) => ({ id, type: "section", props: {}, children: [{ id: `${id}-h`, type: "heading", props: { text: titel, level: 3 } }, ...kinder] });

function app(roh: Record<string, unknown>): App {
  const a = loadApp({ id: null, status: "entwurf", version: 0, bereich: "Allgemein", ...roh });
  if (!a) throw new Error("Grundgerüst ungültig");
  return a;
}

export const GERUESTE: Geruest[] = [
  {
    id: "dokument", titel: "Formular → Word-Dokument",
    text: "Angaben ausfüllen, die KI schreibt daraus ein fertiges Dokument zum Herunterladen.",
    bauen: () => app({
      name: "Dokument erstellen", beschreibung: "Aus wenigen Angaben entsteht ein fertiges Word-Dokument.",
      steps: [{ id: "g-s1", key: "dokument", name: "Dokument", format: "markdown", datei: "docx",
        rolle: "Du schreibst sachliche, gut gegliederte Dokumente für Kolleginnen und Kollegen. Du erfindest keine Zahlen oder Namen.",
        prompt: "Schreibe ein Dokument zum Thema „{{thema}}“ für {{zielgruppe}}.\n\nEckdaten:\n{{eckdaten}}\n\nAufbau: # Titel, ## Ausgangslage, ## Inhalt, ## Nächste Schritte. Fehlende Angaben markierst du als [offen]." }],
      blocks: [
        seite("g-p1", "Angaben", [h1("g-b1", "Dokument erstellen"), txt("g-b2", "Füll die Angaben aus. Die KI schreibt daraus ein Dokument, das du als Word-Datei herunterlädst."),
          sektion("g-b3", "Angaben", [f("input", "thema", "Thema", { pflicht: true, beispiel: "Einführung der neuen Lagerverwaltung am Standort Lohne" }),
            f("input", "zielgruppe", "Für wen?", { beispiel: "Projektteam und Standortleitung" }),
            f("textarea", "eckdaten", "Eckdaten und Stichpunkte", { pflicht: true, beispiel: "Start im März, Schulung in zwei Gruppen, Ansprechpartner Anna Berger" })])]),
        seite("g-p2", "Dokument", [out("g-b4", "Dokument", "g-s1")]),
      ],
    }),
  },
  {
    id: "pruefen", titel: "Datei lesen → prüfen → Bericht",
    text: "Eine Datei hochladen, die KI liest die Werte aus, die Person prüft sie, dann entsteht der Bericht.",
    bauen: () => app({
      name: "Datei prüfen und berichten", beschreibung: "Liest eine hochgeladene Datei aus, lässt die Werte bestätigen und schreibt daraus einen Bericht.",
      steps: [
        { id: "g-s1", key: "lesen", name: "Datei lesen", format: "json", modell: "complex", autoAll: false,
          prompt: "Lies die Datei und gib nur dieses JSON zurück:\n{\"kunde\": \"\", \"projekt\": \"\", \"termin\": \"\", \"offen\": \"\"}\n\nWas nicht in der Datei steht, bleibt leer.\n\nDatei:\n{{datei}}" },
        { id: "g-s2", key: "bericht", name: "Bericht", format: "markdown", datei: "docx",
          prompt: "Schreibe einen kurzen Bericht.\n\nKunde: {{kunde}}\nProjekt: {{projekt}}\nTermin: {{termin}}\nOffene Punkte: {{offen}}\n\nAufbau: # Bericht, ## Überblick, ## Offene Punkte, ## Empfehlung." },
      ],
      blocks: [
        seite("g-p1", "Datei", [h1("g-b1", "Datei prüfen und berichten"), txt("g-b2", "Lade die Datei hoch. Auf der nächsten Seite prüfst du, was die KI gelesen hat."),
          f("file", "datei", "Datei (Word, Excel, PDF)", { pflicht: true })]),
        seite("g-p2", "Prüfen", [sektion("g-b3", "Gelesene Werte prüfen", [
          f("input", "kunde", "Kunde", { pflicht: true, aus: "lesen.kunde" }),
          f("input", "projekt", "Projekt", { aus: "lesen.projekt" }),
          f("input", "termin", "Termin", { aus: "lesen.termin" }),
          f("textarea", "offen", "Offene Punkte", { aus: "lesen.offen" })])]),
        seite("g-p3", "Bericht", [out("g-b4", "Bericht", "g-s2")]),
      ],
    }),
  },
  {
    id: "chat", titel: "Fachexperten-Chat",
    text: "Ein Chat, der Fragen nur aus hinterlegten Unterlagen beantwortet und die Quelle nennt.",
    bauen: () => app({
      name: "Fachexperte", beschreibung: "Beantwortet Fragen zu einem Fachthema nur aus den hinterlegten Unterlagen, mit Quelle.",
      wissen: { modus: "eingaben", text: "", quellen: [{ typ: "sharepoint", titel: "Fachunterlagen", url: "" }] },
      steps: [{ id: "g-s1", key: "experte", name: "Experte", format: "markdown", modell: "complex",
        rolle: "Du bist Fachexpertin bzw. Fachexperte für [Thema]. Du antwortest kurz und kollegial, nur aus den hinterlegten Unterlagen, und nennst am Ende die Quelle als Link. Was dort nicht steht, sagst du in einem Satz.",
        prompt: "Bisheriger Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}" }],
      blocks: [seite("g-p1", "Chat", [h1("g-b1", "Fachexperte"),
        { id: "g-b2", type: "chat", props: { titel: "Experte", quelle: "g-s1", begruessung: "Frag mich zu [Thema]. Ich antworte aus den hinterlegten Unterlagen und nenne die Quelle.", platzhalter: "Deine Frage …" } }])],
    }),
  },
  {
    id: "paket", titel: "Dateipaket (ZIP)",
    text: "Aus Angaben entsteht ein Ordner mit mehreren Dokumenten zum Herunterladen.",
    bauen: () => app({
      name: "Projektordner anlegen", beschreibung: "Erstellt aus den Projektangaben einen Ordner mit den Startdokumenten.",
      steps: [{ id: "g-s1", key: "paket", name: "Projektordner", format: "dateien", datei: "docx",
        prompt: "Lege für das Projekt „{{projekt}}“ (Kunde: {{kunde}}) einen Projektordner an.\n\nOrdner: 01_Vertrag, 02_Planung, 03_Protokolle.\nDateien: 02_Planung/Projektsteckbrief.md (Ziel, Umfang, Termine aus den Angaben), 03_Protokolle/Kickoff_Agenda.md.\n\nAngaben:\n{{angaben}}" }],
      blocks: [
        seite("g-p1", "Angaben", [h1("g-b1", "Projektordner anlegen"),
          sektion("g-b2", "Projekt", [f("input", "projekt", "Projektname", { pflicht: true, beispiel: "Leergutlager Lohne" }),
            f("input", "kunde", "Kunde", { pflicht: true, beispiel: "Brennecke Getränkelogistik" }),
            f("textarea", "angaben", "Ziel, Umfang und Termine", { beispiel: "Automatisches Leergutlager, Inbetriebnahme Q3, Projektleitung Anna Berger" })])]),
        seite("g-p2", "Ordner", [out("g-b3", "Projektordner", "g-s1")]),
      ],
    }),
  },
  {
    id: "team", titel: "Agenten-Team",
    text: "Mehrere KI-Agenten erarbeiten aus Ausgangslage und Ziel gemeinsam einen Plan.",
    bauen: () => app({
      name: "Agenten-Team", beschreibung: "Mehrere KI-Agenten finden gemeinsam den Weg von der Ausgangslage zum Ziel.",
      steps: [{ id: "g-s1", key: "team", name: "Agenten-Team", art: "team", format: "markdown", prompt: "{{start}}",
        team: { ziel: "{{ziel}}", maxRunden: 8, moderation: "Am Ende steht ein konkretes, umsetzbares Ergebnis.",
          agenten: [{ id: "g-a1", name: "Planer", rolle: "Zerlegt die Aufgabe in Etappen und Meilensteine." },
            { id: "g-a2", name: "Fachexperte", rolle: "Arbeitet die Inhalte konkret aus." },
            { id: "g-a3", name: "Prüfer", rolle: "Sucht Lücken, Risiken und Widersprüche." }] } }],
      blocks: [
        seite("g-p1", "Eingaben", [h1("g-b1", "Agenten-Team"),
          f("textarea", "start", "Ausgangslage", { pflicht: true }), f("textarea", "ziel", "Ziel", { pflicht: true })]),
        seite("g-p2", "Verlauf und Ergebnis", [out("g-b2", "Verlauf und Ergebnis", "g-s1")]),
      ],
    }),
  },
];
