import type { App, Quelle, Step, WissenModus } from "./schema";
import { fieldsOf, fill, varsIn } from "./model";
import { DATEI_ART, DATEI_HINWEIS, dateiWunsch, type DateiArt } from "./dokument";

export const FORMAT_LABEL: Record<Step["format"], string> = {
  markdown: "Formatierter Text", text: "Schlichter Text", json: "JSON-Daten", dateien: "Dateipaket (ZIP)",
};
export const MODELL_LABEL: Record<Step["modell"], string> = { quick: "Schnell", default: "Standard", complex: "Gründlich" };
export const QUELL_TYP: Record<string, string> = {
  sharepoint: "SharePoint (Website, Bibliothek oder Ordner)", datei: "Einzelne Datei (SharePoint/OneDrive)", web: "Webseite",
};
export const FORMAT_HINT: Record<Step["format"], string> = {
  markdown: "Formatiere mit einfachem Markdown: ## Überschriften, - Listen, Tabellen nur wenn sie helfen. Beginne direkt mit dem Ergebnis.",
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
};

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
    w.quellen.length ? "Hinterlegte Wissensquellen:\n" + w.quellen.map((x) => `- ${x.titel || x.url} (${QUELL_TYP[x.typ] ?? "Quelle"})${x.url ? ": " + x.url : ""}`).join("\n")
      + "\nQuellenangaben schreibst du als Markdown-Link [Dokument, Abschnitt](Adresse), sobald du die Adresse des Dokuments kennst (aus den Auszügen oder dieser Liste); so öffnet sich die Quelle direkt." : "",
    WISSEN_TEXT[w.modus],
    FORMAT_HINT[step.format],
  ].filter(Boolean).join("\n\n");
}

/** Welche Datei aus dem Ergebnis entsteht: fest eingestellt oder (bei „wunsch“) aus Aufgabe und Eingaben erkannt. */
export function ergebnisDateiFuer(step: Step, nachricht: string): DateiArt | null {
  if (step.format === "json" || !step.datei) return null;
  return step.datei === "wunsch" ? dateiWunsch(nachricht) : step.datei;
}

/** Zusatz zum Systemtext, wenn ein Dateipaket Vorlagen aus SharePoint kopieren darf */
export const KOPIEN_HINWEIS = 'Vorlagen kopieren: Das Paket darf zusätzlich "ordner": ["Pfad/leerer Ordner"] (leere Ordner, die angelegt werden) und "kopien": [{"quelle": "Pfad aus der Vorlagenliste", "ziel": "Ordner/Dateiname im Paket"}] enthalten. Kopien werden unverändert aus dem Vorlagenordner übernommen; "quelle" muss genau einem Eintrag der Vorlagenliste entsprechen, und der Dateiname im "ziel" bleibt exakt der Dateiname der Quelle (auch mit Leerzeichen und Umlauten; die Regel „ohne Umlaute und Leerzeichen“ gilt nur für Dateien, die du selbst schreibst). Einträge mit dem Vermerk „inhaltsgleich“ darfst du kopieren; Einträge mit „unterschiedlichem Inhalt, nicht kopieren“ und Vorlagen, die nicht in der Liste stehen, kopierst du nicht und nennst das als offenen Punkt.';

export function buildRequest(app: App, step: Step, ctx: Record<string, string>, files?: Record<string, FileInfo>, vorlagen?: { url: string; text: string }, auszuege = ""): KiRequest {
  const w = wissenFuer(app, step);
  const inPrompt = new Set(varsIn(step.prompt));
  const used = new Set(varsIn(step.prompt + " " + w.text));
  let nachricht = fill(step.prompt, ctx);
  if (step.autoAll) {
    const rest = fieldsOf(app).filter((b) => !inPrompt.has(b.props.key.toLowerCase()));
    rest.forEach((b) => used.add(b.props.key.toLowerCase()));
    if (rest.length) nachricht = (nachricht.trim() ? nachricht.trim() + "\n\n" : "") + "Eingaben:\n\n" +
      rest.map((b) => `${b.props.label}:\n${ctx[b.props.key.toLowerCase()] ?? ""}`).join("\n\n");
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
    system: [systemText(app, step, fill(w.text, ctx)), vorlagen ? KOPIEN_HINWEIS : "", !ergebnisDatei ? "" : step.format === "dateien"
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
