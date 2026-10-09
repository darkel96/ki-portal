import type { App, Step } from "./schema";
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
  system: string;
  nachricht: string;
  variablen: Record<string, string | null>;
};

const quellenOf = (s: Step) => s.quellen.filter((q) => q.url || q.titel);

export function systemText(app: Pick<App, "name">, step: Step, wissen: string): string {
  const q = quellenOf(step);
  return [
    `Du arbeitest in der Applikation „${app.name}“ eines internen KI-Hubs. Antworte auf Deutsch.`,
    step.rolle,
    wissen ? `Hintergrundwissen:\n${wissen}` : "",
    q.length ? "Hinterlegte Wissensquellen:\n" + q.map((x) => `- ${x.titel || x.url} (${QUELL_TYP[x.typ] ?? "Quelle"})${x.url ? ": " + x.url : ""}`).join("\n") : "",
    FORMAT_HINT[step.format],
  ].filter(Boolean).join("\n\n");
}

/** Welche Datei aus dem Ergebnis entsteht: fest eingestellt oder (bei „wunsch“) aus Aufgabe und Eingaben erkannt. */
export function ergebnisDateiFuer(step: Step, nachricht: string): DateiArt | null {
  if (step.format === "json" || !step.datei) return null;
  return step.datei === "wunsch" ? dateiWunsch(nachricht) : step.datei;
}

export function buildRequest(app: App, step: Step, ctx: Record<string, string>, files?: Record<string, FileInfo>): KiRequest {
  const inPrompt = new Set(varsIn(step.prompt));
  const used = new Set(varsIn(step.prompt + " " + step.wissen));
  let nachricht = fill(step.prompt, ctx);
  if (step.autoAll) {
    const rest = fieldsOf(app).filter((b) => !inPrompt.has(b.props.key.toLowerCase()));
    rest.forEach((b) => used.add(b.props.key.toLowerCase()));
    if (rest.length) nachricht = (nachricht.trim() ? nachricht.trim() + "\n\n" : "") + "Eingaben:\n\n" +
      rest.map((b) => `${b.props.label}:\n${ctx[b.props.key.toLowerCase()] ?? ""}`).join("\n\n");
  }
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
    websuche: step.web,
    wissensquellen: quellenOf(step).map((q) => ({ typ: q.typ, titel: q.titel, url: q.url })),
    dateien,
    system: [systemText(app, step, fill(step.wissen, ctx)), !ergebnisDatei ? "" : step.format === "dateien"
      ? `Dokumente im Paket (Berichte, Dokumentationen, Protokolle) schreibst du als Markdown-Dateien mit Endung .md, niemals als HTML zum Ausdrucken. Der Hub wandelt sie beim Herunterladen selbst in ${DATEI_ART[ergebnisDatei].label}-Dateien um.`
      : DATEI_HINWEIS[ergebnisDatei]].filter(Boolean).join("\n\n"),
    nachricht,
    variablen,
  };
}

/** Die Nachricht, wie sie als ein Text an Copilot geht (Copilot kennt keine getrennte System-Nachricht). */
export const combinedMessage = (req: Pick<KiRequest, "system" | "nachricht">) => `${req.system}\n\n---\n\n${req.nachricht}`;

/** Lesbare Darstellung der Graph-Aufrufe der zentralen KI-Anbindung (Anfrage-Vorschau). */
export function graphPreview(step: Step, req: KiRequest): string {
  const parts: string[] = [];
  parts.push("// Zentrale KI-Anbindung des KI-Hubs (Azure-Anwendung)\n// Token: MSAL mit Single Sign-on, delegierte Graph-Berechtigungen.\n// Header bei jedem Aufruf: Authorization: Bearer <Token>");
  const refs = req.dateien.filter((d) => d.uebergabe === "referenz");
  const files = quellenOf(step).filter((q) => q.typ === "datei" && q.url).map((q) => ({ uri: q.url }));
  refs.forEach((d) => files.push({ uri: `<OneDrive-Adresse von ${d.name ?? d.feld}>` }));
  if (refs.length) parts.push("// 0) Hochgeladene Datei(en) nach OneDrive legen\nPUT https://graph.microsoft.com/v1.0/me/drive/root:/KI-Hub/<dateiname>:/content\n<Dateiinhalt>");
  const sp = quellenOf(step).filter((q) => q.typ === "sharepoint" && q.url);
  if (sp.length) parts.push("// 1) Passende Inhalte aus SharePoint holen (Retrieval API)\nPOST https://graph.microsoft.com/v1.0/copilot/retrieval\n" +
    JSON.stringify({ queryString: "<Suchbegriffe aus Aufgabe und Eingaben>", dataSource: "sharePoint", filterExpression: sp.map((q) => `path:"${q.url}"`).join(" OR "), maximumNumberOfResults: 10 }, null, 2));
  parts.push("// 2) Gespräch anlegen\nPOST https://graph.microsoft.com/beta/copilot/conversations\n{}");
  const body: Record<string, unknown> = { message: { text: combinedMessage(req) }, locationHint: { timeZone: "Europe/Berlin" }, contextualResources: { ...(files.length ? { files } : {}), webContext: { isWebEnabled: req.websuche } } };
  parts.push("// 3) Nachricht senden. Antwort: der letzte Text in „messages“, der nicht die eigene Frage ist\nPOST https://graph.microsoft.com/beta/copilot/conversations/{conversationId}/chat\n" + JSON.stringify(body, null, 2));
  parts.push(`// Hinweise\n// - Die Modellwahl („${MODELL_LABEL[req.modell]}“) hat bei Copilot keine Wirkung.\n// - Voraussetzungen: Microsoft-365-Copilot-Lizenz, Anmeldung über Entra ID, delegierte Berechtigungen.\n// - Endpunkte und Felder: Stand Mitte 2026, vor Inbetriebnahme mit der Graph-Dokumentation abgleichen.`);
  return parts.join("\n\n");
}
