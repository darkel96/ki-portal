/**
 * Vorlage „Serviceangebot vorbereiten“: der Ablauf der Serviceangebote-App als Hub-Applikation mit Prüfseite.
 * 1 Checkliste hochladen → Copilot liest sie (JSON) → 2 Prüfseite: gelesene Werte in Auswahlfeldern korrigieren
 * → 3 Hinweise von Copilot (plausibilisieren, unklare Kästchen, Rückfrage) → Zusammenfassung (Word) und
 * Angebotsstruktur als ZIP. Copilot entscheidet nichts: Welche Produkte angelegt werden, bestimmt der Status,
 * den die Person auf der Prüfseite bestätigt.
 */
import { AppSchema, type App, type Block } from "./schema";

/** Die Produkte der Service-Checkliste (Schlüssel, Bezeichnung, Ordner in der Angebotsstruktur). Reihenfolge wie im Formular. */
export const SA_PRODUKTE: [string, string, string][] = [
  ["ersatzteile", "Pos. 1 Ersatzteilpaket", "01_Ersatzteilpaket"],
  ["hotline", "Pos. 2 Hotline und Fernwartung", "02_Hotline_Fernwartung"],
  ["schulung", "Pos. 3 Schulung", "03_Schulung"],
  ["wartung", "Pos. 4 Wartungsvertrag", "04_Wartungsvertrag"],
  ["vorort", "Pos. 5 Service vor Ort", "05_Service_vor_Ort"],
  ["software", "Pos. 6 Softwarepflege", "06_Softwarepflege"],
];
const STATUS = ["Ja", "Nein", "Unklar", "Widersprüchlich"];

const GRUNDLAGE = `Du unterstützt den Sales-Service von Körber Supply Chain Automation (KSCA) beim Vorbereiten eines Serviceangebots. Die Service-Checkliste ist ein Word-Formular; angekreuzte Kästchen stehen im Text als ☒, leere als ☐. Jedes der sechs Produkte hat ein Ja- und ein Nein-Kästchen. Ein Produkt wird NUR bei einem eindeutigen Kreuz im Ja-Kästchen angelegt. Unklar oder widersprüchlich heißt: kein Ordner, bis der Sales-Service den Status von Hand setzt.

Regeln für dich:
- Du entscheidest nichts und rätst nicht. Du gibst Hinweise, was der Sales-Service prüfen oder beim Vertrieb nachfragen sollte. Sage nie, ein Produkt sei gewählt, wenn das Kreuz nicht eindeutig ist.
- Nutze nur die Angaben unten. Keine Annahmen über Preise, Laufzeiten oder Inhalte, die dort nicht stehen.
- Nenne Zugangsdaten nie, auch wenn sie in den Angaben stehen.
- Antworte kurz und sachlich in einfachem Markdown: Aufzählungen mit „- “, Hervorhebung mit **…**, keine Tabellen, keine Links.`;

/** Die geprüften Angaben der Prüfseite, wie sie in jeden Hinweis-Schritt gehen */
const ANGABEN = `Angaben aus der Checkliste (von der Person geprüft und ggf. korrigiert):
Kunde: {{kunde}}
Projekt: {{projekt}}
Angebotsnummer: {{angebotsnummer}}
Standort: {{standort}}
Angebotssprache: {{sprache}}

Produkte (Status laut Prüfung; „Ja“ = Ordner wird angelegt):
${SA_PRODUKTE.map(([k, t]) => `- ${t}: {{status_${k}}}\n  Angaben: {{angaben_${k}}}`).join("\n")}

Vollständiger Text der Checkliste ({{checkliste_name}}):
{{checkliste}}`;

let n = 0;
const id = () => `sa-b${++n}`;
const feld = (type: Block["type"], props: Record<string, unknown>): Block => ({ id: id(), type, props: { keyAuto: false, ...props } } as unknown as Block);
const block = (type: Block["type"], props: Record<string, unknown>, children?: Block[]): Block => ({ id: id(), type, props, ...(children ? { children } : {}) } as unknown as Block);
const seite = (titel: string, children: Block[]): Block => ({ id: id(), type: "seite", props: { titel }, children } as Block);

export function serviceangebotApp(): App {
  n = 0;
  const produktFelder = (teil: [string, string, string][]) => teil.flatMap(([k, t]) => [
    feld("select", { label: t, key: `status_${k}`, optionen: STATUS, aus: `lesen.produkte.${k}.status`, hilfe: "Status laut Kreuz in der Checkliste. Bei Unklar oder Widersprüchlich hier von Hand setzen." }),
    feld("textarea", { label: `Angaben zu ${t.replace(/^Pos\. \d+ /, "")}`, key: `angaben_${k}`, rows: 3, aus: `lesen.produkte.${k}.angaben`, placeholder: "Gewählte Leistungen, Mengen, Zeiträume aus der Checkliste" }),
  ]);
  const blocks: Block[] = [
    seite("Checkliste", [
      block("heading", { text: "Serviceangebot vorbereiten", level: 1 }),
      block("text", { text: "Lade die ausgefüllte Service-Checkliste hoch. Copilot liest sie, du prüfst und korrigierst die gelesenen Werte, danach entstehen Zusammenfassung und Angebotsstruktur." }),
      block("callout", { text: "Copilot gibt nur Hinweise. Welche Produkte angelegt werden, bestimmt der Status, den du auf der Prüfseite bestätigst.", tone: "info" }),
      block("section", { pad: "m", border: true }, [
        feld("file", { label: "Service-Checkliste (Word)", key: "checkliste", pflicht: true, hilfe: "Die ausgefüllte Checkliste als .docx. Kästchen werden als ☒ und ☐ gelesen." }),
        feld("select", { label: "Angebotssprache", key: "sprache", optionen: ["Deutsch", "Englisch"], pflicht: true, beispiel: "Deutsch", aus: "lesen.sprache", hilfe: "In dieser Sprache entsteht die Zusammenfassung für das Angebot." }),
        block("button", { text: "Checkliste lesen", aktion: "sa-lesen" }),
      ]),
    ]),
    seite("Prüfen und korrigieren", [
      block("heading", { text: "Das hat Copilot gelesen", level: 2 }),
      block("text", { text: "Prüfe die Werte und korrigiere sie bei Bedarf. Alles Weitere arbeitet mit deinen geprüften Angaben.", size: "s" }),
      block("output", { titel: "Gelesene Checkliste", quelle: "sa-lesen", stil: "plain", pfad: "bericht" }),
      block("section", { pad: "m", border: true }, [
        block("heading", { text: "Projektdaten", level: 3 }),
        feld("input", { label: "Kunde", key: "kunde", aus: "lesen.kunde", pflicht: true }),
        feld("input", { label: "Projekt", key: "projekt", aus: "lesen.projekt" }),
        feld("input", { label: "Angebotsnummer", key: "angebotsnummer", aus: "lesen.angebotsnummer" }),
        feld("input", { label: "Standort der Anlage", key: "standort", aus: "lesen.standort" }),
      ]),
      block("section", { pad: "m", border: true }, [
        block("heading", { text: "Produkte: Status bestätigen", level: 3 }),
        { id: id(), type: "columns", props: { count: 2 }, cols: [produktFelder(SA_PRODUKTE.slice(0, 3)), produktFelder(SA_PRODUKTE.slice(3))] } as Block,
      ]),
    ]),
    seite("Hinweise von Copilot", [
      block("heading", { text: "Hinweise von Copilot", level: 2 }),
      block("text", { text: "Copilot liest die geprüften Angaben samt Korrekturen. Die Hinweise ändern nichts; die Entscheidung bleibt beim Sales-Service.", size: "s" }),
      block("section", { pad: "m", border: true }, [
        block("button", { text: "Checkliste plausibilisieren", aktion: "sa-plausibel", stil: "outline" }),
        block("output", { titel: "Plausibilisierung", quelle: "sa-plausibel", stil: "card" }),
        block("button", { text: "Unklare Kästchen erklären", aktion: "sa-kaestchen", stil: "outline" }),
        block("output", { titel: "Unklare Kästchen", quelle: "sa-kaestchen", stil: "card" }),
        feld("textarea", { label: "Frage an Copilot", key: "frage", rows: 3, placeholder: "z. B. Welche Laufzeit steht beim Wartungsvertrag?", beispiel: "Welche Laufzeit steht beim Wartungsvertrag?" }),
        block("button", { text: "Fragen", aktion: "sa-frage", stil: "outline" }),
        block("output", { titel: "Antwort", quelle: "sa-frage", stil: "card" }),
      ]),
      block("button", { text: "Weiter zur Auswertung: Zusammenfassung und Angebotsstruktur erstellen", aktion: "ab:sa-zusammenfassung", align: "right" }),
    ]),
    seite("Zusammenfassung fürs Angebot", [block("output", { titel: "Zusammenfassung fürs Angebot", quelle: "sa-zusammenfassung", stil: "card" })]),
    seite("Angebotsstruktur (ZIP)", [block("output", { titel: "Angebotsstruktur", quelle: "sa-struktur", stil: "card" })]),
  ];
  const rolle = GRUNDLAGE;
  const app = AppSchema.parse({
    id: "serviceangebot", name: "Serviceangebot vorbereiten", bereich: "Service",
    beschreibung: "Liest die Service-Checkliste, lässt dich die gelesenen Werte prüfen und erstellt Zusammenfassung und Angebotsstruktur als ZIP.",
    theme: { accent: "#0f2f5f" }, status: "freigegeben", version: 1,
    blocks,
    steps: [
      { id: "sa-lesen", name: "Checkliste lesen", key: "lesen", format: "json", modell: "complex", rolle,
        prompt: `Lies die Service-Checkliste und gib die Werte als JSON zurück, damit der Sales-Service sie prüfen kann.

Status je Produkt: "Ja" nur bei eindeutigem Kreuz (☒) im Ja-Kästchen, "Nein" bei Kreuz im Nein-Kästchen, "Unklar" wenn kein Kästchen angekreuzt ist oder die Darstellung keine Zuordnung erlaubt, "Widersprüchlich" wenn beide angekreuzt sind oder Angaben dem Kreuz widersprechen. "fundstelle" nennt die Stelle in der Checkliste (Abschnitt, Zeile), "angaben" fasst die zugehörigen Angaben zusammen (gewählte Leistungen, Mengen, Zeiträume; kurz, mit Nummern der Unterpunkte). "bericht" ist Markdown für die Prüfseite: je Produkt eine Zeile „**Produkt**: Status – Fundstelle“, danach die Projektdaten und der Lieferumfang in Stichpunkten, zum Schluss offene Punkte. Keine Zugangsdaten.

Antworte nur mit JSON dieser Form:
{"kunde": "", "projekt": "", "angebotsnummer": "", "standort": "", "sprache": "Deutsch oder Englisch", "produkte": {${SA_PRODUKTE.map(([k]) => `"${k}": {"status": "Ja|Nein|Unklar|Widersprüchlich", "fundstelle": "", "angaben": ""}`).join(", ")}}, "lieferumfang": "", "bericht": ""}

Produkte in der Reihenfolge der Checkliste: ${SA_PRODUKTE.map(([, t]) => t).join("; ")}.

Text der Checkliste ({{checkliste_name}}):
{{checkliste}}` },
      { id: "sa-plausibel", name: "Plausibilisierung", key: "plausibel", rolle, modell: "default",
        prompt: `Auftrag: Prüfe die Checkliste auf Widersprüche und Lücken, zum Beispiel:
- Produkt auf Ja, aber die zugehörigen Angaben fehlen oder passen nicht dazu
- Produkt auf Nein oder unklar, aber darunter sind Angaben ausgefüllt
- Angaben, die sich gegenseitig ausschließen, oder fehlende Pflichtangaben wie Standort oder Sprache
Liste jeden Punkt mit Produkt und Nummer der Angabe. Gibt es nichts zu beanstanden, schreibe das in einem Satz.

---

${ANGABEN}` },
      { id: "sa-kaestchen", name: "Unklare Kästchen", key: "kaestchen", rolle, modell: "default",
        prompt: `Auftrag: Erkläre für jedes Produkt und jede Angabe mit Status „Unklar“ oder „Widersprüchlich“ oder mit unklarem Kästcheninhalt, was in der Checkliste steht und warum das nicht als eindeutiges Kreuz gilt. Nenne, was der Sales-Service beim Vertrieb klären sollte. Setze keinen Status und empfiehl keinen; die Entscheidung trifft der Mensch. Gibt es keine unklaren Kästchen, schreibe das in einem Satz.

---

${ANGABEN}` },
      { id: "sa-frage", name: "Frage zur Checkliste", key: "antwort", rolle, modell: "quick", bedingung: { feld: "frage", op: "gefuellt", wert: "" },
        prompt: `Auftrag: Beantworte die Frage des Sales-Service zu dieser Checkliste. Steht die Antwort nicht in den Angaben, sage das und nenne, wo sie zu klären wäre.

Frage: {{frage}}

---

${ANGABEN}` },
      { id: "sa-zusammenfassung", name: "Zusammenfassung fürs Angebot", key: "zusammenfassung", rolle, modell: "default", datei: "docx",
        prompt: `Auftrag: Schreibe eine kurze Zusammenfassung für das Angebot: ein Absatz zu Kunde und Projekt, dann je Produkt mit Status „Ja“ die wichtigsten gewählten Leistungen aus den Angaben, zum Schluss offene Punkte, die vor dem Versand geklärt sein müssen. Produkte mit Status Nein, Unklar oder Widersprüchlich erscheinen nur unter den offenen Punkten. Schreibe in der Angebotssprache ({{sprache}}). Überschrift: „Serviceangebot {{kunde}}“.

---

${ANGABEN}` },
      { id: "sa-struktur", name: "Angebotsstruktur", key: "struktur", rolle, modell: "default", format: "dateien", datei: "docx",
        prompt: `Auftrag: Baue die Angebotsstruktur als Dateipaket. Oberster Ordner: "Serviceangebot_{{angebotsnummer}}" (ohne Nummer: "Serviceangebot_{{kunde}}", Leerzeichen durch _ ersetzen).

Darin:
- "00_Pruefprotokoll.md": Kunde, Projekt, Angebotsnummer, Standort, Sprache, dann je Produkt eine Zeile „Produkt – Status – angelegt ja/nein“, zum Schluss die offenen Punkte. Genau die Status aus den Angaben, nichts umdeuten.
- "00_Angebotszusammenfassung.md": die Zusammenfassung fürs Angebot:
{{zusammenfassung}}
- Je Produkt mit Status "Ja" ein Ordner (${SA_PRODUKTE.map(([, t, o]) => `${t} → "${o}"`).join("; ")}) mit der Datei "Leistungsbeschreibung.md": Überschrift mit Produkt, Kunde und Angebotsnummer, dann die gewählten Leistungen aus den Angaben als Stichpunkte, Felder für Preis und Laufzeit als „[offen]“, nichts erfinden. Produkte mit anderem Status bekommen keinen Ordner.

---

${ANGABEN}` },
    ],
  });
  return app;
}
