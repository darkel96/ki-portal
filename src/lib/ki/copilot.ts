/**
 * Versand an Microsoft 365 Copilot über Microsoft Graph.
 * Ablauf wie in der bestehenden Copilot-Verbindung (EPLAN/Visio):
 *   1. POST /beta/copilot/conversations
 *   2. POST /beta/copilot/conversations/{id}/chatOverStream (Antwort wächst sichtbar mit)
 *      bzw. /chat, wenn niemand mitliest oder der Tenant kein Streaming anbietet
 *   Antwort = letzter Text in "messages", der nicht die eigene Frage ist.
 * Für Tempo liegt nach jedem Aufruf schon das nächste Gespräch bereit, sodass Schritt 1 meist entfällt.
 * TODO: Endpunkte vor Inbetriebnahme mit der aktuellen Graph-Dokumentation abgleichen (Beta-API).
 */
import { KI_CONFIG } from "./config";
import { graphToken, graphTokenStill } from "./auth";

const GRAPH = "https://graph.microsoft.com/beta/copilot/conversations";
/** So lange gilt ein vorab angelegtes Gespräch als frisch. */
const VORRAT_MS = 5 * 60_000;

/** Dauer der einzelnen Phasen des letzten Aufrufs (für „Verbindung testen“ und die Fehlersuche). */
export type Messung = { anmeldung: number; gespraech: number; ersteZeichen: number | null; antwort: number; gestreamt: boolean; ausVorrat: boolean };
export let letzteMessung: Messung | null = null;
/** Letzte Rohantwort von Graph, zum Prüfen der Antwortqualität (KI-Menü → Technische Angaben). */
export let letzteRohantwort = "";

class GraphFehler extends Error {
  constructor(public status: number, text: string) { super(graphMeldung(status, text)); }
}

/** Graph-Fehler mit dem Hinweis, woran es meist liegt; die Meldung von Graph hängt zur Fehlersuche an. */
function graphMeldung(status: number, text: string): string {
  let meldung = text.slice(0, 300);
  try { meldung = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? meldung; } catch { /* kein JSON */ }
  const hinweis =
    status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden."
    : status === 403 ? "Kein Zugriff auf Copilot. Meist fehlt die Microsoft-365-Copilot-Lizenz oder eine der Graph-Berechtigungen (Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All, Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All) samt Administratorzustimmung."
    : status === 404 ? "Die Copilot-Schnittstelle wurde nicht gefunden. Sie ist in diesem Tenant evtl. nicht verfügbar oder hat sich geändert (Beta)."
    : status === 429 ? "Zu viele Anfragen an Copilot. Kurz warten und erneut versuchen."
    : `Copilot antwortet mit Fehler ${status}.`;
  return `${hinweis} Meldung von Graph: ${meldung}`;
}

/** fetch mit Zeitlimit; Netzwerk- und Zeitfehler werden verständlich gemeldet. */
async function anfrage<T>(url: string, body: unknown, token: string, signal: AbortSignal | undefined, lesen: (res: Response) => Promise<T>, accept = "application/json"): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), KI_CONFIG.timeoutMs);
  const weiter = () => ctl.abort();
  signal?.addEventListener("abort", weiter, { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: accept, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new GraphFehler(res.status, await res.text());
    return await lesen(res);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError" && !signal?.aborted) throw new Error("Copilot hat nicht innerhalb von 3 Minuten geantwortet.");
    if (e instanceof TypeError) throw new Error("Keine Verbindung zu Microsoft Graph. Netzwerk oder Proxy prüfen.");
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", weiter);
  }
}

const json = async (res: Response) => { const t = await res.text(); return t ? JSON.parse(t) as unknown : {}; };

function letzterText(antwort: unknown, frage: string): string {
  const msgs = (antwort as { messages?: { text?: string }[] })?.messages ?? [];
  let text = "";
  for (const m of msgs) if (m?.text && m.text.trim() && m.text.trim() !== frage.trim()) text = m.text;
  return text;
}

/**
 * Letztes Sicherheitsnetz: direkt hintereinander wiederholte Absätze oder Absatzfolgen (ab 30 Zeichen) einmal
 * behalten. In einer echten Antwort kommt derselbe Absatz nie zweimal unmittelbar nacheinander vor; bei einer
 * Copilot-Panne (Antwort doppelt angehängt, egal in welcher Form) räumt das die Anzeige auf.
 */
export function wiederholungenEntfernen(text: string): string {
  const teile = text.split(/\n{2,}/);
  if (teile.length < 2) return text;
  const norm = teile.map((t) => t.trim().replace(/\s+/g, " "));
  const aus: string[] = [], ausN: string[] = [];
  let entfernt = false;
  for (let i = 0; i < teile.length;) {
    let sprung = 0;
    for (let k = Math.min(ausN.length, teile.length - i); k >= 1; k--) {
      const block = ausN.slice(-k).join("\n");
      if (block.length >= 30 && norm.slice(i, i + k).join("\n") === block) { sprung = k; break; }
    }
    if (sprung) { i += sprung; entfernt = true; continue; }
    aus.push(teile[i]); ausN.push(norm[i]); i++;
  }
  return entfernt ? aus.join("\n\n") : text;
}

/** Länge des gemeinsamen Endes zweier Texte */
function gemeinsamesEnde(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}
/**
 * Zwei Texte sind (fast) gleich: gemeinsamer Anfang plus gemeinsames Ende decken mindestens 90 % der Länge ab,
 * die Längen liegen höchstens 12 Zeichen auseinander. So zählt auch eine Abweichung mitten im Text (z. B. eine
 * korrigierte Adresse in der ersten von zwei Quellenzeilen) noch als Doppel.
 */
export function fastGleich(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 12) return false;
  const n = Math.min(a.length, b.length);
  if (!n) return false;
  const vorn = gemeinsamerAnfang(a, b);
  const hinten = Math.min(gemeinsamesEnde(a, b), n - vorn);
  return vorn + hinten >= n * 0.9;
}
/** Ist „rest“ der (noch wachsende) Anfang einer Zweitfassung von „text“? Kleine Längenverschiebungen sind erlaubt. */
function zweitfassung(text: string, rest: string): boolean {
  for (let d = -12; d <= 12; d++) {
    const z = text.slice(0, rest.length + d);
    if (z.length >= 20 && fastGleich(rest, z)) return true;
  }
  return false;
}

/**
 * Copilot liefert manche Antworten zweimal hintereinander (A + A); dann nur einmal übernehmen. Die Zweitfassung kann
 * sich am Ende leicht unterscheiden (z. B. eine korrigierte Adresse), deshalb gilt sie als Doppel, wenn sie fast gleich
 * ist, und die spätere Fassung bleibt stehen.
 */
export function entdoppeln(text: string): string {
  const t = text.trim();
  const mitte = Math.floor(t.length / 2);
  for (let k = mitte - 12; k <= mitte + 12; k++) {
    if (k < 20 || k > t.length) continue;
    // Trennzeichen („---“) zwischen den Fassungen gehören zu keiner von beiden
    const a = t.slice(0, k).trim().replace(/(?:\n\s*[-*_]{3,}\s*)+$/, ""), b = t.slice(k).trim().replace(/^(?:[-*_]{3,}\s*\n\s*)+/, "");
    if (a.length >= 20 && b.length >= 20 && fastGleich(a, b)) return b;
  }
  return t;
}

// Gesprächs-Vorrat: spart den ersten Graph-Aufruf (ca. 0,3–1 s) bei jeder Anfrage.
let vorrat: { id: Promise<string | null>; zeit: number } | null = null;
function vorratAuffuellen(token: string) {
  const id = anfrage(GRAPH, {}, token, undefined, json).then((c) => (c as { id?: string }).id ?? null, () => null);
  vorrat = { id, zeit: Date.now() };
}
async function neuesGespraech(token: string, signal?: AbortSignal): Promise<string> {
  const c = (await anfrage(GRAPH, {}, token, signal, json)) as { id?: string };
  if (!c.id) throw new Error("Copilot hat keine Unterhaltung angelegt.");
  return c.id;
}

/** Länge des gemeinsamen Anfangs zweier Texte */
export function gemeinsamerAnfang(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Liest die SSE-Antwort von chatOverStream (exportiert für Tests); kommt die Antwort als Ganzes oder in Stücken, wird beides zusammengesetzt. */
export async function streamLesen(res: Response, frage: string, onTeil: (t: string) => void, start: number, messung: Partial<Messung>): Promise<string> {
  if (!res.body || !/event-stream/i.test(res.headers.get("content-type") ?? "")) {
    const roh = await res.text();
    letzteRohantwort = roh;
    return letzterText(roh ? JSON.parse(roh) : {}, frage);
  }
  const leser = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let puffer = "", text = "", roh = "";
  const ereignis = (block: string) => {
    const daten = block.split(/\r?\n/).filter((z) => z.startsWith("data:")).map((z) => z.slice(5).trimStart()).join("\n");
    if (!daten || daten === "[DONE]") return;
    roh = daten;
    let t = "";
    try { t = letzterText(JSON.parse(daten), frage); } catch { return; }
    if (!t) return;
    const vorher = text;
    // Jedes Ereignis trägt den ganzen bisherigen Text der Antwort (Copilot schickt Momentaufnahmen der Nachricht,
    // nie einzelne Stücke) und ersetzt den alten Stand. Copilot schreibt den bisherigen Text dabei auch um, z. B. eine
    // Personen-Markierung „<Person>…“ zum Link oder eine Quellenzeile, sobald die Adresse vollständig ist; darum wird
    // nie angehängt, sonst verdoppelt sich die Antwort mit jedem Ereignis.
    if (!text || t.startsWith(text)) {
      // Copilot hängt manche Antworten ein zweites Mal an (A + A): Ein Rest, der mit dem Anfang des bisherigen Texts
      // übereinstimmt, wird nicht angezeigt, sonst flackert die Antwort doppelt, bis entdoppeln() am Ende greift
      let rest = t.slice(text.length).replace(/^\s+/, "");
      // Vor der Zweitfassung stehen manchmal noch Trennzeichen („---“, „***“): den Anfang des Texts darin suchen
      const anfang = text.length >= 40 ? rest.indexOf(text.slice(0, 25)) : -1;
      if (anfang > 0 && anfang <= 12) rest = rest.slice(anfang);
      if (text.length >= 40 && rest.length >= 20 && zweitfassung(text, rest)) {
        // Zweitfassung wächst noch: nichts anzeigen; ist sie (fast) vollständig, gilt die spätere Fassung
        if (rest.length >= text.length - 12) text = rest;
      } else text = t;
    }
    else if (text.startsWith(t)) { /* kürzer als bekannt: nichts Neues */ }
    else text = t;   // umgeschriebener Gesamttext
    if (text === vorher) return;
    messung.ersteZeichen ??= performance.now() - start;
    onTeil(wiederholungenEntfernen(text));
  };
  for (;;) {
    const { done, value } = await leser.read();
    if (value) puffer += value;
    const bloecke = puffer.split(/\r?\n\r?\n/);
    puffer = done ? "" : bloecke.pop() ?? "";
    bloecke.forEach(ereignis);
    if (done) break;
  }
  letzteRohantwort = roh;
  return text;
}

let streamingAus = false;

/** Ein weitergeführtes Gespräch ist bei Copilot verfallen: der Aufrufer muss mit vollem Kontext neu beginnen */
export class GespraechVerfallen extends Error { constructor() { super("Das Copilot-Gespräch ist abgelaufen."); } }

export async function copilotFragen(frage: string, opts: {
  web?: boolean; dateien?: string[]; signal?: AbortSignal; onTeil?: (text: string) => void;
  /** Vorhandenes Gespräch weiterführen (Chat): Copilot kennt dann den Verlauf, die Nachricht bleibt kurz */
  gespraech?: string;
  /** Meldet die ID des genutzten Gesprächs, damit ein Chat es weiterführen kann */
  onGespraech?: (id: string) => void;
} = {}): Promise<string> {
  const t0 = performance.now();
  const messung: Partial<Messung> = { ersteZeichen: null, ausVorrat: false };
  const token = await graphToken();
  messung.anmeldung = performance.now() - t0;

  const t1 = performance.now();
  let id: string | null = opts.gespraech ?? null;
  if (!id && vorrat && Date.now() - vorrat.zeit < VORRAT_MS) { id = await vorrat.id; messung.ausVorrat = !!id; }
  if (!opts.gespraech) vorrat = null;
  id ??= await neuesGespraech(token, opts.signal);
  messung.gespraech = performance.now() - t1;
  // Nächstes Gespräch schon anlegen, während Copilot an dieser Antwort arbeitet
  if (!opts.gespraech) vorratAuffuellen(token);

  const body = {
    message: { text: frage },
    locationHint: { timeZone: "Europe/Berlin" },
    contextualResources: {
      ...(opts.dateien?.length ? { files: opts.dateien.map((uri) => ({ uri })) } : {}),
      webContext: { isWebEnabled: !!opts.web },
    },
  };
  const t2 = performance.now();
  const senden = async (gespraech: string): Promise<string> => {
    const url = `${GRAPH}/${encodeURIComponent(gespraech)}`;
    if (opts.onTeil && !streamingAus) {
      try {
        messung.gestreamt = true;
        return await anfrage(`${url}/chatOverStream`, body, token, opts.signal, (res) => streamLesen(res, frage, opts.onTeil!, t2, messung), "text/event-stream");
      } catch (e) {
        // Bietet der Tenant kein Streaming an, dauerhaft auf /chat ausweichen
        if (!(e instanceof GraphFehler) || ![400, 404, 405, 501].includes(e.status)) throw e;
        streamingAus = true;
      }
    }
    messung.gestreamt = false;
    const antwort = await anfrage(`${url}/chat`, body, token, opts.signal, json);
    letzteRohantwort = JSON.stringify(antwort, null, 2);
    return letzterText(antwort, frage);
  };
  let text: string;
  try {
    text = await senden(id);
    opts.onGespraech?.(id);
  } catch (e) {
    // Ein weitergeführtes Gespräch ist verfallen: Der Chat muss mit vollem Verlauf neu beginnen
    if (opts.gespraech && e instanceof GraphFehler && e.status === 404) throw new GespraechVerfallen();
    // Ein vorab angelegtes Gespräch kann verfallen sein: einmal mit einem frischen wiederholen
    if (!(messung.ausVorrat && e instanceof GraphFehler && e.status === 404)) throw e;
    const neu = await neuesGespraech(token, opts.signal);
    text = await senden(neu);
    opts.onGespraech?.(neu);
  }
  messung.antwort = performance.now() - t2;
  letzteMessung = messung as Messung;
  console.info("[KI-Hub] Copilot", Object.fromEntries(Object.entries(messung).map(([k, v]) => [k, typeof v === "number" ? `${(v / 1000).toFixed(1)} s` : v])));
  text = wiederholungenEntfernen(entdoppeln(text));
  if (!text) throw new Error("Copilot hat keinen Text geliefert.");
  return text;
}

/**
 * Beim Seitenstart im Hintergrund: still anmelden (ohne Fenster) und schon ein Gespräch anlegen,
 * damit die erste Anfrage ohne Wartezeit startet. Gibt zurück, ob die stille Anmeldung geklappt hat.
 */
export async function copilotVorwaermen(): Promise<boolean> {
  const token = await graphTokenStill();
  if (!token) return false;
  if (!vorrat || Date.now() - vorrat.zeit >= VORRAT_MS) vorratAuffuellen(token);
  return true;
}
