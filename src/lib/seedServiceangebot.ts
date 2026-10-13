/**
 * Vorlage „Serviceangebot vorbereiten“: der Ablauf der Serviceangebote-App (CHARLESTOWN) als Hub-Applikation.
 * 1 Checkliste hochladen → Copilot liest sie (JSON) → 2 Prüfseite: gelesene Werte in Auswahlfeldern korrigieren, daneben
 * die optionalen Hinweise von Copilot (unklare Kästchen, plausibilisieren, Rückfrage) → Zusammenfassung (Word) und Angebotsstruktur als ZIP
 * mit den Originalvorlagen aus SharePoint. Copilot entscheidet nichts: Welche Produkte angelegt werden, bestimmt
 * der Status, den die Person auf der Prüfseite bestätigt. Produkte, Ordner und Dokumente: regeln.py der Serviceangebote-App.
 */
import { AppSchema, type App, type Block } from "./schema";

/** Produkte der Service-Checkliste: Schlüssel, Titel, SAP, Ordnermuster ({nr} = Angebotsnummer), Suppliers-Unterordner, Kalkulation */
export const SA_PRODUKTE: { key: string; titel: string; sap: string; ordner: string; suppliers: string[]; kalkulation: string }[] = [
  { key: "remoteservice", titel: "Remote Service", sap: "Z30", ordner: "RS_{nr}_Remote_Service", suppliers: ["IT", "RA", "SM"], kalkulation: "Remote Services Calculation.xltm" },
  { key: "softwaremaintenance", titel: "Software Maintenance", sap: "Z31", ordner: "RS_{nr}_Software_Maintenance", suppliers: ["IT", "RA", "SM"], kalkulation: "Software_maintenance_Calculation.xltm" },
  { key: "itservices", titel: "IT-Services", sap: "Z33", ordner: "RS_{nr}_IT_Services", suppliers: ["IT"], kalkulation: "IT-Service_Kalkulation.xltx" },
  { key: "wartungsvertrag", titel: "Wartungsvertrag", sap: "Z50", ordner: "FS_{nr}_Wartungsvertrag", suppliers: [], kalkulation: "Servicecalculation.xltm" },
  { key: "ersatzteilpaket", titel: "Ersatzteilpaket", sap: "Z41", ordner: "SP_{nr}_Ersatzteilpaket", suppliers: [], kalkulation: "Ersatzteilkalkulation.xltm" },
  { key: "residentmaintenance", titel: "Resident Maintenance", sap: "Z61", ordner: "RS_{nr}_Resident_Maintenance", suppliers: [], kalkulation: "Resident Maintenance_Servicekalkulation.xltm" },
];
const STATUS = ["Ja", "Nein", "Unklar", "Widersprüchlich"];
/** Vorlagenordner wie in konfiguration.py der Serviceangebote-App: Website aberle-doc, Bibliothek Prozessdokumente */
export const SA_VORLAGEN_URL = "https://koerbergroup.sharepoint.com/sites/aberle-doc/Prozessdokumente/Service/Vorlagen und Formblätter";
const STANDARD = ["01_Request", "02_Offer", "02_Offer/Rev00", "03_Calculation", "03_Calculation/Rev00", "04_Suppliers", "05_Layout", "06_Configuration", "07_Correspondence", "08_Pictures"];
const PLATZHALTER = "1900xxxxx";

const GRUNDLAGE = `Du unterstützt den Sales-Service von Körber Supply Chain Automation (KSCA) beim Vorbereiten eines Serviceangebots. Die Service-Checkliste ist ein Word-Formular; angekreuzte Kästchen stehen im Text als ☒, leere als ☐. Jedes der sechs Produkte (${SA_PRODUKTE.map((p) => `${p.titel} (${p.sap})`).join(", ")}) hat ein Ja- und ein Nein-Kästchen. Ein Produkt wird NUR bei einem eindeutigen Kreuz im Ja-Kästchen angelegt. Unklar oder widersprüchlich heißt: kein Ordner, bis der Sales-Service den Status von Hand setzt.

Regeln für dich:
- Du entscheidest nichts und rätst nicht. Du gibst Hinweise, was der Sales-Service prüfen oder beim Vertrieb nachfragen sollte. Sage nie, ein Produkt sei gewählt, wenn das Kreuz nicht eindeutig ist.
- Nutze nur die Angaben unten. Keine Annahmen über Preise, Laufzeiten oder Inhalte, die dort nicht stehen.
- Nenne Zugangsdaten nie, auch wenn sie in den Angaben stehen.
- Antworte kurz und sachlich in einfachem Markdown: Aufzählungen mit „- “, Hervorhebung mit **…**, keine Tabellen, keine Links.`;

/** Die geprüften Angaben der Prüfseite, wie sie in jeden weiteren Schritt gehen */
const ANGABEN = `Angaben aus der Checkliste (vom Sales-Service geprüft und ggf. korrigiert):
Kunde: {{kunde}}
Projekt: {{projekt}}
Standort: {{standort}}
Angebotssprache: {{sprache}}

Produkte (Status laut Prüfung; nur „Ja“ wird angelegt):
${SA_PRODUKTE.map((p) => `- ${p.titel} (${p.sap}): Status {{status_${p.key}}}; Angebotsnummer {{nummer_${p.key}}}\n  Angaben: {{angaben_${p.key}}}`).join("\n")}

Vollständiger Text der Checkliste ({{checkliste_name}}):
{{checkliste}}`;

const STRUKTUR_REGELN = `Regeln für die Angebotsstruktur (genau so umsetzen, nichts dazu erfinden):
- Oberster Ordner und ZIP-Name: "<Kunde>_<Projekt>_Serviceangebotsstruktur" (Leerzeichen durch _, keine Sonderzeichen). Fehlt Kunde oder Projekt: "Serviceangebotsstruktur_<Angebotsnummer>".
- Nur Produkte mit Status „Ja“ bekommen einen Ordner. nr = Angebotsnummer des Produkts (nur Buchstaben, Ziffern, Bindestrich); fehlt sie, steht ${PLATZHALTER} und ein offener Punkt. Ordnernamen:
${SA_PRODUKTE.map((p) => `  ${p.titel} → ${p.ordner}`).join("\n")}
- Jeder Produktordner bekommt die leeren Unterordner ${STANDARD.join(", ")}${SA_PRODUKTE.filter((p) => p.suppliers.length).map((p) => `; ${p.titel} zusätzlich ${p.suppliers.map((s) => `04_Suppliers/${s}`).join(", ")}`).join("")}.
- Kalkulation (Kopie aus den Vorlagen) nach 03_Calculation/Rev00: ${SA_PRODUKTE.map((p) => `${p.titel}: ${p.kalkulation}`).join("; ")}.
- Angebotsdokumente (Kopien aus den Vorlagen) nach 02_Offer/Rev00, abhängig von der Angebotssprache (Deutsch/Englisch):
  Remote Service: Hauptvertrag FB_SE_Remote_Services_Vertrag.dotx (Englisch: FB_SE_Remote_Services_Agreement.dotx), wenn Software Maintenance oder IT-Services „Ja“ ist; FB_SE_Remote_Services_Vertrag_SMART.dotx (Englisch: FB_SE_Remote_Services_Agreement_SMART.dotx), wenn beide „Nein“ sind; sonst kein Hauptvertrag und ein offener Punkt. Dazu immer: FB_SE_Anhang_Remote_Assistance.dotx (Englisch: FB_SE_Appendix_Remote_Assistance.dotx), FB_SE_Anhang_Appendix_Data_Protection_and_Security.dotx (beide Sprachen), FB_Anhang_Stundensätze.dotx (Englisch: FB_Appendix_Hourly_Rates.dotx), Koerber_Supply_Chain_Automation_TCs_Support_Services_25.1_De.pdf (Englisch: …_En.pdf). Bei Software Maintenance „Ja“ zusätzlich FB_SE_Anhang_Software_Maintenance.dotx (Englisch: FB_SE_Appendix_Software_Maintenance.dotx), bei IT-Services „Ja“ FB_SE_Anhang_IT-Services.dotx (Englisch: FB_SE_Appendix_IT_Services.dotx).
  Wartungsvertrag: FB_SE_Preventive Maintenance Service Vertrag.dotx (Englisch: FB_SE_Preventive Maintenance Services Agreement.dotx).
  Software Maintenance, IT-Services, Ersatzteilpaket, Resident Maintenance: ein eigenes Angebotsdokument ist noch nicht definiert → offener Punkt. Ausnahme: Ist Remote Service „Ja“, liegen die Unterlagen von Software Maintenance und IT-Services im Remote-Service-Ordner; das im Prüfprotokoll als Verweis nennen.
  Ist die Angebotssprache unklar, keine sprachabhängigen Dokumente kopieren und das als offenen Punkt nennen.
- Vorlagen nur aus der Vorlagenliste kopieren (Pfad genau übernehmen, auch aus Unterordnern). Fehlt eine Vorlage in der Liste oder gibt es sie mehrfach: nicht kopieren, offener Punkt. Gibt es keine Vorlagenliste: keine Kopien, stattdessen im Prüfprotokoll die benötigten Vorlagen auflisten.
- Datei "Pruefprotokoll.txt" im obersten Ordner: Kunde, Projekt, Standort, Sprache; je Produkt „Titel (SAP) – Status – angelegt ja/nein – Ordner“; je kopierter Vorlage „Ziel ← Quelle“; Verweise; danach „Offene Punkte“ mit allem, was zu klären ist. Nur die Status aus den Angaben, nichts umdeuten.
- Datei "Angebotszusammenfassung.md" im obersten Ordner mit der Zusammenfassung fürs Angebot.`;

let n = 0;
const id = () => `sa-b${++n}`;
const feld = (type: Block["type"], props: Record<string, unknown>): Block => ({ id: id(), type, props: { keyAuto: false, ...props } } as unknown as Block);
const block = (type: Block["type"], props: Record<string, unknown>, children?: Block[]): Block => ({ id: id(), type, props, ...(children ? { children } : {}) } as unknown as Block);
const seite = (titel: string, children: Block[]): Block => ({ id: id(), type: "seite", props: { titel }, children } as Block);

export function serviceangebotApp(): App {
  n = 0;
  const produktFelder = (teil: typeof SA_PRODUKTE) => teil.flatMap((p) => [
    feld("select", { label: `${p.titel} (${p.sap})`, key: `status_${p.key}`, optionen: STATUS, aus: `lesen.produkte.${p.key}.status`, hilfe: "Status laut Kreuz. Bei Unklar oder Widersprüchlich hier von Hand setzen." }),
    feld("input", { label: `Angebotsnummer ${p.titel}`, key: `nummer_${p.key}`, aus: `lesen.produkte.${p.key}.nummer`, placeholder: PLATZHALTER, hilfe: "Eigene Nummer je Produktordner." }),
    feld("textarea", { label: `Angaben zu ${p.titel}`, key: `angaben_${p.key}`, rows: 3, aus: `lesen.produkte.${p.key}.angaben`, placeholder: "Gewählte Leistungen, Mengen, Zeiträume aus der Checkliste" }),
  ]);
  const blocks: Block[] = [
    seite("Checkliste", [
      block("heading", { text: "Serviceangebot vorbereiten", level: 1 }),
      block("text", { text: "Lade die ausgefüllte Service-Checkliste hoch. Copilot liest sie, du prüfst und korrigierst die gelesenen Werte, danach entstehen die Zusammenfassung und die Angebotsstruktur mit den Originalvorlagen aus SharePoint." }),
      block("callout", { text: "Copilot gibt nur Hinweise. Welche Produkte angelegt werden, bestimmt der Status, den du auf der Prüfseite bestätigst.", tone: "info" }),
      block("section", { pad: "m", border: true }, [
        feld("file", { label: "Service-Checkliste (Word)", key: "checkliste", pflicht: true, hilfe: "Die ausgefüllte Checkliste als .docx. Kästchen werden als ☒ und ☐ gelesen." }),
        feld("select", { label: "Angebotssprache", key: "sprache", optionen: ["Deutsch", "Englisch"], pflicht: true, beispiel: "Deutsch", aus: "lesen.sprache", hilfe: "Bestimmt die Sprache der Zusammenfassung und der Angebotsdokumente." }),
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
        feld("input", { label: "Projekt", key: "projekt", aus: "lesen.projekt", pflicht: true }),
        feld("input", { label: "Standort der Anlage", key: "standort", aus: "lesen.standort" }),
      ]),
      block("section", { pad: "m", border: true }, [
        block("heading", { text: "Produkte: Status bestätigen", level: 3 }),
        block("text", { text: "Der Status kommt aus dem Kreuz in der Checkliste. Bei Unklar oder Widersprüchlich hier von Hand setzen; nur „Ja“ bekommt einen Ordner.", size: "s" }),
        { id: id(), type: "columns", props: { count: 2 }, cols: [produktFelder(SA_PRODUKTE.slice(0, 3)), produktFelder(SA_PRODUKTE.slice(3))] } as Block,
      ]),
      // Wie in der Serviceangebote-App: die KI-Hinweise stehen auf derselben Seite wie die Korrekturen, alle optional
      block("section", { pad: "m", border: true }, [
        block("heading", { text: "Hinweise von Copilot (optional)", level: 3 }),
        block("text", { text: "Copilot liest die geprüften Angaben samt Korrekturen. Die Hinweise ändern nichts; die Entscheidung bleibt beim Sales-Service.", size: "s" }),
        block("button", { text: "Unklare Kästchen erklären", aktion: "sa-kaestchen", stil: "outline" }),
        block("output", { titel: "Unklare Kästchen", quelle: "sa-kaestchen", stil: "card" }),
        block("button", { text: "Checkliste plausibilisieren", aktion: "sa-plausibel", stil: "outline" }),
        block("output", { titel: "Plausibilisierung", quelle: "sa-plausibel", stil: "card" }),
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
    beschreibung: "Liest die Service-Checkliste, lässt dich die gelesenen Werte prüfen und erstellt Zusammenfassung und Angebotsstruktur mit den Vorlagen aus SharePoint als ZIP.",
    theme: { accent: "#0f2f5f" }, status: "freigegeben", version: 1,
    blocks,
    steps: [
      { id: "sa-lesen", name: "Checkliste lesen", key: "lesen", format: "json", modell: "complex", rolle,
        prompt: `Lies die Service-Checkliste und gib die Werte als JSON zurück, damit der Sales-Service sie prüfen kann.

Status je Produkt: "Ja" nur bei eindeutigem Kreuz (☒) im Ja-Kästchen, "Nein" bei Kreuz im Nein-Kästchen, "Unklar" wenn kein Kästchen angekreuzt ist oder die Darstellung keine Zuordnung erlaubt, "Widersprüchlich" wenn beide angekreuzt sind oder Angaben dem Kreuz widersprechen. "fundstelle" nennt die Stelle in der Checkliste (Abschnitt, Zeile), "nummer" die Angebotsnummer des Produkts, falls eingetragen (sonst ""), "angaben" fasst die zugehörigen Angaben zusammen (gewählte Leistungen, Mengen, Zeiträume; kurz, mit Nummern der Unterpunkte). "bericht" ist Markdown für die Prüfseite: je Produkt eine Zeile „**Produkt**: Status – Fundstelle“, danach die Projektdaten und der Lieferumfang in Stichpunkten, zum Schluss offene Punkte. Keine Zugangsdaten.

Antworte nur mit JSON dieser Form:
{"kunde": "", "projekt": "", "standort": "", "sprache": "Deutsch oder Englisch", "produkte": {${SA_PRODUKTE.map((p) => `"${p.key}": {"status": "Ja|Nein|Unklar|Widersprüchlich", "fundstelle": "", "nummer": "", "angaben": ""}`).join(", ")}}, "lieferumfang": "", "bericht": ""}

Produkte in der Reihenfolge der Checkliste: ${SA_PRODUKTE.map((p) => `${p.titel} (${p.sap})`).join("; ")}.

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
      { id: "sa-struktur", name: "Angebotsstruktur", key: "struktur", rolle, modell: "complex", format: "dateien",
        quellen: [{ typ: "sharepoint", titel: "Vorlagen und Formblätter (SharePoint aberle-doc, Prozessdokumente)", url: SA_VORLAGEN_URL }],
        prompt: `Auftrag: Baue die Angebotsstruktur als Dateipaket mit leeren Ordnern ("ordner"), Kopien der Originalvorlagen ("kopien") und zwei Textdateien ("dateien").

${STRUKTUR_REGELN}

Zusammenfassung fürs Angebot (für Angebotszusammenfassung.md):
{{zusammenfassung}}

---

${ANGABEN}` },
    ],
  });
  return app;
}
