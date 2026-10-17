/**
 * Postfach der angemeldeten Person über Microsoft Graph (delegiert, Mail.Read): Ordner und Nachrichten wie in Outlook.
 * Erster Schritt: nur anzeigen. Ohne Copilot-Anbindung (Testmodus, eigener Schlüssel, Simulation) zeigt der Hub ein
 * Beispielpostfach, damit sich der Baustein ansehen und prüfen lässt.
 */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";

export type Ordner = { id: string; name: string; ungelesen: number; gesamt: number; kinder?: Ordner[] };
export type Nachricht = { id: string; betreff: string; von: string; vonAdresse: string; empfangen: string; gelesen: boolean; anhang: boolean; vorschau: string; wichtig: boolean };
export type NachrichtVoll = Nachricht & { an: string[]; cc: string[]; html: string; text: string };
export type NachrichtenSeite = { liste: Nachricht[]; weiter: string | null };

const GRAPH = `${KI_CONFIG.graph}/v1.0/me`;
const SCOPES = ["https://graph.microsoft.com/Mail.Read"];
/** Bekannte Ordnernamen in der Reihenfolge von Outlook */
const REIHENFOLGE = ["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive"];
const DEUTSCH: Record<string, string> = { inbox: "Posteingang", drafts: "Entwürfe", sentitems: "Gesendete Elemente", deleteditems: "Gelöschte Elemente", junkemail: "Junk-E-Mail", archive: "Archiv", outbox: "Postausgang" };

export const postfachEcht = () => kiModus() === "copilot";

async function graph<T>(pfad: string, signal?: AbortSignal): Promise<T> {
  const token = await graphToken(SCOPES);
  const r = await fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="html"' }, signal });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "Kein Zugriff auf das Postfach (Berechtigung Mail.Read fehlt oder wurde nicht zugestimmt)." : r.status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden." : `Graph antwortet mit Fehler ${r.status}${code ? ` (${code})` : ""}.`);
  }
  return (await r.json()) as T;
}

type GraphOrdner = { id: string; displayName: string; unreadItemCount?: number; totalItemCount?: number; childFolderCount?: number; wellKnownName?: string };
type GraphNachricht = { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: { emailAddress?: { name?: string; address?: string } }[]; ccRecipients?: { emailAddress?: { name?: string; address?: string } }[]; receivedDateTime?: string; isRead?: boolean; hasAttachments?: boolean; bodyPreview?: string; importance?: string; body?: { contentType?: string; content?: string } };

const ordnerAus = (o: GraphOrdner): Ordner => ({ id: o.id, name: (o.wellKnownName && DEUTSCH[o.wellKnownName.toLowerCase()]) || o.displayName, ungelesen: o.unreadItemCount ?? 0, gesamt: o.totalItemCount ?? 0 });
const nachrichtAus = (m: GraphNachricht): Nachricht => ({
  id: m.id, betreff: m.subject?.trim() || "(kein Betreff)", von: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "", vonAdresse: m.from?.emailAddress?.address || "",
  empfangen: m.receivedDateTime ?? "", gelesen: m.isRead ?? true, anhang: !!m.hasAttachments, vorschau: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200), wichtig: m.importance === "high",
});
const namen = (l?: { emailAddress?: { name?: string; address?: string } }[]) => (l ?? []).map((x) => x.emailAddress?.name || x.emailAddress?.address || "").filter(Boolean);

/** Oberste Ordner (bekannte zuerst, dann alphabetisch), je mit den direkten Unterordnern */
export async function ordnerLaden(signal?: AbortSignal): Promise<Ordner[]> {
  if (!postfachEcht()) return beispiel.ordner;
  const alle = (await graph<{ value: GraphOrdner[] }>("/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount,wellKnownName", signal)).value;
  const rang = (o: GraphOrdner) => { const i = REIHENFOLGE.indexOf((o.wellKnownName ?? "").toLowerCase()); return i < 0 ? 99 : i; };
  const sortiert = [...alle].sort((a, b) => rang(a) - rang(b) || a.displayName.localeCompare(b.displayName, "de"));
  return Promise.all(sortiert.map(async (o) => {
    const ordner = ordnerAus(o);
    if (o.childFolderCount) {
      const kinder = (await graph<{ value: GraphOrdner[] }>(`/mailFolders/${encodeURIComponent(o.id)}/childFolders?$top=50&$select=id,displayName,unreadItemCount,totalItemCount`, signal).catch(() => ({ value: [] as GraphOrdner[] }))).value;
      ordner.kinder = kinder.map(ordnerAus).sort((a, b) => a.name.localeCompare(b.name, "de"));
    }
    return ordner;
  }));
}

/** Nachrichten eines Ordners, neueste zuerst; weiter = Adresse der nächsten Seite; suche durchsucht Betreff, Absender und Text */
export async function nachrichtenLaden(ordnerId: string, anzahl: number, opts: { weiter?: string | null; suche?: string } = {}, signal?: AbortSignal): Promise<NachrichtenSeite> {
  if (!postfachEcht()) return beispielNachrichten(ordnerId, opts.suche ?? "");
  const felder = "$select=id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,importance";
  const pfad = opts.weiter ?? (opts.suche?.trim()
    ? `/mailFolders/${encodeURIComponent(ordnerId)}/messages?$search="${opts.suche.trim().replace(/"/g, "")}"&$top=${anzahl}&${felder}`
    : `/mailFolders/${encodeURIComponent(ordnerId)}/messages?$top=${anzahl}&$orderby=receivedDateTime desc&${felder}`);
  const j = await graph<{ value: GraphNachricht[]; "@odata.nextLink"?: string }>(pfad, signal);
  return { liste: j.value.map(nachrichtAus), weiter: j["@odata.nextLink"] ?? null };
}

/** Eine Nachricht mit Empfängern und Inhalt (HTML wird in der Anzeige bereinigt) */
export async function nachrichtLaden(id: string, signal?: AbortSignal): Promise<NachrichtVoll> {
  if (!postfachEcht()) {
    const n = beispiel.nachrichten.find((x) => x.id === id);
    if (!n) throw new Error("Die Nachricht wurde nicht gefunden.");
    return n;
  }
  const m = await graph<GraphNachricht>(`/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview,importance,body`, signal);
  const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? "") : "";
  return { ...nachrichtAus(m), an: namen(m.toRecipients), cc: namen(m.ccRecipients), html, text: html ? "" : (m.body?.content ?? "") };
}

/* ---------- Beispielpostfach (ohne Copilot-Anbindung) ---------- */
const tag = (vorTagen: number, stunde: number) => { const d = new Date(); d.setDate(d.getDate() - vorTagen); d.setHours(stunde, 15, 0, 0); return d.toISOString(); };
const bsp = (id: string, ordner: string, betreff: string, von: string, vonAdresse: string, vorTagen: number, stunde: number, text: string, extra: Partial<NachrichtVoll> = {}): NachrichtVoll & { ordner: string } => ({
  id, ordner, betreff, von, vonAdresse, empfangen: tag(vorTagen, stunde), gelesen: true, anhang: false, wichtig: false, vorschau: text.replace(/\s+/g, " ").slice(0, 200), an: ["Dario Keller"], cc: [], html: "", text, ...extra,
});
const beispiel = {
  ordner: [
    { id: "inbox", name: "Posteingang", ungelesen: 2, gesamt: 5, kinder: [{ id: "inbox-cra", name: "CRA", ungelesen: 0, gesamt: 1 }, { id: "inbox-projekte", name: "Projekte", ungelesen: 0, gesamt: 0 }] },
    { id: "drafts", name: "Entwürfe", ungelesen: 0, gesamt: 0 },
    { id: "sentitems", name: "Gesendete Elemente", ungelesen: 0, gesamt: 1 },
    { id: "deleteditems", name: "Gelöschte Elemente", ungelesen: 0, gesamt: 0 },
    { id: "archive", name: "Archiv", ungelesen: 0, gesamt: 0 },
  ] as Ordner[],
  nachrichten: [
    bsp("m1", "inbox", "CRA Attest Retrofit Linie 3: Freigabe bis Freitag", "Anna Berger", "anna.berger@koerber.com", 0, 9, "Hallo Dario,\n\nkannst du das CRA Attest für die Linie 3 bis Freitag freigeben? Die Projekt-IT hat das Hardening-Assessment abgeschlossen, der Bericht hängt an.\n\nViele Grüße\nAnna", { gelesen: false, anhang: true, wichtig: true }),
    bsp("m2", "inbox", "Schulung Maschinenverordnung und CRA, Termin 2", "Thomas Bothmann", "thomas.bothmann@koerber.com", 1, 14, "Liebe Kolleginnen und Kollegen,\n\nder zweite Termin der Schulung findet am Donnerstag um 10 Uhr statt. Die Unterlagen vom ersten Termin liegen in der KSC Cybersecurity Library.\n\nBeste Grüße\nThomas", { gelesen: false }),
    bsp("m3", "inbox", "Rückfrage SBOM für Steuerungssoftware", "Projekt-IT", "projekt-it@koerber.com", 2, 11, "Hallo,\n\nfür die Steuerungssoftware brauchen wir die SBOM im SPDX-Format. Könnt ihr sie bis Ende der Woche liefern?\n\nDanke"),
    bsp("m4", "inbox", "Angebot Serviceleistungen Kunde Nordhafen", "Sales-Service", "sales-service@koerber.com", 4, 16, "Das Angebot für Nordhafen ist fertig. Die Service-Checkliste ist ausgefüllt, bitte einmal gegenlesen.", { anhang: true }),
    bsp("m5", "inbox", "Wochenbericht Produktsicherheit KW 42", "Produktsicherheit", "pss@koerber.com", 6, 8, "Im Anhang der Wochenbericht: drei neue CVEs bewertet, zwei Hardening-Prüfungen abgeschlossen, ein Pen-Test geplant.", { anhang: true }),
    bsp("m6", "inbox-cra", "VDMA CRA FAQ 2.0 veröffentlicht", "VDMA Newsletter", "newsletter@vdma.org", 9, 7, "Die aktualisierte FAQ zum Cyber Resilience Act ist online. Neu sind die Fragen zu wesentlichen Änderungen bei Umbauten."),
    bsp("m7", "sentitems", "AW: CRA Attest Retrofit Linie 3", "Dario Keller", "dario.keller@koerber.com", 0, 10, "Hallo Anna,\n\nich schaue mir den Bericht heute an und melde mich bis morgen.\n\nViele Grüße\nDario", { an: ["Anna Berger"] }),
  ],
};
function beispielNachrichten(ordnerId: string, suche: string): NachrichtenSeite {
  const s = suche.trim().toLowerCase();
  const liste = beispiel.nachrichten.filter((n) => n.ordner === ordnerId && (!s || `${n.betreff} ${n.von} ${n.text}`.toLowerCase().includes(s)))
    .sort((a, b) => b.empfangen.localeCompare(a.empfangen)).map(({ ordner: _o, an: _a, cc: _c, html: _h, text: _t, ...n }) => n);
  return { liste, weiter: null };
}
