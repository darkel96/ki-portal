/**
 * Aufgaben in Microsoft 365 anlegen (delegiert, Tasks.ReadWrite): Team-Aufgaben in einem Planner-Plan (in Teams
 * sichtbar) oder Meine Aufgaben in Microsoft To Do. Die KI liest die Aufgaben aus einem Ergebnis; angelegt wird erst,
 * nachdem die Person die Auswahl geprüft hat. Ohne Copilot-Anbindung arbeitet der Baustein mit Beispielplänen.
 */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { graphTestToken } from "./graph";
import { jsonAus, kiFragen, kiModus } from "./index";

export type Prioritaet = "hoch" | "mittel" | "niedrig";
export type Aufgabe = { titel: string; faellig: string; zustaendig: string; notiz: string; prioritaet: Prioritaet };
export type Ablage = { id: string; name: string };
export type AufgabenZiel = "planner" | "todo";

const GRAPH = `${KI_CONFIG.graph}/v1.0`;
const SCOPES = ["https://graph.microsoft.com/Tasks.ReadWrite", "https://graph.microsoft.com/User.ReadBasic.All"];

export const aufgabenEcht = () => kiModus() === "copilot" || !!graphTestToken();
/**
 * Zustimmung und Token direkt beim Klick holen: Das Anmeldefenster darf nur als Folge eines Klicks aufgehen; später
 * (nach dem Lesen durch die KI) blockiert der Browser es. Danach liegt das Token im Zwischenspeicher.
 */
export async function aufgabenAnmelden(): Promise<void> {
  if (!aufgabenEcht() || graphTestToken()) return;
  await graphToken(SCOPES);
}

const warten = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Graph-Aufruf; bei 429/503 so lange warten, wie Microsoft sagt. Liefert Antwort und ETag (Planner braucht ihn zum Ändern) */
async function graph<T>(pfad: string, opts: { method?: string; body?: unknown; etag?: string } = {}): Promise<{ daten: T; etag: string }> {
  const token = graphTestToken() ?? await graphToken(SCOPES);
  const senden = () => fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, {
    method: opts.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.etag ? { "If-Match": opts.etag } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let r = await senden();
  for (let v = 0; (r.status === 429 || r.status === 503) && v < 6; v++) {
    const sek = Number(r.headers.get("Retry-After"));
    await warten(Math.min(30, Number.isFinite(sek) && sek > 0 ? sek : 2 ** v) * 1000);
    r = await senden();
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "Kein Zugriff (Berechtigung Tasks.ReadWrite fehlt oder wurde nicht zugestimmt; für fremde Pläne muss man Mitglied des Teams sein)."
      : r.status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden." : `Graph antwortet mit Fehler ${r.status}${code ? ` (${code})` : ""}.`);
  }
  const etag = r.headers.get("ETag") ?? "";
  if (r.status === 204) return { daten: undefined as T, etag };
  const daten = (await r.json()) as T & { "@odata.etag"?: string };
  return { daten, etag: etag || daten["@odata.etag"] || "" };
}
/** Alle Seiten einer Liste */
async function alle<T>(pfad: string, max = 500): Promise<T[]> {
  const aus: T[] = [];
  let p: string | null = pfad;
  while (p && aus.length < max) {
    const { daten }: { daten: { value: T[]; "@odata.nextLink"?: string } } = await graph(p);
    aus.push(...daten.value);
    p = daten["@odata.nextLink"] ?? null;
  }
  return aus;
}

/* ---------- Aus dem Ergebnis lesen ---------- */
const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const datum = (x: unknown) => { const d = text(x, 20); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ""; };
/** Die KI liest die konkreten offenen Aufgaben aus einem Ergebnis (Tabelle, Liste, Fließtext) */
export async function aufgabenAusText(ergebnis: string, signal?: AbortSignal): Promise<Aufgabe[]> {
  const heute = new Date().toISOString().slice(0, 10);
  const antwort = await kiFragen(`Lies aus diesem Ergebnis die konkreten offenen Aufgaben und Maßnahmen heraus, die jemand erledigen soll (z. B. aus einer Tabelle „Offene Punkte und Maßnahmen“ oder einer To-do-Liste). Keine Feststellungen, Risiken oder Hintergründe als Aufgabe.
Je Aufgabe:
- "titel": kurz und als Tätigkeit formuliert (höchstens 120 Zeichen), z. B. „Freigabe IP-Adressliste bei KTE einholen“.
- "faellig": Datum JJJJ-MM-TT, nur wenn es im Ergebnis steht (heute ist ${heute}); sonst "".
- "zustaendig": Name oder E-Mail, nur wenn im Ergebnis genannt; „festzulegen“, „nicht dokumentiert“ u. ä. werden "".
- "prioritaet": "hoch", "mittel" oder "niedrig" nach dem Ergebnis, sonst "mittel".
- "notiz": ein bis zwei Sätze Kontext mit Blockade oder Status und der Quelle aus dem Ergebnis.
Erfinde nichts dazu. Höchstens 30 Aufgaben. Antworte nur mit JSON: {"aufgaben": [{"titel": "…", "faellig": "", "zustaendig": "", "prioritaet": "mittel", "notiz": "…"}]}

Ergebnis:
"""
${ergebnis.slice(0, 30000)}
"""`, signal);
  const j = jsonAus(antwort) as { aufgaben?: unknown };
  const liste = Array.isArray(j.aufgaben) ? j.aufgaben : [];
  return liste.slice(0, 30).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const titel = text(o.titel, 255);
    if (!titel) return [];
    const p = text(o.prioritaet, 10).toLowerCase();
    return [{ titel, faellig: datum(o.faellig), zustaendig: text(o.zustaendig, 200), notiz: text(o.notiz, 2000), prioritaet: (p === "hoch" || p === "niedrig" ? p : "mittel") as Prioritaet }];
  });
}

/* ---------- Pläne, Buckets, Listen ---------- */
/** Planner-Pläne, in denen die Person Mitglied ist (Teams-Pläne und eigene) */
export async function plaeneLaden(): Promise<Ablage[]> {
  if (!aufgabenEcht()) return beispiel.plaene.map(({ id, name }) => ({ id, name }));
  return (await alle<{ id: string; title: string }>("/me/planner/plans?$select=id,title")).map((p) => ({ id: p.id, name: p.title })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}
export async function bucketsLaden(planId: string): Promise<Ablage[]> {
  if (!aufgabenEcht()) return beispiel.plaene.find((p) => p.id === planId)?.buckets ?? [];
  return (await alle<{ id: string; name: string; orderHint?: string }>(`/planner/plans/${encodeURIComponent(planId)}/buckets?$select=id,name,orderHint`))
    .sort((a, b) => (a.orderHint ?? "").localeCompare(b.orderHint ?? "")).map((b) => ({ id: b.id, name: b.name }));
}
/** To-Do-Listen; „Aufgaben“ (Standardliste) zuerst */
export async function listenLaden(): Promise<Ablage[]> {
  if (!aufgabenEcht()) return beispiel.listen.map(({ id, name }) => ({ id, name }));
  const l = await alle<{ id: string; displayName: string; wellknownListName?: string }>("/me/todo/lists?$select=id,displayName,wellknownListName");
  return l.sort((a, b) => Number(b.wellknownListName === "defaultList") - Number(a.wellknownListName === "defaultList")).map((x) => ({ id: x.id, name: x.wellknownListName === "defaultList" ? "Aufgaben" : x.displayName }));
}
/** Titel der offenen Aufgaben in Plan oder Liste (um nichts doppelt anzulegen) */
export async function vorhandeneTitel(ziel: AufgabenZiel, ablageId: string): Promise<Set<string>> {
  const norm = (t: string) => t.trim().toLowerCase();
  if (!aufgabenEcht()) return new Set((ziel === "planner" ? beispiel.plaene.find((p) => p.id === ablageId)?.aufgaben : beispiel.listen.find((l) => l.id === ablageId)?.aufgaben)?.map((a) => norm(a.titel)) ?? []);
  if (ziel === "planner") return new Set((await alle<{ title: string; percentComplete?: number }>(`/planner/plans/${encodeURIComponent(ablageId)}/tasks?$select=title,percentComplete`)).filter((t) => (t.percentComplete ?? 0) < 100).map((t) => norm(t.title)));
  return new Set((await alle<{ title: string; status?: string }>(`/me/todo/lists/${encodeURIComponent(ablageId)}/tasks?$select=title,status`)).filter((t) => t.status !== "completed").map((t) => norm(t.title)));
}

/* ---------- Personen ---------- */
const personen = new Map<string, { id: string; name: string } | null>();
/** Person zu Name oder E-Mail (eindeutig), sonst null */
export async function personFinden(wer: string): Promise<{ id: string; name: string } | null> {
  const k = wer.trim().toLowerCase();
  if (!k) return null;
  if (personen.has(k)) return personen.get(k)!;
  let p: { id: string; name: string } | null = null;
  if (!aufgabenEcht()) p = beispiel.personen.find((x) => x.email === k || x.name.toLowerCase() === k) ?? null;
  else {
    try {
      if (k.includes("@")) { const { daten } = await graph<{ id: string; displayName: string }>(`/users/${encodeURIComponent(k)}?$select=id,displayName`); p = { id: daten.id, name: daten.displayName }; }
      else {
        const { daten } = await graph<{ value: { id: string; displayName: string }[] }>(`/users?$filter=${encodeURIComponent(`startswith(displayName,'${wer.trim().replace(/'/g, "''")}')`)}&$select=id,displayName&$top=2`);
        if (daten.value.length === 1) p = { id: daten.value[0]!.id, name: daten.value[0]!.displayName };
      }
    } catch { p = null; }
  }
  personen.set(k, p);
  return p;
}

/* ---------- Anlegen ---------- */
const PLANNER_PRIO: Record<Prioritaet, number> = { hoch: 1, mittel: 5, niedrig: 9 };
const TODO_PRIO: Record<Prioritaet, string> = { hoch: "high", mittel: "normal", niedrig: "low" };
/**
 * Eine Aufgabe anlegen. Planner: mit Bucket, Fälligkeit, Priorität, Zuständigen (falls gefunden) und der Notiz als
 * Beschreibung. To Do: Zuständige gibt es dort nicht, sie stehen dann in der Notiz.
 */
export async function aufgabeAnlegen(ziel: AufgabenZiel, ort: { ablageId: string; bucketId?: string }, a: Aufgabe, person: { id: string; name: string } | null): Promise<string> {
  const notiz = [a.notiz, a.zustaendig && !person ? `Zuständig laut Ergebnis: ${a.zustaendig}` : ziel === "todo" && a.zustaendig ? `Zuständig: ${a.zustaendig}` : ""].filter(Boolean).join("\n");
  if (!aufgabenEcht()) {
    const ablage = ziel === "planner" ? beispiel.plaene.find((p) => p.id === ort.ablageId) : beispiel.listen.find((l) => l.id === ort.ablageId);
    const id = `bsp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    ablage?.aufgaben.push({ ...a, notiz, zustaendig: person?.name ?? "", bucket: ort.bucketId ?? "" });
    return id;
  }
  if (ziel === "planner") {
    const { daten } = await graph<{ id: string }>("/planner/tasks", { method: "POST", body: {
      planId: ort.ablageId, ...(ort.bucketId ? { bucketId: ort.bucketId } : {}), title: a.titel.slice(0, 255), priority: PLANNER_PRIO[a.prioritaet],
      ...(a.faellig ? { dueDateTime: `${a.faellig}T12:00:00Z` } : {}),
      ...(person ? { assignments: { [person.id]: { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" } } } : {}),
    } });
    if (notiz) {
      // Beschreibung steht in den Details; Ändern braucht deren ETag
      const det = await graph<{ "@odata.etag"?: string }>(`/planner/tasks/${encodeURIComponent(daten.id)}/details`);
      await graph(`/planner/tasks/${encodeURIComponent(daten.id)}/details`, { method: "PATCH", etag: det.etag, body: { description: notiz.slice(0, 8000), previewType: "description" } });
    }
    return daten.id;
  }
  const { daten } = await graph<{ id: string }>(`/me/todo/lists/${encodeURIComponent(ort.ablageId)}/tasks`, { method: "POST", body: {
    title: a.titel.slice(0, 255), importance: TODO_PRIO[a.prioritaet],
    ...(a.faellig ? { dueDateTime: { dateTime: `${a.faellig}T00:00:00`, timeZone: "W. Europe Standard Time" } } : {}),
    ...(notiz ? { body: { content: notiz.slice(0, 8000), contentType: "text" } } : {}),
  } });
  return daten.id;
}

/* ---------- Beispiele (ohne Copilot-Anbindung) ---------- */
type BspAufgabe = Aufgabe & { bucket?: string };
const beispiel: {
  plaene: (Ablage & { buckets: Ablage[]; aufgaben: BspAufgabe[] })[];
  listen: (Ablage & { aufgaben: BspAufgabe[] })[];
  personen: { id: string; name: string; email: string }[];
} = {
  plaene: [
    { id: "plan-kte", name: "KTE Projekt", buckets: [{ id: "b-offen", name: "Offen" }, { id: "b-arbeit", name: "In Arbeit" }], aufgaben: [{ titel: "IP-Adressliste mit KTE abstimmen", faellig: "", zustaendig: "", notiz: "", prioritaet: "mittel" }] },
    { id: "plan-cra", name: "CRA Umsetzung", buckets: [{ id: "b-cra", name: "Aufgaben" }], aufgaben: [] },
  ],
  listen: [{ id: "liste-standard", name: "Aufgaben", aufgaben: [] }, { id: "liste-projekte", name: "Projekte", aufgaben: [] }],
  personen: [{ id: "u-marcel", name: "Marcel Huck", email: "marcel.huck@koerber.com" }, { id: "u-anna", name: "Anna Berger", email: "anna.berger@koerber.com" }],
};
/** Nur für Tests: was im Beispiel angelegt wurde */
export const beispielAblage = (ziel: AufgabenZiel, id: string) => (ziel === "planner" ? beispiel.plaene.find((p) => p.id === id)?.aufgaben : beispiel.listen.find((l) => l.id === id)?.aufgaben) ?? [];
