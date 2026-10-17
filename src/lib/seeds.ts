import { AppSchema, type App, type HubApp } from "./schema";
import { fromSimple, makeBlock, neueSeite, rid, walk, type LegacyApp } from "./model";
import { fixRefs } from "./sanitize";
import { serviceangebotApp } from "./seedServiceangebot";

const VORLAGEN: LegacyApp[] = [
  { id: "mail-antwort", name: "E-Mail-Antwort", bereich: "Allgemein",
    beschreibung: "Formuliert eine passende Antwort auf eine eingegangene E-Mail im gewünschten Ton.",
    felder: [
      { key: "eingang", label: "Eingegangene E-Mail", typ: "textarea", pflicht: true, beispiel: "Guten Tag, wir haben am 12. September 40 Stück der Artikelnummer 7731 bestellt, bisher aber keine Versandbestätigung erhalten. Können Sie mir sagen, wann die Lieferung kommt?\nViele Grüße, Jana Kröger" },
      { key: "kernaussage", label: "Was soll die Antwort sagen?", typ: "text", pflicht: true, beispiel: "Lieferung verlässt am Donnerstag das Lager, Sendungsnummer kommt per Mail" },
      { key: "tonfall", label: "Tonfall", typ: "auswahl", optionen: ["freundlich", "formell", "kurz und knapp"], beispiel: "freundlich" },
    ],
    schritte: [{ titel: "Antwort formulieren", rolle: "Du bist Assistenz im Kundenservice. Du schreibst höflich, klar und ohne Floskeln.", prompt: "Schreibe eine Antwort auf diese E-Mail:\n\n{{eingang}}\n\nDie Antwort soll inhaltlich Folgendes sagen: {{kernaussage}}\nTonfall: {{tonfall}}\n\nGib nur den fertigen E-Mail-Text mit Anrede und Gruß aus." }] },
  { id: "angebot", name: "Angebotsanschreiben", bereich: "Vertrieb",
    beschreibung: "Erstellt das Anschreiben zu einem Angebot mit Nutzen, Leistung und Gesprächsvorschlag.",
    felder: [
      { key: "kunde", label: "Kunde und Ansprechpartner", typ: "text", pflicht: true, beispiel: "Stadtwerke Lindau, Herr Bauer" },
      { key: "leistung", label: "Angebotene Leistung", typ: "textarea", pflicht: true, beispiel: "Wartungsvertrag für 12 Ladesäulen, zwei Prüftermine pro Jahr, Störungsbehebung innerhalb von 48 Stunden" },
      { key: "besonderheiten", label: "Besonderheiten", typ: "text", beispiel: "Kunde legt Wert auf eine feste Ansprechpartnerin" },
    ],
    schritte: [{ titel: "Anschreiben", rolle: "Du bist Assistenz im Vertrieb. Du erfindest keine Preise und keine Zusagen.", prompt: "Schreibe ein Anschreiben zu einem Angebot.\nKunde: {{kunde}}\nLeistung: {{leistung}}\nBesonderheiten: {{besonderheiten}}\n\nFasse den Nutzen in drei Sätzen zusammen, nenne die Leistung konkret und schließe mit dem Vorschlag für ein kurzes Abstimmungsgespräch." }] },
  { id: "stellenanzeige", name: "Stellenanzeige", bereich: "Personal",
    beschreibung: "Schreibt aus Stichpunkten eine Stellenanzeige und daraus eine Kurzfassung für LinkedIn.",
    felder: [
      { key: "position", label: "Position", typ: "text", pflicht: true, beispiel: "Sachbearbeitung Buchhaltung (m/w/d)" },
      { key: "aufgaben", label: "Aufgaben", typ: "textarea", pflicht: true, beispiel: "Kreditorenbuchhaltung, Zahlungsläufe, Unterstützung beim Monatsabschluss" },
      { key: "anforderungen", label: "Anforderungen", typ: "textarea", beispiel: "Kaufmännische Ausbildung, erste Erfahrung mit DATEV, sorgfältige Arbeitsweise" },
      { key: "standort", label: "Standort und Arbeitsmodell", typ: "text", beispiel: "Augsburg, 2 Tage Homeoffice pro Woche" },
    ],
    schritte: [
      { titel: "Anzeige", rolle: "Du schreibst Stellenanzeigen in Du-Form, freundlich und konkret. Keine erfundenen Zahlen oder Benefits.", prompt: "Erstelle eine Stellenanzeige.\nPosition: {{position}}\nAufgaben: {{aufgaben}}\nAnforderungen: {{anforderungen}}\nStandort und Arbeitsmodell: {{standort}}\n\nGliederung: kurzer Einstieg, ## Deine Aufgaben, ## Das bringst du mit, ## Das bieten wir, Abschluss mit Aufruf zur Bewerbung." },
      { titel: "Kurzfassung für LinkedIn", modell: "quick", prompt: "Fasse diese Stellenanzeige als LinkedIn-Beitrag mit höchstens 600 Zeichen zusammen:\n\n{{schritt1}}" },
    ] },
  { id: "protokoll", name: "Meeting-Protokoll", bereich: "Allgemein",
    beschreibung: "Macht aus Besprechungsnotizen eine Zusammenfassung und eine Aufgabenliste mit Verantwortlichen.",
    felder: [{ key: "notizen", label: "Besprechungsnotizen", typ: "textarea", pflicht: true, beispiel: "Projekt Umzug Lager Nord, 6.10.\nTeilnehmer: Weber, Ahmadi, Schulz, Krause\n- Mietvertrag neue Halle unterschrieben, Übergabe 1.12.\n- Regalsystem: zwei Angebote liegen vor, Ahmadi holt drittes bis 15.10.\n- Netzwerk in neuer Halle fehlt noch, Schulz klärt mit Dienstleister\n- Umzug vorgeschlagen 8.–10.12., Krause stimmt mit Spedition ab\n- Offen: Inventur vor oder nach dem Umzug?" }],
    schritte: [
      { titel: "Zusammenfassung", prompt: "Fasse diese Besprechungsnotizen in höchstens fünf Stichpunkten zusammen. Führe offene Fragen gesondert unter ## Offen auf.\n\n{{notizen}}" },
      { titel: "Aufgabenliste", modell: "quick", prompt: "Erstelle aus den Notizen eine Markdown-Tabelle mit den Spalten Aufgabe | Verantwortlich | Termin. Fehlt eine Angabe, schreibe „offen“.\n\nNotizen:\n{{notizen}}" },
    ] },
  { id: "fehlermeldung", name: "Fehlermeldung erklären", bereich: "IT",
    beschreibung: "Übersetzt eine Fehlermeldung in verständliche Sprache und nennt Schritte, die man selbst prüfen kann.",
    felder: [
      { key: "fehlermeldung", label: "Fehlermeldung", typ: "textarea", pflicht: true, beispiel: "Die Verbindung mit dem Remotecomputer konnte nicht hergestellt werden. Fehlercode: 0x204" },
      { key: "system", label: "Gerät und Programm", typ: "text", beispiel: "Windows 11, Remotedesktop auf Terminalserver TS02" },
    ],
    schritte: [{ titel: "Erklärung", rolle: "Du bist IT-Support für Menschen ohne IT-Ausbildung. Du erklärst ohne Fachbegriffe.", prompt: "Erkläre diese Fehlermeldung.\nFehlermeldung: {{fehlermeldung}}\nUmgebung: {{system}}\n\nAufbau: ## Was bedeutet das (zwei Sätze), ## Das kannst du selbst prüfen (nummerierte Schritte), ## Wann du die IT anrufen solltest." }] },
  { id: "social-post", name: "Social-Media-Beitrag", bereich: "Marketing",
    beschreibung: "Schreibt drei Varianten eines Beitrags, abgestimmt auf Kanal und Ziel.",
    felder: [
      { key: "thema", label: "Worum geht es?", typ: "text", pflicht: true, beispiel: "Unser Azubi-Team hat den Innovationspreis der IHK Schwaben gewonnen" },
      { key: "kanal", label: "Kanal", typ: "auswahl", optionen: ["LinkedIn", "Instagram", "Facebook"], pflicht: true, beispiel: "LinkedIn" },
      { key: "ziel", label: "Ziel", typ: "auswahl", optionen: ["Reichweite", "Bewerbungen", "Anmeldungen zu einer Veranstaltung"], beispiel: "Bewerbungen" },
    ],
    schritte: [{ titel: "Drei Entwürfe", modell: "quick", prompt: "Schreibe drei unterschiedliche Entwürfe für einen {{kanal}}-Beitrag.\nThema: {{thema}}\nZiel des Beitrags: {{ziel}}\n\nJeder Entwurf unter eigener Überschrift (## Variante 1 usw.), passend zu Länge und Ton des Kanals, mit zwei bis vier Hashtags." }] },
  { id: "klausel", name: "Vertragsklausel prüfen", bereich: "Recht",
    beschreibung: "Erklärt eine Klausel, zeigt mögliche Risiken und formuliert Fragen für die Rechtsabteilung.",
    felder: [
      { key: "klausel", label: "Klauseltext", typ: "textarea", pflicht: true, beispiel: "Der Auftragnehmer haftet für Schäden nur bei Vorsatz und grober Fahrlässigkeit. Die Haftung ist der Höhe nach auf den Auftragswert begrenzt." },
      { key: "rolle", label: "Unsere Rolle", typ: "auswahl", optionen: ["Auftraggeber", "Auftragnehmer"], pflicht: true, beispiel: "Auftraggeber" },
    ],
    schritte: [{ titel: "Einschätzung", rolle: "Du unterstützt die Fachabteilung bei einer ersten Einschätzung. Du ersetzt keine Rechtsberatung und sagst das am Ende in einem Satz.", prompt: "Analysiere diese Vertragsklausel aus Sicht des {{rolle}}s.\n\nKlausel:\n{{klausel}}\n\nAufbau: ## Kurz erklärt, ## Mögliche Risiken, ## Fragen für die Rechtsabteilung." }] },
  { id: "angebotsvergleich", name: "Angebotsvergleich", bereich: "Einkauf",
    beschreibung: "Stellt Lieferantenangebote in einer Tabelle gegenüber und gibt eine begründete Empfehlung.",
    felder: [
      { key: "angebote", label: "Angebote", typ: "textarea", pflicht: true, beispiel: "Angebot A, Müller Logistik: 4,20 € je Palette, Lieferung in 3 Tagen, Zahlungsziel 30 Tage\nAngebot B, Nordfracht: 3,85 € je Palette, Lieferung in 5 Tagen, Zahlungsziel 14 Tage\nAngebot C, Huber Transporte: 4,05 € je Palette, Lieferung in 2 Tagen, Zahlungsziel 45 Tage, Mindestmenge 200 Paletten" },
      { key: "kriterien", label: "Worauf kommt es an?", typ: "text", beispiel: "Schnelle Lieferung ist wichtiger als der Preis, etwa 150 Paletten im Monat" },
    ],
    schritte: [{ titel: "Vergleich und Empfehlung", prompt: "Vergleiche diese Angebote.\n\n{{angebote}}\n\nWorauf es ankommt: {{kriterien}}\n\nErstelle zuerst eine Markdown-Tabelle mit den wichtigsten Merkmalen je Angebot, danach ## Empfehlung mit Begründung in drei Sätzen. Weise auf Bedingungen hin, die nicht passen." }] },
];

/** Beispiel für ein Agenten-Team: Start und Ziel vorgeben, den Weg finden die Agenten selbst. */
function agentenTeam(): App {
  const app = fromSimple({
    id: "agenten-team", name: "Agenten-Team", bereich: "Allgemein",
    beschreibung: "Mehrere KI-Agenten bekommen Start und Ziel und finden den Weg gemeinsam. Der Verlauf ist live zu sehen.",
    felder: [
      { key: "start", label: "Ausgangslage", typ: "textarea", pflicht: true, beispiel: "Unsere drei Standorte legen Prüfprotokolle unterschiedlich ab: Augsburg in einem Netzlaufwerk, Hamburg in SharePoint, Bad Kissingen teils auf Papier. Audits dauern dadurch lange." },
      { key: "ziel", label: "Ziel", typ: "textarea", pflicht: true, beispiel: "Ein abgestimmter Umsetzungsplan für eine einheitliche Ablage in SharePoint innerhalb von drei Monaten, mit Verantwortlichen, Meilensteinen und Risiken." },
      { key: "rahmen", label: "Rahmenbedingungen (optional)", typ: "textarea", beispiel: "Kein zusätzliches Budget für Software, IT hat zwei Personentage pro Monat frei." },
    ],
    schritte: [{ titel: "Agenten-Team", prompt: "{{start}}\n\nRahmenbedingungen:\n{{rahmen}}" }],
  });
  const s = app.steps[0];
  s.art = "team";
  s.name = "Agenten-Team";
  s.team = {
    ziel: "{{ziel}}",
    maxRunden: 8,
    moderation: "Achte darauf, dass am Ende ein konkretes, umsetzbares Ergebnis steht.",
    agenten: [
      { id: rid("g"), name: "Planer", rolle: "Zerlegt die Aufgabe in Etappen, schlägt Reihenfolge und Meilensteine vor.", vorlage: "" },
      { id: rid("g"), name: "Fachexperte", rolle: "Kennt SharePoint, Dokumentenlenkung und Audits. Arbeitet Inhalte konkret aus.", vorlage: "" },
      { id: rid("g"), name: "Prüfer", rolle: "Sucht Lücken, Risiken und Widersprüche und fordert Nachbesserung.", vorlage: "" },
      { id: rid("g"), name: "Umsetzer", rolle: "Denkt an Menschen und Aufwand: Wer macht was, wann, mit welchen Mitteln.", vorlage: "" },
    ],
  };
  const hinweis = makeBlock("callout");
  Object.assign(hinweis.props, { text: "Die Agenten sprechen nacheinander. Eine Moderation entscheidet, wer als Nächstes dran ist und wann das Ziel erreicht ist.", tone: "info" });
  app.blocks[0].children?.splice(2, 0, hinweis);
  const ergebnisSeite = app.blocks[1];
  if (ergebnisSeite?.type === "seite") ergebnisSeite.props.titel = "Verlauf und Ergebnis";
  const out = ergebnisSeite?.children?.[0];
  if (out?.type === "output") out.props.titel = "Verlauf und Ergebnis";
  return app;
}

/**
 * Fachexperten-Chat: Fragen zu einem Thema, beantwortet nur aus hinterlegten Unterlagen, mit Quellenangabe.
 * Vorlage für den Cyber Resilience Act; die Unterlagen trägt man unter App-Einstellungen → Wissen ein.
 */
function fachexperteCra(): App {
  const app = AppSchema.parse({
    id: "cra-experte", name: "Fachexperte Cyber Resilience Act", bereich: "Recht",
    beschreibung: "Beantwortet Fragen zum Cyber Resilience Act (CRA) wie ein Kollege aus der Produktsicherheit: kurz, nur aus den hinterlegten Unterlagen, mit Quelle als Link. Was nicht belegt ist, sagt er.",
    theme: { accent: "#0f2f5f" }, status: "freigegeben", version: 1,
    // Quelle des Piloten: die KSC Cybersecurity Library (Training, KPSS Templates mit Knowledge Base, EU Regulations)
    wissen: { modus: "eingaben", text: "", quellen: [{ typ: "sharepoint", titel: "KSC Cybersecurity Library (CRA-Unterlagen, Schulungen, Knowledge Base)", url: "https://koerbergroup.sharepoint.com/sites/KSCCybersecurity/KSC_Cybersecurity_Library" }] },
    steps: [{
      id: "cra-s1", name: "CRA-Experte", key: "experte", format: "markdown", modell: "complex",
      // Freigegebene Hausregeln aus dem Pilotbetrieb (Lernschicht); weitere Fassungen entstehen im Reiter „Lernen“
      hausregeln: { fassungen: [{ nr: 1, datum: "2026-10-17", grund: "Stand des Piloten nach versehentlichem Löschen wiederhergestellt", text: [
        "- CRA steht für Cyber Resilience Act, die Verordnung (EU) 2024/2847; bei der ersten Nennung die Langform verwenden.",
        "- Bei Fragen zur CRA-Relevanz von Produkten oder Komponenten die hinterlegte Kriterienliste (Kriterienliste_CRA_Relevanz) nutzen und nur Produktarten und Kriterien nennen, die dort belegt sind.",
        "- Bei Fragen nach einem Projektplan oder einer Checkliste den vollständigen Inhalt in der Antwort liefern (Abschnitte, Tabellen, Listen), je Abschnitt mit Quelle.",
        "- Wird eine knappe Antwort oder ein angebotener nächster Schritt mit „ja“ bestätigt, die angebotene Ausführung direkt liefern, ohne erneut nachzufragen.",
      ].join("\n") }] },
      rolle: `Du bist der CRA-Experte von Körber Supply Chain Automation: ein erfahrener Kollege aus der Produktsicherheit, der den Cyber Resilience Act (Verordnung (EU) 2024/2847) kennt und ihn für Kolleginnen und Kollegen aus Entwicklung, Vertrieb und Service verständlich macht.

So redest du:
- Wie ein Kollege im Gespräch, nicht wie ein Gutachten. Du bist per Du, direkt und freundlich.
- Die Länge folgt der Frage: Eine Begriffsfrage bekommt zwei bis vier Sätze, eine Detailfrage so viel wie nötig. Nie mehr als etwa 150 Wörter, außer die Person bittet um Ausführlichkeit.
- Erst die Antwort, dann die Quelle. Eine Quellenangabe pro Dokument am Ende, als Link: [CRA Q&A, Abschnitt Scope](Adresse des Dokuments). Keine Quellenzeile unter jedem Punkt.
- Aufzählungen nur, wenn es wirklich eine Liste ist. Keine Überschriften bei kurzen Antworten.
- Biete am Ende einen passenden nächsten Schritt an, wenn er sich anbietet („Soll ich die Pflichten für Hersteller genauer durchgehen?“).
- Beantworte nur, was gefragt wurde. Was du nicht gefunden hast, erwähnst du nur, wenn es die Frage betrifft.

Belegregel, ohne Ausnahme:
- Antworte nur aus den hinterlegten Unterlagen und den mitgelieferten Auszügen.
- Steht etwas nicht darin, sage es in einem Satz („Dazu habe ich in den Unterlagen nichts gefunden.“) und nenne, welches Dokument das klären würde. Ergänze nichts aus eigenem Wissen.
- Wörtliche Zitate in Anführungszeichen, deine Einordnung klar davon getrennt.
- Fristen, Pflichten und Zuständigkeiten nur mit Beleg und mit dem Stand des Dokuments.
- Keine Rechtsberatung: Nur wenn jemand eine Entscheidung treffen will, weise auf Rechtsabteilung oder Produktsicherheit hin, in einem Satz, nicht als Fußnote unter jeder Antwort.

Antworte auf Deutsch. Bei Rückfragen beziehst du dich auf den Verlauf.`,
      prompt: "Bisheriger Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}",
    }],
  });
  app.blocks = [neueSeite("Chat", [
    { id: "cra-b1", type: "heading", props: { text: "Fachexperte Cyber Resilience Act", level: 1, align: "left", color: "" } },
    { id: "cra-b2", type: "chat", props: { titel: "CRA-Experte", quelle: "cra-s1", begruessung: "Ich beantworte Fragen zum Cyber Resilience Act ausschließlich aus den hinterlegten Unterlagen und nenne die Quelle. Was dort nicht steht, sage ich. Was möchtest du wissen?", platzhalter: "z. B. Welche Pflichten gelten für Hersteller ab wann?" } },
  ])];
  return app;
}

/** Stabile IDs für Vorlagen (sonst entstehen bei jedem Laden neue), damit gespeicherte Läufe und Voreinstellungen ihre Schritte wiederfinden. */
function stabil(app: App): App {
  const map = new Map<string, string>();
  app.steps.forEach((st, i) => { const neu = `${app.id}-s${i + 1}`; map.set(st.id, neu); st.id = neu; });
  let n = 0;
  walk(app.blocks, (b) => { b.id = `${app.id}-b${++n}`; });
  fixRefs(app, map);
  return app;
}

export const SEED_APPS: HubApp[] = [
  ...VORLAGEN.map((v) => ({ ...stabil(fromSimple(v)), _src: "vorlage" as const })),
  { ...stabil(agentenTeam()), _src: "vorlage" as const },
  { ...stabil(serviceangebotApp()), _src: "vorlage" as const },
  { ...stabil(fachexperteCra()), _src: "vorlage" as const },
];
