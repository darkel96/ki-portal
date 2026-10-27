/**
 * Postfach der angemeldeten Person über Microsoft Graph (delegiert, Mail.Read): Ordner und Nachrichten wie in Outlook.
 * Erster Schritt: nur anzeigen. Ohne Copilot-Anbindung (Testmodus, eigener Schlüssel, Simulation) zeigt der Hub ein
 * Beispielpostfach, damit sich der Baustein ansehen und prüfen lässt.
 */
import { graphToken, nutzerKennung } from "./auth";
import { graphTestToken } from "./graph";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";
import { passtZumThema } from "../themensuche";

export type Ordner = { id: string; name: string; ungelesen: number; gesamt: number; kinder?: Ordner[] };
export type Nachricht = { id: string; betreff: string; von: string; vonAdresse: string; empfangen: string; gelesen: boolean; anhang: boolean; vorschau: string; wichtig: boolean };
export type NachrichtVoll = Nachricht & { an: string[]; cc: string[]; html: string; text: string };
export type NachrichtenSeite = { liste: Nachricht[]; weiter: string | null };

const GRAPH = `${KI_CONFIG.graph}/v1.0/me`;
const SCOPES = ["https://graph.microsoft.com/Mail.Read"];
/** Verschieben, Ordner anlegen, Entwürfe: braucht die Zustimmung zu Mail.ReadWrite (einmal im Anmeldefenster) */
const SCOPES_SCHREIBEN = ["https://graph.microsoft.com/Mail.ReadWrite"];
/** Bekannte Ordnernamen in der Reihenfolge von Outlook */
const REIHENFOLGE = ["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive"];
const DEUTSCH: Record<string, string> = { inbox: "Posteingang", drafts: "Entwürfe", sentitems: "Gesendete Elemente", deleteditems: "Gelöschte Elemente", junkemail: "Junk-E-Mail", archive: "Archiv", outbox: "Postausgang" };

/** Echtes Postfach über Graph: mit Copilot-Anmeldung (in der Entwicklung auch mit Test-Token „kihub-graph-test“) */
export const postfachEcht = () => kiModus() === "copilot" || !!graphTestToken();

const warten = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, fehler) => {
  if (signal?.aborted) { fehler(new DOMException("Abgebrochen", "AbortError")); return; }
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); fehler(new DOMException("Abgebrochen", "AbortError")); }, { once: true });
});

/**
 * Exchange erlaubt je Postfach nur wenige gleichzeitige Anfragen; mehr enden mit 429 (ApplicationThrottled) und
 * langen Wartezeiten. Daher laufen höchstens drei Graph-Aufrufe des Postfachs gleichzeitig, der Rest wartet kurz.
 */
let laufend = 0;
const warteschlange: (() => void)[] = [];
async function platz<T>(f: () => Promise<T>): Promise<T> {
  if (laufend >= 3) await new Promise<void>((ok) => warteschlange.push(ok));
  laufend++;
  try { return await f(); } finally { laufend--; warteschlange.shift()?.(); }
}

async function graph<T>(pfad: string, signal?: AbortSignal, opts: { method?: string; body?: unknown; schreiben?: boolean } = {}): Promise<T> {
  const token = graphTestToken() ?? await graphToken(opts.schreiben ? SCOPES_SCHREIBEN : SCOPES);
  const senden = () => fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, {
    method: opts.method ?? "GET", signal,
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="html"', ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let r = await platz(senden);
  // Zu viele Anfragen (429) oder kurz überlastet (503): so lange warten, wie Microsoft sagt, und erneut versuchen
  for (let versuch = 0; (r.status === 429 || r.status === 503) && versuch < 6; versuch++) {
    const sek = Number(r.headers.get("Retry-After"));
    await warten(Math.min(30, Number.isFinite(sek) && sek > 0 ? sek : 2 ** versuch) * 1000, signal);
    r = await platz(senden);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? `Kein Zugriff auf das Postfach (Berechtigung ${opts.schreiben ? "Mail.ReadWrite" : "Mail.Read"} fehlt oder wurde nicht zugestimmt).` : r.status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden." : `Graph antwortet mit Fehler ${r.status}${code ? ` (${code})` : ""}.`);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

type GraphOrdner = { id: string; displayName: string; unreadItemCount?: number; totalItemCount?: number; childFolderCount?: number };
type GraphNachricht = { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: { emailAddress?: { name?: string; address?: string } }[]; ccRecipients?: { emailAddress?: { name?: string; address?: string } }[]; receivedDateTime?: string; isRead?: boolean; hasAttachments?: boolean; bodyPreview?: string; importance?: string; body?: { contentType?: string; content?: string } };

const ordnerAus = (o: GraphOrdner, bekannt?: string): Ordner => ({ id: o.id, name: (bekannt && DEUTSCH[bekannt]) || o.displayName, ungelesen: o.unreadItemCount ?? 0, gesamt: o.totalItemCount ?? 0 });
const nachrichtAus = (m: GraphNachricht): Nachricht => ({
  id: m.id, betreff: m.subject?.trim() || "(kein Betreff)", von: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "", vonAdresse: m.from?.emailAddress?.address || "",
  empfangen: m.receivedDateTime ?? "", gelesen: m.isRead ?? true, anhang: !!m.hasAttachments, vorschau: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200), wichtig: m.importance === "high",
});
const namen = (l?: { emailAddress?: { name?: string; address?: string } }[]) => (l ?? []).map((x) => x.emailAddress?.name || x.emailAddress?.address || "").filter(Boolean);

/** Zwischenspeicher im Browser je Person (Ordner-IDs ändern sich nicht; die Ordnerliste zeigt sich so sofort) */
async function merkSchluessel(was: string): Promise<string | null> { const k = await nutzerKennung(); return k ? `kihub-postfach-${was}:${k}` : null; }
async function gemerkt<T>(was: string): Promise<T | null> {
  try { const k = await merkSchluessel(was); return k ? (JSON.parse(localStorage.getItem(k) || "null") as T | null) : null; } catch { return null; }
}
async function merken(was: string, wert: unknown) { try { const k = await merkSchluessel(was); if (k) localStorage.setItem(k, JSON.stringify(wert)); } catch { /* voll oder gesperrt */ } }

/** IDs der bekannten Ordner (Posteingang, Gelöschte …): einmal je Person holen, dann aus dem Speicher */
let bekannteIdsCache: Record<string, string> | null = null;
async function bekannteOrdnerIds(signal?: AbortSignal): Promise<Record<string, string>> {
  if (bekannteIdsCache) return bekannteIdsCache;
  const alt = await gemerkt<Record<string, string>>("bekannt");
  if (alt && REIHENFOLGE.every((w) => w in alt)) return (bekannteIdsCache = alt);
  const paare = await Promise.all(REIHENFOLGE.map(async (w) => { try { return [w, (await graph<{ id: string }>(`/mailFolders/${w}?$select=id`, signal)).id] as const; } catch { return [w, ""] as const; } }));
  const ids: Record<string, string> = Object.fromEntries(paare);
  // Nur merken, wenn alles da ist (ein Archiv gibt es nicht in jedem Postfach); sonst beim nächsten Mal neu fragen
  if (REIHENFOLGE.every((w) => ids[w] || w === "archive")) { bekannteIdsCache = ids; await merken("bekannt", ids); }
  return ids;
}

/** Zuletzt geladene Ordnerliste dieser Person (sofort anzeigen, während die frische lädt) */
export async function ordnerGemerkt(): Promise<Ordner[] | null> { return postfachEcht() ? gemerkt<Ordner[]>("ordner") : null; }

/**
 * Oberste Ordner (bekannte zuerst, dann alphabetisch), je mit den direkten Unterordnern. Die stabile Graph-Schnittstelle
 * kennt kein Feld für den bekannten Ordnernamen; die IDs von Posteingang, Entwürfe usw. werden daher einzeln geholt.
 */
export async function ordnerLaden(signal?: AbortSignal): Promise<Ordner[]> {
  if (!postfachEcht()) return beispiel.ordner;
  const [alle, bekannt] = await Promise.all([
    graph<{ value: GraphOrdner[] }>("/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount", signal).then((j) => j.value),
    bekannteOrdnerIds(signal),
  ]);
  const bekannteIds = new Map(Object.entries(bekannt).filter(([, id]) => id).map(([w, id]) => [id, w] as const));
  const rang = (o: GraphOrdner) => { const i = REIHENFOLGE.indexOf(bekannteIds.get(o.id) ?? ""); return i < 0 ? 99 : i; };
  const sortiert = [...alle].sort((a, b) => rang(a) - rang(b) || a.displayName.localeCompare(b.displayName, "de"));
  const liste = await Promise.all(sortiert.map(async (o) => {
    const ordner = ordnerAus(o, bekannteIds.get(o.id));
    if (o.childFolderCount) {
      const kinder = (await graph<{ value: GraphOrdner[] }>(`/mailFolders/${encodeURIComponent(o.id)}/childFolders?$top=50&$select=id,displayName,unreadItemCount,totalItemCount`, signal).catch(() => ({ value: [] as GraphOrdner[] }))).value;
      ordner.kinder = kinder.map((k) => ordnerAus(k)).sort((a, b) => a.name.localeCompare(b.name, "de"));
    }
    return ordner;
  }));
  await merken("ordner", liste);
  return liste;
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

/** Nachrichten der letzten Tage aus dem ganzen Postfach (ohne Gelöschte, Junk, Entwürfe, Gesendete), neueste zuerst, höchstens 300 */
export async function nachrichtenSeit(tage: number, signal?: AbortSignal, max = 300): Promise<(Nachricht & { ordnerId: string })[]> {
  const ab = new Date(Date.now() - tage * 86_400_000);
  if (!postfachEcht()) {
    return beispiel.nachrichten.filter((n) => Date.parse(n.empfangen) >= ab.getTime() && !["deleteditems", "junkemail", "drafts", "sentitems"].includes(n.ordner))
      .sort((a, b) => b.empfangen.localeCompare(a.empfangen)).map(({ ordner, an: _a, cc: _c, html: _h, text: _t, ...n }) => ({ ...n, ordnerId: ordner }));
  }
  const ids = await bekannteOrdnerIds(signal);
  const weg = new Set(["deleteditems", "junkemail", "drafts", "sentitems"].map((w) => ids[w]).filter(Boolean));
  const aus: (Nachricht & { ordnerId: string })[] = [];
  let pfad: string | null = `/messages?$filter=receivedDateTime ge ${ab.toISOString()}&$orderby=receivedDateTime desc&$top=100&$select=id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,importance,parentFolderId`;
  while (pfad && aus.length < max) {
    const j: { value: (GraphNachricht & { parentFolderId?: string })[]; "@odata.nextLink"?: string } = await graph(pfad, signal);
    for (const m of j.value) if (!weg.has(m.parentFolderId ?? "")) aus.push({ ...nachrichtAus(m), ordnerId: m.parentFolderId ?? "" });
    pfad = j["@odata.nextLink"] ?? null;
  }
  return aus.slice(0, max);
}

/**
 * Volltextsuche über alle Ordner im Zeitraum (Betreff, Text, Absender; Graph „$search“ mit KQL). Ein Treffer reicht
 * für eines der Wörter; ein Begriff aus mehreren Wörtern braucht alle. Gelöschte, Junk, Entwürfe und Gesendete fallen weg.
 */
export async function nachrichtenSuchen(begriffe: string[], tage: number, signal?: AbortSignal, max = 1000): Promise<(Nachricht & { ordnerId: string })[]> {
  const ab = new Date(Date.now() - tage * 86_400_000);
  const saetze = begriffe.map((b) => b.replace(/["\\()]/g, " ").split(/\s+/).filter((w) => w.length >= 2)).filter((l) => l.length);
  if (!saetze.length) return [];
  const weglassen = ["deleteditems", "junkemail", "drafts", "sentitems"];
  if (!postfachEcht()) {
    return beispiel.nachrichten.filter((n) => Date.parse(n.empfangen) >= ab.getTime() && !weglassen.includes(n.ordner)
      && saetze.some((l) => l.every((w) => passtZumThema(`${n.betreff} ${n.von} ${n.vonAdresse} ${n.text}`, [w.toLowerCase()]))))
      .sort((a, b) => b.empfangen.localeCompare(a.empfangen)).map(({ ordner, an: _a, cc: _c, html: _h, text: _t, ...n }) => ({ ...n, ordnerId: ordner }));
  }
  const ids = await bekannteOrdnerIds(signal);
  const weg = new Set(weglassen.map((w) => ids[w]).filter(Boolean));
  const kql = `(${saetze.map((l) => (l.length > 1 ? `(${l.join(" AND ")})` : l[0])).join(" OR ")}) AND received>=${ab.toISOString().slice(0, 10)}`;
  const aus = new Map<string, Nachricht & { ordnerId: string }>();
  let pfad: string | null = `/messages?$search=${encodeURIComponent(`"${kql}"`)}&$top=100&$select=id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,importance,parentFolderId`;
  while (pfad && aus.size < max) {
    const j: { value: (GraphNachricht & { parentFolderId?: string })[]; "@odata.nextLink"?: string } = await graph(pfad, signal);
    for (const m of j.value) {
      if (weg.has(m.parentFolderId ?? "") || Date.parse(m.receivedDateTime ?? "") < ab.getTime()) continue;
      aus.set(m.id, { ...nachrichtAus(m), ordnerId: m.parentFolderId ?? "" });
    }
    pfad = j["@odata.nextLink"] ?? null;
  }
  return [...aus.values()].sort((a, b) => b.empfangen.localeCompare(a.empfangen)).slice(0, max);
}

/** Namen der Ordner zu IDs: erst aus der geladenen Ordnerliste, unbekannte (tiefere Unterordner) einzeln bei Graph */
const ordnerNamenCache = new Map<string, string>();
export async function ordnerNamen(ids: string[], bekannt: Ordner[], signal?: AbortSignal): Promise<Record<string, string>> {
  const aus: Record<string, string> = {};
  const flach = (l: Ordner[]): Ordner[] => l.flatMap((o) => [o, ...flach(o.kinder ?? [])]);
  for (const o of flach(postfachEcht() ? bekannt : beispiel.ordner)) aus[o.id] = o.name;
  const fehlen = [...new Set(ids)].filter((id) => id && !aus[id]);
  for (const id of fehlen) {
    if (!ordnerNamenCache.has(id) && postfachEcht()) {
      try { ordnerNamenCache.set(id, (await graph<{ displayName: string }>(`/mailFolders/${encodeURIComponent(id)}?$select=displayName`, signal)).displayName); }
      catch { ordnerNamenCache.set(id, ""); }
    }
    aus[id] = ordnerNamenCache.get(id) ?? "";
  }
  return aus;
}

/** Nachrichten in einen Ordner verschieben; liefert die Zahl der verschobenen */
export async function nachrichtenVerschieben(ids: string[], zielOrdnerId: string, signal?: AbortSignal, verschoben?: (id: string) => void): Promise<number> {
  if (!postfachEcht()) {
    let n = 0;
    for (const m of beispiel.nachrichten) if (ids.includes(m.id) && m.ordner !== zielOrdnerId) { m.ordner = zielOrdnerId; n++; verschoben?.(m.id); }
    return n;
  }
  let n = 0;
  for (const id of ids) {
    try { await graph(`/messages/${encodeURIComponent(id)}/move`, signal, { method: "POST", body: { destinationId: zielOrdnerId }, schreiben: true }); }
    catch (e) { throw n ? new Error(`${n} von ${ids.length} Mails verschoben, dann: ${e instanceof Error ? e.message : String(e)} Erneut starten verschiebt den Rest.`) : e; }
    n++; verschoben?.(id);
  }
  return n;
}

/** Ordner anlegen (unter dem Posteingang oder oberste Ebene); gibt es ihn schon, den vorhandenen liefern */
export async function ordnerAnlegen(name: string, signal?: AbortSignal): Promise<Ordner> {
  const alle = await ordnerLaden(signal);
  const flach = alle.flatMap((o) => [o, ...(o.kinder ?? [])]);
  const da = flach.find((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (da) return da;
  if (!postfachEcht()) { const o = { id: `neu-${Date.now().toString(36)}`, name: name.trim(), ungelesen: 0, gesamt: 0 }; beispiel.ordner.push(o); return o; }
  const o = await graph<GraphOrdner>("/mailFolders", signal, { method: "POST", body: { displayName: name.trim() }, schreiben: true });
  return ordnerAus(o);
}

/** Antwortentwurf in Outlook anlegen (Antwort an den Absender, Text oben, Original darunter); liefert den Link zum Entwurf */
export async function antwortEntwurf(id: string, text: string, signal?: AbortSignal): Promise<{ webLink: string }> {
  if (!postfachEcht()) return { webLink: "" };
  const e = await graph<{ id: string; webLink?: string; body?: { content?: string } }>(`/messages/${encodeURIComponent(id)}/createReply`, signal, { method: "POST", body: {}, schreiben: true });
  const html = `<div>${text.split(/\n/).map((z) => z.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>")}</div><br>${e.body?.content ?? ""}`;
  await graph(`/messages/${encodeURIComponent(e.id)}`, signal, { method: "PATCH", body: { body: { contentType: "html", content: html } }, schreiben: true });
  return { webLink: e.webLink ?? "" };
}

/** Lesbarer Text einer Nachricht für die KI (HTML entfernt, begrenzt) */
export function nachrichtAlsText(n: NachrichtVoll, max = 12_000): string {
  let t = n.text;
  if (!t && n.html) {
    const doc = new DOMParser().parseFromString(n.html, "text/html");
    doc.querySelectorAll("style,script,head").forEach((e) => e.remove());
    t = (doc.body?.innerText ?? doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  }
  return t.slice(0, max);
}
/** Kopf und Text einer Nachricht als Kontext für die KI */
export const mailKontext = (n: NachrichtVoll) => [`Betreff: ${n.betreff}`, `Von: ${n.von}${n.vonAdresse ? ` <${n.vonAdresse}>` : ""}`, n.an.length ? `An: ${n.an.join(", ")}` : "", n.cc.length ? `Cc: ${n.cc.join(", ")}` : "", `Datum: ${n.empfangen}`, "", nachrichtAlsText(n)].filter((z) => z !== "").join("\n");

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
