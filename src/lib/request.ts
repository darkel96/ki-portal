import type { App, Quelle, Step, WissenModus } from "./schema";
import { fieldsOf, fill, varsIn, vorbelegtVon } from "./model";
import { DATEI_ART, DATEI_HINWEIS, dateiWunsch, type DateiArt } from "./dokument";
import { PRUEF_HINWEIS, istStatusFeld } from "./ampel";
import { faqBlock, hausregelnBlock } from "./lernen";

export const FORMAT_LABEL: Record<Step["format"], string> = {
  markdown: "Formatierter Text", text: "Schlichter Text", json: "JSON-Daten", dateien: "Dateipaket (ZIP)",
};
export const MODELL_LABEL: Record<Step["modell"], string> = { quick: "Schnell", default: "Standard", complex: "Gründlich" };
export const QUELL_TYP: Record<string, string> = {
  sharepoint: "SharePoint (Website, Bibliothek oder Ordner)", datei: "Einzelne Datei (SharePoint/OneDrive)", web: "Webseite",
  mail: "Meine E-Mails (Zeitraum, Filter)", teams: "Meine Teams-Chats und -Kanäle (Zeitraum, Filter)", kalender: "Mein Kalender (Zeitraum)",
  connector: "Netzlaufwerk / Graph-Connector",
};
/** Globale Regel: Diagramme als Mermaid, die der Hub zeichnet und als SVG, PNG und draw.io anbietet; keine erfundenen Datei-Links */
export const DIAGRAMM_HINWEIS = "Ist ein Ablauf, Prozess, Organigramm, Entscheidungsweg oder Zeitplan gefragt oder hilfreich, zeichne ihn immer als Mermaid-Codeblock (```mermaid mit flowchart TD), nie als Text- oder Pfeildiagramm. Jeder Kasten: kurzer Titel und optional eine Erläuterungszeile, z. B. B[Risk Classification<br/>CRA-Relevanz bewerten]; Entscheidungen als C{Lokal umsetzbar?} mit beschrifteten Pfeilen -->|Ja|. Keine Farben oder Styles angeben, der Hub gestaltet das Diagramm und bietet es als SVG, PNG und draw.io-Datei zum Herunterladen an. Du kannst keine Dateien bereitstellen: Verweise nie auf Download-Links oder Dateien, die du selbst erstellt hättest.";

/** Globale Regel: Dokumente entstehen im Hub aus der Antwort (Word, PDF), nie als Datei in OneDrive oder Teams */
export const DOKUMENT_HINWEIS = "Wird ein Dokument, Plan, Protokoll, eine Checkliste oder Vorlage gewünscht, schreibe den vollständigen Inhalt in die Antwort (## Überschriften, Tabellen, Listen); der Hub bietet die Antwort als Word und PDF zum Herunterladen an. Lege keine Dateien in OneDrive, Teams oder anderswo an und verweise nicht auf solche Dateien.";

/** Globale Regel für Links: immer Markdown-Link mit sprechendem Text, nie nackte Adressen, Nummern oder Kennungen */
export const LINK_HINWEIS = "Jeder Link ist ein Markdown-Link mit sprechendem Text: [Betreff der E-Mail](Adresse), [Name des Dokuments, Abschnitt](Adresse), [Teams-Chat mit Name, Datum](Adresse). Nie die nackte Adresse, nie Nummern wie [1] oder Kennungen als Linktext.";
export const FORMAT_HINT: Record<Step["format"], string> = {
  markdown: "Formatiere mit einfachem Markdown: ## Überschriften, - Listen, Tabellen nur wenn sie helfen. Beginne direkt mit dem Ergebnis. " + LINK_HINWEIS + " " + DIAGRAMM_HINWEIS + " " + DOKUMENT_HINWEIS,
  text: "Antworte als schlichter Text ohne Markdown. Beginne direkt mit dem Ergebnis.",
  json: "Antworte nur mit gültigem JSON, ohne Erklärung davor oder danach.",
  dateien: 'Antworte nur mit gültigem JSON in dieser Form: {"hinweis": "ein Satz zum Paket", "dateien": [{"pfad": "Ordner/Unterordner/Datei.md", "inhalt": "vollständiger Dateiinhalt als Text oder Markdown"}]}. Pfade mit / trennen, ohne Umlaute, Leerzeichen und Sonderzeichen. Soll eine Datei ein PDF, Word-, Excel- oder PowerPoint-Dokument sein, gib ihr die Endung .pdf, .docx, .xlsx bzw. .pptx und schreibe den Inhalt als Markdown; der Hub wandelt sie automatisch um. Keine Erklärung vor oder nach dem JSON.',
};

export type FileInfo = { name: string; size: number; type: string; text: string; /** Änderungsdatum der Datei, ISO */ geaendert?: string };

/** Neutrale Anfrage: Das übergibt eine Applikation an die zentrale KI-Anbindung. */
export type KiRequest = {
  applikation: string;
  applikationId: string | null;
  schritt: string;
  modell: Step["modell"];
  ausgabeformat: Step["format"];
  /** Fertige Datei, die der Hub aus dem Ergebnis erzeugt (PDF, Word, Excel, PowerPoint), oder null */
  ergebnisDatei: DateiArt | null;
  websuche: boolean;
  wissensquellen: { typ: string; titel: string; url: string }[];
  dateien: { feld: string; uebergabe: "text" | "referenz"; name: string | null; typ: string | null; groesse: number | null }[];
  /** Bilder zur Anfrage (Chat-Anhänge), als Daten-URL; eigener Schlüssel: direkt als Bild, Copilot: über OneDrive als Datei */
  bilder?: { name: string; daten: string }[];
  /** Vorlagenordner (SharePoint) für Kopien im Dateipaket, wenn die Liste geladen werden konnte */
  vorlagenUrl?: string;
  system: string;
  nachricht: string;
  variablen: Record<string, string | null>;
  /** Was an Wissen mitging (zur Nachvollziehbarkeit im Chat): Suchtext, je Quelle Zeichen bzw. Fehler; gelesen = Quellen wurden überhaupt gelesen */
  diagnose?: { suche: string; gelesen: boolean; auszuege: { titel: string; zeichen: number; fehler?: string }[];
    /** Dokumente mit Adresse aus den Auszügen: damit der Hub Quellennamen ohne Link selbst verlinken kann */
    links?: { titel: string; link: string }[] };
  /** Die gelesenen Auszüge selbst (für ein Nachschlagen, das sie behält) */
  auszuege?: WissenAuszug[];
};

/**
 * Gelesener Auszug einer Wissensquelle (SharePoint-Bereich oder Datei). dateien: Namen aller Dateien eines Bereichs
 * (Inventar, die relevantesten zuerst, gekürzt), dateienGesamt: wie viele es insgesamt sind. Damit kann die KI auch
 * Dateien nennen, die keine Stelle geliefert haben.
 */
export type WissenAuszug = { titel: string; url: string; text: string; fehler?: string; quelleTyp?: Quelle["typ"]; dateien?: string[]; dateienGesamt?: number };
/** Höchstens so viele Zeichen je Quelle (einzelne Datei), auch nach dem Zusammenlegen */
export const MAX_JE_QUELLE = 40_000;
/**
 * Höchstens so viele Zeichen je SharePoint-Bereich, auch nach dem Nachschlagen: Mehr Text lässt Copilot spürbar später
 * anfangen (gemessen 6 bis 11 s bis zum ersten Zeichen bei 40.000, einmal 62 s beim Nachschlagen). Die selbst gelesenen
 * Stellen (Tabellenzeilen, Textdateien) stehen vorn und werden zuletzt gekürzt.
 */
export const MAX_BEREICH = 24_000;

/**
 * Nachgeschlagene Auszüge zu den schon vorhandenen dazulegen statt sie zu ersetzen: je Quelle die Dokumentblöcke
 * beider Durchläufe ohne Doppelte, bis zur Höchstlänge. So gehen beim Nachschlagen die ersten Treffer nicht verloren.
 */
export function auszuegeZusammen(vorher: WissenAuszug[], neu: WissenAuszug[]): WissenAuszug[] {
  const out = neu.map((n) => ({ ...n }));
  for (const v of vorher) {
    if (!v.text) continue;
    const z = out.find((x) => x.titel === v.titel && x.url === v.url);
    if (!z) { out.push({ ...v }); continue; }
    const bloecke = z.text ? z.text.split("\n\n") : [];
    for (const b of v.text.split("\n\n")) if (b.trim() && !bloecke.includes(b)) bloecke.push(b);
    z.text = bloecke.join("\n\n").slice(0, z.quelleTyp === "datei" ? MAX_JE_QUELLE : MAX_BEREICH);
    delete z.fehler;
  }
  return out;
}

type AppWissen = Pick<App, "name" | "wissen">;

/**
 * Wirksames Wissen eines Schritts: Modus, Quellen und fester Text der App plus die des Schritts.
 * Der Schritt kann den Modus der App überschreiben („wissenModus“ ungleich "app").
 */
export function wissenFuer(app: Pick<App, "wissen">, step: Step): { modus: WissenModus; quellen: Quelle[]; text: string } {
  const modus = step.wissenModus === "app" ? app.wissen.modus : step.wissenModus;
  const gesehen = new Set<string>();
  const quellen = [...app.wissen.quellen, ...step.quellen].filter((q) => {
    if (!(q.url || q.titel)) return false;
    const k = (q.url || q.titel).trim().toLowerCase();
    if (gesehen.has(k)) return false;
    gesehen.add(k); return true;
  });
  return { modus, quellen, text: [app.wissen.text, step.wissen].filter((t) => t.trim()).join("\n\n") };
}

/** Systemtext je Wissensmodus */
export const WISSEN_TEXT: Record<WissenModus, string> = {
  eingaben: "Wissensgrenze: Nutze ausschließlich die Angaben in dieser Anfrage, die hinterlegten Wissensquellen und die mitgelieferten Auszüge daraus. Ziehe keine anderen Dokumente, E-Mails, Chats oder Besprechungen aus Microsoft 365 heran und keine Internetsuche. Fehlt eine Information, sage das, statt sie zu ergänzen.",
  m365: "Du darfst zusätzlich Wissen aus Microsoft 365 heranziehen (Dokumente, E-Mails, Chats, auf die die angemeldete Person Zugriff hat). Nenne dann die Quelle. Keine Internetsuche.",
  web: "Du darfst zusätzlich Wissen aus Microsoft 365 und die Internetsuche nutzen. Nenne dann die Quelle.",
};

export function systemText(app: AppWissen, step: Step, wissenText: string): string {
  const w = wissenFuer(app, step);
  return [
    `Du arbeitest in der Applikation „${app.name}“ eines internen KI-Hubs. Antworte auf Deutsch.`,
    step.rolle,
    wissenText ? `Hintergrundwissen:\n${wissenText}` : "",
    w.quellen.length ? "Hinterlegte Wissensquellen:\n" + w.quellen.map((x) => x.typ === "connector" ? `- ${x.titel || "Netzlaufwerk"} (${QUELL_TYP.connector}${x.filter ? `, Ordner ${x.filter}` : ""})` : `- ${x.titel || x.url} (${QUELL_TYP[x.typ] ?? "Quelle"})${x.url ? ": " + x.url.replace(/\(/g, "%28").replace(/\)/g, "%29") : ""}`).join("\n")
      + "\nQuellenangaben schreibst du als Markdown-Link [Dokument, Abschnitt](Adresse), sobald du die Adresse des Dokuments kennst (aus den Auszügen oder dieser Liste); so öffnet sich die Quelle direkt. Nie die nackte Adresse ausgeben, der Linktext ist der Name des Dokuments mit der Stelle." : "",
    WISSEN_TEXT[w.modus],
    // Hausregeln erst nach der Wissensgrenze: Sie sind Kontext (Begriffe, Tonfall), kein Wissen und kein Grund, die Auszüge zu übergehen
    hausregelnBlock(step),
    // Freigegebene häufige Fragen sind dagegen Wissen (bestätigte Antworten mit Quellen)
    faqBlock(step),
    FORMAT_HINT[step.format],
    vorlageText(step),
  ].filter(Boolean).join("\n\n");
}

/** Hinterlegte Beispieldatei/Vorlage: Aufbau und Stil übernehmen, nicht den Inhalt */
export function vorlageText(step: Pick<Step, "format" | "vorlage">): string {
  const t = step.vorlage?.text.trim();
  if (step.format === "json" || !t) return "";
  return `Vorlage für Aufbau und Stil${step.vorlage!.name ? ` („${step.vorlage!.name}“)` : ""}: Baue das Ergebnis genauso auf wie diese Vorlage, mit denselben Abschnitten und Überschriften in derselben Reihenfolge, denselben Tabellen (gleiche Spalten) und demselben Tonfall und Umfang je Abschnitt. Übernimm nur Aufbau und Stil, nie die Beispielinhalte: Setze die echten Angaben aus dieser Anfrage ein. Was dafür fehlt, kennzeichnest du als [offen] statt es zu erfinden; Abschnitte ohne passende Angaben bleiben mit [offen] stehen.\n<<<VORLAGE\n${t.slice(0, 12_000)}\nVORLAGE>>>`;
}

/** Welche Datei aus dem Ergebnis entsteht: fest eingestellt oder (bei „wunsch“) aus Aufgabe und Eingaben erkannt. */
export function ergebnisDateiFuer(step: Step, nachricht: string): DateiArt | null {
  if (step.format === "json" || !step.datei) return null;
  return step.datei === "wunsch" ? dateiWunsch(nachricht) : step.datei;
}

/** Zusatz zum Systemtext, wenn ein Dateipaket Vorlagen aus SharePoint kopieren darf */
export const KOPIEN_HINWEIS = 'Vorlagen kopieren: Das Paket darf zusätzlich "ordner": ["Pfad/leerer Ordner"] (leere Ordner, die angelegt werden) und "kopien": [{"quelle": "Pfad aus der Vorlagenliste", "ziel": "Ordner/Dateiname im Paket"}] enthalten. Kopien werden unverändert aus dem Vorlagenordner übernommen; "quelle" muss genau einem Eintrag der Vorlagenliste entsprechen, und der Dateiname im "ziel" bleibt exakt der Dateiname der Quelle (auch mit Leerzeichen und Umlauten; die Regel „ohne Umlaute und Leerzeichen“ gilt nur für Dateien, die du selbst schreibst). Einträge mit dem Vermerk „inhaltsgleich“ darfst du kopieren; Einträge mit „unterschiedlichem Inhalt, nicht kopieren“ und Vorlagen, die nicht in der Liste stehen, kopierst du nicht und nennst das als offenen Punkt.';

/** Liefert der Schritt die Werte einer Prüfseite (Felder mit „aus“ auf seinen key)? */
const fuelltPruefseite = (app: App, step: Step) => step.format === "json" && fieldsOf(app).some((f) => f.props.aus.trim().split(".")[0].toLowerCase() === step.key.toLowerCase());

export function buildRequest(app: App, step: Step, ctx: Record<string, string>, files?: Record<string, FileInfo>, vorlagen?: { url: string; text: string }, auszuege = ""): KiRequest {
  const w = wissenFuer(app, step);
  const inPrompt = new Set(varsIn(step.prompt));
  const used = new Set(varsIn(step.prompt + " " + w.text));
  let nachricht = fill(step.prompt, ctx);
  if (step.autoAll) {
    // Felder, die dieser oder ein späterer Schritt erst vorbelegt, sind keine Eingabe dieses Schritts
    const hier = app.steps.findIndex((x) => x.id === step.id);
    const rest = fieldsOf(app).filter((b) => !inPrompt.has(b.props.key.toLowerCase()) && (hier < 0 || !(vorbelegtVon(app, b.props.key) >= hier)));
    rest.forEach((b) => used.add(b.props.key.toLowerCase()));
    if (rest.length) nachricht = (nachricht.trim() ? nachricht.trim() + "\n\n" : "") + "Eingaben:\n\n" +
      rest.map((b) => `${b.props.label}:\n${ctx[b.props.key.toLowerCase()] ?? ""}`).join("\n\n");
  }
  // Prüfseite mit Status-Feldern: die Begründungen ausdrücklich und je Feld am Ende der Aufgabe verlangen (dort befolgt die KI sie zuverlässig)
  const statusPfade = fuelltPruefseite(app, step) ? fieldsOf(app).filter((f) => istStatusFeld(f) && f.props.aus.trim().split(".")[0].toLowerCase() === step.key.toLowerCase()).map((f) => f.props.aus.trim().split(".").slice(1).join(".")).filter(Boolean) : [];
  if (statusPfade.length) nachricht = `${nachricht.trim()}\n\nZusätzlich im selben JSON: Für jedes dieser Status-Felder, dessen Wert nicht eindeutig positiv ist, ein Schlüssel daneben mit Endung "_hinweis" und einem Satz Begründung mit Fundstelle (was genau fehlt oder sich widerspricht): ${statusPfade.map((x) => `"${x}_hinweis"`).join(", ")}. Diese Schlüssel gehören dazu, auch wenn das JSON-Schema oben sie nicht nennt. „Sicher“ heißt eindeutig belegt, auch bei schlechtem Befund.`;
  // Tabellen, die dieser Schritt füllt: Aufbau der Liste ausdrücklich nennen, sonst wählt die KI eigene Schlüssel
  if (fuelltPruefseite(app, step)) for (const t of fieldsOf(app)) {
    if (t.type !== "tabelle" || t.props.aus.trim().split(".")[0].toLowerCase() !== step.key.toLowerCase()) continue;
    const pfad = t.props.aus.trim().split(".").slice(1).join(".") || "zeilen";
    const ki = t.props.spalten.filter((c) => c.art === "ki");
    if (ki.length) nachricht = `${nachricht.trim()}\n\nFür die Tabelle „${t.props.label}“ im selben JSON unter "${pfad}": eine Liste mit einem Objekt je Zeile, in der Reihenfolge der Datei, mit den Schlüsseln ${ki.map((c) => `"${c.key}" (${c.titel}${c.typ === "zahl" ? ", Zahl ohne Tausenderpunkte" : c.typ === "datum" ? ", Datum JJJJ-MM-TT" : ""})`).join(", ")}. Leere Werte als "". Keine Summen- oder Zwischensummenzeilen als Zeile.`;
  }
  if (auszuege) nachricht = `${nachricht.trim()}\n\n${auszuege}`;
  if (vorlagen) nachricht = `${nachricht.trim()}\n\n${vorlagen.text}`;
  const ergebnisDatei = ergebnisDateiFuer(step, nachricht);
  const variablen: Record<string, string | null> = {};
  used.forEach((k) => { const v = ctx[k]; variablen[k] = v === undefined ? null : v.length > 160 ? v.slice(0, 160) + " …" : v; });
  const dateien = fieldsOf(app).filter((b) => b.type === "file" && used.has(b.props.key.toLowerCase())).map((b) => {
    const f = files?.[b.props.key];
    const uebergabe = b.type === "file" ? b.props.uebergabe : "text";
    return { feld: b.props.key, uebergabe, name: f?.name ?? null, typ: f?.type ?? null, groesse: f?.size ?? null };
  });
  return {
    applikation: app.name,
    applikationId: app.id,
    schritt: step.name,
    modell: step.modell,
    ausgabeformat: step.format,
    ergebnisDatei,
    websuche: w.modus === "web",
    wissensquellen: w.quellen.map((q) => ({ typ: q.typ, titel: q.titel, url: q.url })),
    dateien,
    vorlagenUrl: vorlagen?.url,
    system: [systemText(app, step, fill(w.text, ctx)), fuelltPruefseite(app, step) ? PRUEF_HINWEIS : "", vorlagen ? KOPIEN_HINWEIS : "", !ergebnisDatei ? "" : step.format === "dateien"
      ? `Dokumente im Paket (Berichte, Dokumentationen, Protokolle) schreibst du als Markdown-Dateien mit Endung .md, niemals als HTML zum Ausdrucken. Der Hub wandelt sie beim Herunterladen selbst in ${DATEI_ART[ergebnisDatei].label}-Dateien um.`
      : DATEI_HINWEIS[ergebnisDatei]].filter(Boolean).join("\n\n"),
    nachricht,
    variablen,
  };
}

/** Die Nachricht, wie sie als ein Text an Copilot geht (Copilot kennt keine getrennte System-Nachricht). */
export const combinedMessage = (req: Pick<KiRequest, "system" | "nachricht">) => (req.system ? `${req.system}\n\n---\n\n${req.nachricht}` : req.nachricht);

/** Lesbare Darstellung der Graph-Aufrufe der zentralen KI-Anbindung (Anfrage-Vorschau). */
export function graphPreview(step: Pick<Step, "modell">, req: KiRequest): string {
  const parts: string[] = [];
  void step;
  parts.push("// Zentrale KI-Anbindung des KI-Hubs (Azure-Anwendung)\n// Token: MSAL mit Single Sign-on, delegierte Graph-Berechtigungen.\n// Header bei jedem Aufruf: Authorization: Bearer <Token>");
  const refs = req.dateien.filter((d) => d.uebergabe === "referenz");
  const files = req.wissensquellen.filter((q) => q.typ === "datei" && q.url).map((q) => ({ uri: q.url }));
  refs.forEach((d) => files.push({ uri: `<OneDrive-Adresse von ${d.name ?? d.feld}>` }));
  if (refs.length) parts.push("// 0) Hochgeladene Datei(en) nach OneDrive legen\nPUT https://graph.microsoft.com/v1.0/me/drive/root:/KI-Hub/<dateiname>:/content\n<Dateiinhalt>");
  const sp = req.wissensquellen.filter((q) => q.typ === "sharepoint" && q.url);
  if (sp.length) parts.push("// 1) Passende Inhalte aus SharePoint holen (Retrieval API)\nPOST https://graph.microsoft.com/v1.0/copilot/retrieval\n" +
    JSON.stringify({ queryString: "<Suchbegriffe aus Aufgabe und Eingaben>", dataSource: "sharePoint", filterExpression: sp.map((q) => `path:"${q.url}"`).join(" OR "), maximumNumberOfResults: 10 }, null, 2));
  parts.push("// 2) Gespräch anlegen\nPOST https://graph.microsoft.com/beta/copilot/conversations\n{}");
  const body: Record<string, unknown> = { message: { text: combinedMessage(req) }, locationHint: { timeZone: "Europe/Berlin" }, contextualResources: { ...(files.length ? { files } : {}), webContext: { isWebEnabled: req.websuche } } };
  parts.push("// 3) Nachricht senden. Antwort: der letzte Text in „messages“, der nicht die eigene Frage ist\nPOST https://graph.microsoft.com/beta/copilot/conversations/{conversationId}/chat\n" + JSON.stringify(body, null, 2));
  parts.push(`// Hinweise\n// - Die Modellwahl („${MODELL_LABEL[req.modell]}“) hat bei Copilot keine Wirkung.\n// - Voraussetzungen: Microsoft-365-Copilot-Lizenz, Anmeldung über Entra ID, delegierte Berechtigungen.\n// - Endpunkte und Felder: Stand Mitte 2026, vor Inbetriebnahme mit der Graph-Dokumentation abgleichen.`);
  return parts.join("\n\n");
}
