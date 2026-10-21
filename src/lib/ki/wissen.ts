/**
 * Wissensquellen wirksam machen: Vor einem KI-Schritt holt der Hub passende Auszüge aus SharePoint (Copilot Retrieval API)
 * und den Inhalt einzelner Dateien und hängt sie der Anfrage an. So arbeitet die KI mit belegten Inhalten statt mit
 * dem, was sie zufällig findet. Braucht die Copilot-Anmeldung (Sites.Read.All); ohne sie bleiben die Quellen ein Hinweis.
 */
import { graphToken, graphTokenStill, nutzerKennung } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";
import { shareId } from "./vorlagen";
import { officeLink } from "../links";
import type { Quelle } from "../schema";
import { MAX_BEREICH, MAX_JE_QUELLE, type WissenAuszug } from "../request";

const GRAPH = `${KI_CONFIG.graph}/v1.0`;
/** Zeichen je Quelle, die höchstens in die Anfrage wandern */
/** Treffer je SharePoint-Bereich (die Retrieval API erlaubt bis 25; weniger Text lässt Copilot früher anfangen) */
const MAX_TREFFER = 12;

export type Auszug = WissenAuszug;

export const wissenMoeglich = () => kiModus() === "copilot";

/**
 * Leerzeichen und Klammern in Adressen kodieren: Ein Markdown-Link der KI endet sonst am ersten Leerzeichen oder an der
 * ersten „)“ (Ordner wie „KPSS Templates“ oder „… (CRA) …“ sind in SharePoint üblich).
 */
export const linkSauber = (u: string) => u.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/**
 * Adresse aus einer Bibliotheksansicht („…/Forms/Ansicht.aspx?id=/sites/…/Ordner“) in die direkte Ordner- bzw.
 * Dateiadresse umwandeln; so kopieren viele die Adresse aus dem Browser. Andere Adressen bleiben, wie sie sind.
 */
export function bereichAdresse(url: string): string {
  try {
    const u = new URL(url.trim());
    const id = u.searchParams.get("id");
    if (/sharepoint\.com$/i.test(u.hostname) && id?.startsWith("/")) return `${u.origin}${encodeURI(id)}`;
  } catch { /* keine Adresse */ }
  return url.trim();
}

/*
 * Was der Hub in einem SharePoint-Bereich selbst liest, damit keine Datei unsichtbar bleibt (für jeden Agenten gleich):
 * - Textdateien und Tabellen wertet die Retrieval API nicht aus: der Hub liest sie immer (Tabellen Zeile für Zeile).
 * - Word und PDF liefert die Retrieval API als Stellen; passt der Dateiname zur Frage, liest der Hub sie zusätzlich ganz,
 *   weil die Suche nach Bedeutung sie übersehen kann.
 * Alles mit der Anmeldung der fragenden Person: SharePoint prüft bei jedem Abruf die Rechte, es gibt keinen gemeinsamen Index.
 */
/** Textdateien, die die Retrieval API nicht auswertet (Markdown, Text, CSV …): der Hub liest sie selbst */
export const TEXT_DATEI = /\.(md|markdown|txt|csv|json|xml|html?|vtt)$/i;
/** Tabellen (Excel): wertet die Retrieval API nicht aus, der Hub liest jede Zeile als „Spalte: Wert“ */
export const TABELLE = /\.xlsx$/i;
/** Weitere Dateien, die der Hub lesen kann; ganz gelesen, wenn ihr Name zur Frage passt */
export const NAME_LESBAR = /\.(docx|pdf)$/i;
/** Grenzen je Bereich: Dateien im Inventar, immer gelesene Text- und Tabellendateien, zusätzlich per Name gelesene, Größe je Datei */
const MAX_INVENTAR = 400, MAX_SELBST = 40, MAX_NAMENSTREFFER = 3, MAX_GROESSE = 5_000_000;
/** Anteil des Platzes der Wortsuche, der zuerst für passende Tabellenzeilen reserviert ist (siehe textAuszug) */
const TABELLEN_ANTEIL = 0.4;
/** Bei mehreren nummerierten Fragen: Anteil des Bereichs für Tabellenzeilen, gemeinsam für alle Fragen (siehe sharepointAuszuege) */
const SAMMEL_TABELLEN_ANTEIL = 0.3;
const STOPP = new Set("der die das den dem des ein eine einer eines und oder aber ab an auf aus bei bis für mit nach von vor zu zum zur im in ist sind wird werden wie was wer wo wann gilt gelten welche welcher welches nicht kein keine auch noch nur über unter als dass sich es er sie wir ihr man mal bitte the and for".split(" "));
const FRAGE: Record<string, string[]> = {
  wann: ["datum", "frist", "zeitplan", "termin", "anwendbar", "inkraft"], gilt: ["anwendbar", "geltung", "inkraft"], gelten: ["anwendbar", "geltung"],
  wer: ["verantwort", "rolle", "zuständig", "name"], namen: ["kontakt"], personen: ["name", "kontakt"], ansprechpartner: ["name", "kontakt"], welche: [], wie: ["prozess", "schritt", "vorgehen"], warum: ["zweck", "ziel"],
};
type TextDatei = { name: string; link: string; text: string };
/** Datei im Inventar eines Bereichs */
export type InventarEintrag = { name: string; link: string; size: number; drive: string; id: string };
/** Je Person und Bereich: Inventar und schon gelesene Dateien (null = nicht lesbar), zehn Minuten wie bei einzelnen Dateien */
const ordnerCache = new Map<string, { zeit: number; inventar: InventarEintrag[]; gelesen: Map<string, TextDatei | null> }>();

/**
 * Schlüssel für die Speicher dieser Datei: immer mit der Person. Im Hub-Dienst teilen sich alle Personen einen Prozess;
 * ein Schlüssel nur aus der Adresse gäbe Dateien, gelesen mit den Rechten einer Person, an eine andere weiter.
 * null (keine Person bekannt): nicht zwischenspeichern. Abgelaufenes fliegt dabei raus, damit der Dienst nicht wächst.
 */
async function speicherSchluessel(adresse: string, ...speicher: Map<string, { zeit: number }>[]): Promise<string | null> {
  const jetzt = Date.now();
  for (const m of speicher) for (const [k, v] of m) if (jetzt - v.zeit >= DATEI_CACHE_MS) m.delete(k);
  return schluesselFuer(await nutzerKennung(), adresse);
}
/** Schlüssel aus Person und Adresse; ohne Person null (nicht speichern) */
export const schluesselFuer = (wer: string | null, adresse: string): string | null => (wer ? `${wer}\n${adresse}` : null);

/** Dateitypen, die der Hub selbst liest, als Suchbedingung: gezielt abgefragt, damit sie nie hinter Word-Dateien zurückfallen */
const SELBST_SUCHE = "(filetype:xlsx OR filetype:csv OR filetype:md OR filetype:txt OR filetype:json OR filetype:xml OR filetype:vtt)";

/**
 * Inventar eines Bereichs über die SharePoint-Suche (KQL path:): ein bis zwei Abfragen statt eines Laufs durch alle
 * Ordner, egal wie tief eine Datei liegt; die Suche liefert nur, was die Person sehen darf. Tabellen und Textdateien
 * werden eigens abgefragt und stehen vorn. null, wenn die Suche nicht geht; dann läuft der Hub durch die Ordner.
 */
async function inventarSuchen(url: string, token: string, signal?: AbortSignal): Promise<InventarEintrag[] | null> {
  type Treffer = { resource?: { id?: string; name?: string; webUrl?: string; size?: number; folder?: object; parentReference?: { driveId?: string } } };
  const abfrage = async (kql: string, size: number): Promise<InventarEintrag[] | null> => {
    const r = await fetch(`${GRAPH}/search/query`, {
      method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ entityTypes: ["driveItem"], query: { queryString: kql }, from: 0, size }] }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { value?: { hitsContainers?: { hits?: Treffer[] }[] }[] };
    return (j.value ?? []).flatMap((v) => v.hitsContainers ?? []).flatMap((c) => c.hits ?? []).map((h) => h.resource)
      .filter((x): x is NonNullable<Treffer["resource"]> => !!x?.id && !!x.name && !!x.parentReference?.driveId && !x.folder && /\.[a-z0-9]{2,5}$/i.test(x.name))
      .map((x) => ({ name: x.name!, link: x.webUrl ?? "", size: x.size ?? 0, drive: x.parentReference!.driveId!, id: x.id! }));
  };
  const pfad = `path:"${url}"`;
  const [selbst, alle] = await Promise.all([abfrage(`${pfad} ${SELBST_SUCHE}`, 100), abfrage(pfad, 300)]);
  if (selbst === null && alle === null) return null;
  const gesehen = new Set<string>();
  return [...(selbst ?? []), ...(alle ?? [])].filter((e) => !gesehen.has(e.id) && !!gesehen.add(e.id)).slice(0, MAX_INVENTAR);
}

/** Inventar eines Bereichs: über die Suche, sonst (Suche geht nicht oder findet nichts, z. B. bei einer einzelnen Datei) durch die Ordner */
async function inventarLaden(url: string, token: string, signal?: AbortSignal): Promise<InventarEintrag[]> {
  const gesucht = await inventarSuchen(url, token, signal).catch((e) => { if (signal?.aborted) throw e; return null; });
  return gesucht?.length ? gesucht : inventarOrdner(url, token, signal);
}

/** Alle Dateien eines Bereichs durch die Ordner (drei Ebenen tief, höchstens 400) bzw. die Datei selbst */
async function inventarOrdner(url: string, token: string, signal?: AbortSignal): Promise<InventarEintrag[]> {
  const kopf = { headers: { Authorization: `Bearer ${token}` }, signal };
  type Item = { id: string; name: string; webUrl?: string; size?: number; file?: object; folder?: object; parentReference?: { driveId?: string } };
  const r = await fetch(`${GRAPH}/shares/${shareId(url)}/driveItem?$select=id,name,webUrl,size,file,folder,parentReference`, kopf);
  if (!r.ok) return [];
  const start = (await r.json()) as Item;
  const drive = start.parentReference?.driveId;
  const gefunden: InventarEintrag[] = [];
  const dazu = (x: Item, d: string) => gefunden.push({ name: x.name, link: x.webUrl ?? "", size: x.size ?? 0, drive: d, id: x.id });
  if (start.file && drive) dazu(start, drive);
  const lauf = async (driveId: string, id: string, tiefe: number) => {
    const k = await fetch(`${GRAPH}/drives/${driveId}/items/${id}/children?$select=id,name,webUrl,size,file,folder&$top=200`, kopf);
    if (!k.ok) return;
    const liste = ((await k.json()) as { value?: Item[] }).value ?? [];
    for (const x of liste) if (x.file && gefunden.length < MAX_INVENTAR) dazu(x, driveId);
    if (tiefe < 3) for (const x of liste) if (x.folder && gefunden.length < MAX_INVENTAR) await lauf(driveId, x.id, tiefe + 1);
  };
  if (start.folder && drive) await lauf(drive, start.id, 0);
  return gefunden;
}

/**
 * Excel als Text: je Tabellenblatt eine Überschrift, jede Zeile als „Spalte: Wert | …“. Kopfzeile ist die Zeile mit den
 * meisten Werten unter den ersten zehn (oft steht darüber eine Titelzeile wie „CRA Contacts KSCA …“); Zeilen über der
 * Kopfzeile gehen als Titel mit.
 */
export function tabelleAlsText(blaetter: { sheet: string; data: unknown[][] }[]): string {
  return blaetter.map((b) => {
    const zeilen = b.data.map((z) => z.map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim())));
    const werte = (z: string[]) => z.filter(Boolean).length;
    let k = -1;
    zeilen.slice(0, 10).forEach((z, i) => { if (werte(z) >= 2 && (k < 0 || werte(z) > werte(zeilen[k]))) k = i; });
    if (k < 0) return "";
    const spalten = zeilen[k];
    const titel = zeilen.slice(0, k).map((z) => z.filter(Boolean).join(" · ")).filter(Boolean);
    const inhalt = zeilen.slice(k + 1).filter((z) => z.some(Boolean))
      .map((z) => z.map((c, i) => (c ? `${spalten[i] || `Spalte ${i + 1}`}: ${c}` : "")).filter(Boolean).join(" | "));
    return inhalt.length ? [`## Tabellenblatt ${b.sheet}`, ...titel, ...inhalt].join("\n") : "";
  }).filter(Boolean).join("\n\n");
}

/** Inhalt einer Datei aus dem Inventar als Text; null, wenn sie sich nicht lesen lässt */
async function inventarDateiLesen(e: InventarEintrag, token: string, signal?: AbortSignal): Promise<TextDatei | null> {
  try {
    const c = await fetch(`${GRAPH}/drives/${e.drive}/items/${e.id}/content`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!c.ok) return null;
    let text: string;
    if (TEXT_DATEI.test(e.name)) text = await c.text();
    else if (TABELLE.test(e.name)) {
      const { default: lesen } = await import("read-excel-file/browser");
      text = tabelleAlsText(await lesen(new File([await c.blob()], e.name)) as unknown as { sheet: string; data: unknown[][] }[]);
    } else {
      const blob = await c.blob();
      text = await (await import("../files")).extractText(new File([blob], e.name, { type: blob.type }));
    }
    text = text.trim();
    return text ? { name: e.name, link: e.link, text } : null;
  } catch (x) { if (signal?.aborted) throw x; return null; }
}

/** Wörter einer Frage, nach denen gesucht wird: ohne Füllwörter, Fragewörter auf Suchbegriffe abgebildet („wann“ → Datum, Frist …) */
function suchwoerter(suche: string, mitFragewoertern = true): string[] {
  const roh = suche.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/);
  const dazu = mitFragewoertern ? roh.flatMap((w) => FRAGE[w] ?? []) : [];
  return [...new Set([...roh.filter((w) => w.length >= 3 && !STOPP.has(w)), ...dazu])];
}

/** Wortstamm für den Vergleich: lange Wörter auf 7 Zeichen, kurze ohne Endung (namen → name, personen → person), mindestens 4 */
const stamm = (w: string) => w.slice(0, Math.max(4, Math.min(7, w.length - 2)));

/**
 * Dateien, deren Name zur Frage passt (die meisten Treffer zuerst); Wörter werden auf ihren Stamm gekürzt wie in der
 * Wortsuche. Nur Wörter aus der Frage zählen, nicht die Ersatzbegriffe der Fragewörter („wer“ → „rolle“ träfe sonst
 * jede Rollenbeschreibung).
 */
export function namensTreffer<T extends { name: string }>(dateien: T[], suche: string): T[] {
  const woerter = suchwoerter(suche, false).filter((w) => w.length >= 4);
  return dateien.map((d) => {
    const n = d.name.toLowerCase().replace(/[_+.-]+/g, " ");
    return { d, punkte: woerter.filter((w) => n.includes(stamm(w))).length };
  }).filter((x) => x.punkte > 0).sort((a, b) => b.punkte - a.punkte).map((x) => x.d);
}

/**
 * Was der Hub in einem Bereich selbst liest: alle Text- und Tabellendateien, dazu Word/PDF mit passendem Namen.
 * Das Inventar geht mit, damit die KI Dateien nennen kann, die es klären könnten. Zeiten in ms für die Konsole.
 */
async function bereichSelbstLesen(url: string, suche: string, token: string, signal?: AbortSignal): Promise<{ dateien: TextDatei[]; inventar: InventarEintrag[]; zeit: { inventar: number; dateien: number; neu: number; ausSpeicher: boolean } }> {
  const t0 = Date.now();
  const schluessel = await speicherSchluessel(url, ordnerCache);
  let o = schluessel ? ordnerCache.get(schluessel) : undefined;
  const ausSpeicher = !!o && Date.now() - o.zeit < DATEI_CACHE_MS;
  if (!o || !ausSpeicher) {
    o = { zeit: Date.now(), inventar: await inventarLaden(url, token, signal), gelesen: new Map() };
    if (schluessel) ordnerCache.set(schluessel, o);
  }
  const t1 = Date.now();
  const klein = o.inventar.filter((e) => e.size < MAX_GROESSE);
  const selbstLesbar = klein.filter((e) => TEXT_DATEI.test(e.name) || TABELLE.test(e.name));
  // Dateien mit passendem Namen zuerst, dann in der Reihenfolge der Suche
  const passend = namensTreffer(selbstLesbar, suche);
  const immer = [...passend, ...selbstLesbar.filter((e) => !passend.includes(e))].slice(0, MAX_SELBST);
  const perName = namensTreffer(klein.filter((e) => NAME_LESBAR.test(e.name)), suche).slice(0, MAX_NAMENSTREFFER);
  const wahl = [...immer, ...perName];
  const gelesen = o.gelesen;
  const fehlen = wahl.filter((e) => !gelesen.has(e.id));
  await Promise.all(fehlen.map(async (e) => { gelesen.set(e.id, await inventarDateiLesen(e, token, signal)); }));
  return {
    dateien: wahl.map((e) => gelesen.get(e.id)).filter((x): x is TextDatei => !!x), inventar: o.inventar,
    zeit: { inventar: t1 - t0, dateien: Date.now() - t1, neu: fehlen.length, ausSpeicher },
  };
}

/**
 * Inventar und lesbare Dateien der SharePoint-Quellen schon beim Öffnen einer App holen, solange die Person die erste
 * Frage tippt; die Frage findet sie dann im Speicher (zehn Minuten). Nur mit stiller Anmeldung: Ein Anmeldefenster beim
 * bloßen Öffnen einer App wäre irritierend; ohne Anmeldung lädt der Hub nichts vor. Fehler bleiben still.
 */
export async function wissenVorladen(quellen: Quelle[]): Promise<void> {
  const bereiche = quellen.filter((q) => q.typ === "sharepoint" && q.url.trim());
  if (!bereiche.length || !wissenMoeglich()) return;
  try {
    const token = await graphTokenStill();
    if (!token) return;
    await Promise.all(bereiche.map((q) => bereichSelbstLesen(bereichAdresse(q.url), "", token).catch(() => undefined)));
  } catch { /* nicht angemeldet: die erste Frage meldet sich selbst */ }
}

/** Abschnitte (an Überschriften getrennt, höchstens etwa 1.800 Zeichen) mit ihrer Überschrift */
function abschnitte(text: string): { titel: string; text: string }[] {
  const out: { titel: string; text: string }[] = [];
  let titel = "", teil: string[] = [];
  const raus = () => { const t = teil.join("\n").trim(); if (t) for (let i = 0; i < t.length; i += 1800) out.push({ titel, text: t.slice(i, i + 1800) }); teil = []; };
  for (const z of text.split(/\r?\n/)) {
    const m = /^#{1,4}\s+(.+)$/.exec(z);
    if (m) { raus(); titel = m[1].trim(); }
    teil.push(z);
  }
  raus();
  return out;
}

/** Tabellenzeilen (aus tabelleAlsText) einzeln, mit dem Tabellenblatt als Überschrift; Titelzeilen ohne „Spalte: Wert“ fallen weg */
function tabellenZeilen(text: string): { titel: string; text: string }[] {
  const out: { titel: string; text: string }[] = [];
  let titel = "";
  for (const z of text.split(/\r?\n/)) {
    const m = /^##\s+(.+)$/.exec(z);
    if (m) titel = m[1].trim();
    else if (z.includes(": ")) out.push({ titel, text: z });
  }
  return out;
}

/**
 * Text aus Textdateien für die Anfrage: kleine Bestände ganz (bis 24.000 Zeichen), große als die Abschnitte, die
 * am besten zur Frage passen. Jede Stelle nennt ihren Abschnitt, damit die KI ihn als Fundstelle angeben kann.
 * Seltene Wörter zählen mehr als häufige: „Software“ in einer einzigen Tabellenzeile schlägt „PSSA“, das in jeder
 * Rollenbeschreibung steht. Treffer in der Überschrift zählen doppelt. Tabellen zählen Zeile für Zeile, damit alle
 * passenden Zeilen mitkommen (nicht nur ein Stück der Tabelle); sie stehen je Tabellenblatt als eine Stelle beisammen.
 * Für Tabellenzeilen ist ein Anteil des Platzes reserviert (TABELLEN_ANTEIL): Bei mehreren Fragen auf einmal trifft ein
 * langer Abschnitt viele Suchwörter, eine kurze Zeile („Pashov … CISO“) nur eins; ohne Anteil fiele sie hinten herunter.
 */
export function textAuszug(dateien: TextDatei[], suche: string, max = 24_000): string {
  if (!dateien.length) return "";
  const gesamt = dateien.reduce((n, d) => n + d.text.length, 0);
  if (gesamt <= max) return dateien.map((d) => [`Dokument: ${d.name}`, d.link ? `Link: ${linkSauber(d.link)}` : "", d.text].filter(Boolean).join("\n")).join("\n\n");
  const staemme = [...new Set(suchwoerter(suche).map(stamm))];
  const alle = dateien.flatMap((d) => {
    const tabelle = TABELLE.test(d.name);
    return (tabelle ? tabellenZeilen(d.text) : abschnitte(d.text)).map((a) => ({ d, a, tabelle, t: (a.titel + " " + a.text).toLowerCase(), titel: a.titel.toLowerCase() }));
  });
  const gewicht = new Map(staemme.map((s) => [s, 1 + Math.log(alle.length / Math.max(1, alle.filter((x) => x.t.includes(s)).length))]));
  // In Tabellen zählt die Überschrift (das Blatt) nicht doppelt, sonst gewönne jede Zeile eines passend benannten Blatts gleich
  const kandidaten = alle.map((x) => ({
    ...x, punkte: staemme.reduce((n, s) => n + (x.t.includes(s) ? gewicht.get(s)! * (!x.tabelle && x.titel.includes(s) ? 2 : 1) : 0), 0),
  })).filter((k) => k.punkte > 0).sort((x, y) => y.punkte - x.punkte);
  const je = new Map<TextDatei, { titel: string; tabelle: boolean; teile: string[] }[]>();
  const genommen = new Set<(typeof kandidaten)[number]>();
  let laenge = 0;
  const nehmen = (k: (typeof kandidaten)[number]) => {
    const liste = je.get(k.d) ?? [];
    const blatt = k.tabelle ? liste.find((x) => x.tabelle && x.titel === k.a.titel) : undefined;
    if (blatt) blatt.teile.push(k.a.text);
    else liste.push({ titel: k.a.titel, tabelle: k.tabelle, teile: [k.a.text] });
    je.set(k.d, liste);
    genommen.add(k);
    laenge += k.a.text.length + 1;
  };
  // Zuerst die passendsten Tabellenzeilen bis zu ihrem Anteil, dann alles nach Punkten bis zur Grenze
  for (const k of kandidaten) if (k.tabelle && laenge + k.a.text.length <= max * TABELLEN_ANTEIL) nehmen(k);
  let gekuerzt = false;
  for (const k of kandidaten) {
    if (genommen.has(k)) continue;
    const rest = max - laenge;
    // Passt eine Stelle nicht mehr, kann eine kürzere dahinter noch passen (z. B. eine Tabellenzeile)
    if (k.a.text.length <= rest) { nehmen(k); continue; }
    // Bei wenig Platz (Sammelfragen: je Frage um 1.000 Zeichen, ein Abschnitt bis 1.800) kommt vom passendsten Abschnitt,
    // der nicht ganz passt, wenigstens der Anfang mit, bis zur Zeilengrenze; einmal je Aufruf, sonst bliebe er ganz draußen
    if (!gekuerzt && !k.tabelle && rest >= 500) {
      const ende = k.a.text.lastIndexOf("\n", rest - 2);
      nehmen({ ...k, a: { ...k.a, text: `${k.a.text.slice(0, ende > 300 ? ende : rest - 2)} …` } });
      gekuerzt = true;
    }
  }
  return [...je.entries()].map(([d, stellen]) => [
    `Dokument: ${d.name}`, d.link ? `Link: ${linkSauber(d.link)}` : "",
    ...stellen.map((s, i) => `Stelle ${i + 1}${s.titel ? ` (Abschnitt „${s.titel}“)` : ""}:\n${s.teile.join("\n")}`),
  ].filter(Boolean).join("\n")).join("\n\n");
}

/** Höchstens so viele Dateinamen gehen als Liste an die KI: passende Namen zuerst, dann Tabellen und Textdateien */
const MAX_DATEILISTE = 40;

/**
 * Auszüge aus einem SharePoint-Bereich (Website, Bibliothek oder Ordner): Stellen der Retrieval API (Suche nach Bedeutung)
 * und, gleichzeitig geholt, die vom Hub selbst gelesenen Dateien (Wortsuche, findet auch Namen, Kürzel und Tabellenzeilen).
 * Die selbst gelesenen stehen vorn: Wird gekürzt, trifft es die Retrieval-Stellen, nicht die Tabellenzeilen.
 * Dazu eine Liste von Dateien des Bereichs. Die Zeiten stehen in der Konsole („[Wissen] …“).
 */
async function sharepointAuszuege(q: Quelle, suche: string, token: string, signal?: AbortSignal, breiter?: string): Promise<Auszug> {
  const url = bereichAdresse(q.url);
  const t0 = Date.now();
  let fehler = "", tBedeutung = 0;
  // Mehrere nummerierte Fragen in einer Nachricht: je Frage getrennt suchen (gleichzeitig), sonst gewinnt das Gesamtbild
  // und einzelne Themen (z. B. Meldefristen) fallen heraus
  const teile = teilfragen(suche);
  const bedeutungFuer = async (s: string, max: number, breiter?: string) => {
    try {
      const r = await retrievalText(url, s, token, signal, max);
      return !r && breiter && breiter !== s ? await retrievalText(url, breiter, token, signal, max) : r;
    } catch (e) { if (signal?.aborted) throw e; fehler = e instanceof Error ? e.message : String(e); return ""; }
  };
  const bedeutung = (teile.length
    ? Promise.all(teile.map((t) => bedeutungFuer(t, Math.max(4, Math.ceil((MAX_TREFFER * 2) / teile.length)))))
    : bedeutungFuer(suche, MAX_TREFFER, breiter).then((r) => [r])
  ).finally(() => { tBedeutung = Date.now() - t0; });
  const selbst = bereichSelbstLesen(url, suche, token, signal)
    .catch((e) => { if (signal?.aborted) throw e; return { dateien: [], inventar: [], zeit: { inventar: 0, dateien: 0, neu: 0, ausSpeicher: false } }; });
  const [retrievals, eigen] = await Promise.all([bedeutung, selbst]);
  let text: string;
  if (teile.length) {
    // Tabellen gemeinsam für alle Fragen (Zählfragen brauchen alle passenden Zeilen; kleine Tabellen passen ganz hinein),
    // danach bekommt jede Frage ihren Anteil: zuerst ihre selbst gelesenen Textstellen, dann ihre Retrieval-Stellen
    const tabellen = textAuszug(eigen.dateien.filter((d) => TABELLE.test(d.name)), suche, Math.floor(MAX_BEREICH * SAMMEL_TABELLEN_ANTEIL));
    const texte = eigen.dateien.filter((d) => !TABELLE.test(d.name));
    const anteil = Math.floor((MAX_BEREICH - tabellen.length) / teile.length);
    const bloecke = teile.flatMap((t, i) => {
      const eigene = textAuszug(texte, t, Math.floor(anteil * 0.5));
      return [eigene, bisGrenze(retrievals[i], anteil - eigene.length)];
    });
    text = ohneDoppelte([tabellen, ...bloecke]).slice(0, MAX_BEREICH);
  } else {
    const retrieval = retrievals[0];
    // Platz für die selbst gelesenen Dateien: was die Retrieval-Stellen übrig lassen, mindestens 12.000 Zeichen (die Hälfte)
    const extra = textAuszug(eigen.dateien, suche, Math.max(12_000, MAX_BEREICH - retrieval.length - 2_000));
    text = [extra, retrieval].filter(Boolean).join("\n\n").slice(0, MAX_BEREICH);
  }
  const sek = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  console.info(`[Wissen] ${q.titel || url}: ${teile.length ? `${teile.length} Teilfragen · ` : ""}Inventar ${eigen.zeit.ausSpeicher ? "aus Speicher" : sek(eigen.zeit.inventar)} (${eigen.inventar.length} Dateien) · Dateien ${sek(eigen.zeit.dateien)} (${eigen.zeit.neu} neu gelesen, ${eigen.dateien.length} genutzt) · Bedeutungssuche ${sek(tBedeutung)} · ${text.length} Zeichen · gesamt ${sek(Date.now() - t0)}`);
  if (!text && fehler) throw new Error(fehler);
  const vorn = [...namensTreffer(eigen.inventar, suche), ...eigen.inventar.filter((e) => TEXT_DATEI.test(e.name) || TABELLE.test(e.name)), ...eigen.inventar];
  const namen = [...new Set(vorn.map((e) => e.name))].slice(0, MAX_DATEILISTE);
  return { titel: q.titel || q.url, url: q.url, text, dateien: namen, dateienGesamt: eigen.inventar.length };
}

/**
 * Nummerierte Fragen einer Nachricht („1. Wer …“ / „2) Ab wann …“), je Zeile eine; weniger als zwei: keine Zerlegung.
 * Lokal und ohne KI: Eine Zerlegung durch Copilot kostete mehrere Sekunden, bevor überhaupt gesucht wird.
 */
export function teilfragen(suche: string): string[] {
  const t = [...suche.matchAll(/^\s*\d{1,2}[.)]\s+(\S.{3,})$/gm)].map((m) => m[1].trim());
  return t.length >= 2 ? t.slice(0, 12) : [];
}

/** Text bis höchstens max Zeichen, an Grenzen zwischen Dokumentblöcken („\n\n“) gekürzt, nie mitten in einer Stelle */
function bisGrenze(text: string, max: number): string {
  if (text.length <= max) return text;
  const out: string[] = [];
  let n = 0;
  for (const b of text.split("\n\n")) { if (n + b.length > max) break; out.push(b); n += b.length + 2; }
  return out.join("\n\n");
}

/** Blöcke zusammenlegen, ohne dieselbe Stelle zweimal (mehrere Teilfragen finden oft dieselben Dokumente) */
function ohneDoppelte(teile: string[]): string {
  const gesehen = new Set<string>();
  return teile.flatMap((t) => (t ? t.split("\n\n") : [])).filter((b) => b.trim() && !gesehen.has(b) && !!gesehen.add(b)).join("\n\n");
}

async function retrievalText(url: string, suche: string, token: string, signal?: AbortSignal, max = MAX_TREFFER): Promise<string> {
  const r = await fetch(`${GRAPH}/copilot/retrieval`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queryString: suche.slice(0, 1500), dataSource: "sharePoint", filterExpression: `path:"${url}"`, maximumNumberOfResults: Math.min(25, max), resourceMetadata: ["title"] }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? "kein Lesezugriff oder keine Copilot-Lizenz" : r.status === 404 ? "Bereich nicht gefunden" : `HTTP ${r.status}${code ? ` ${code}` : ""}`);
  }
  const j = (await r.json()) as { retrievalHits?: { webUrl?: string; resourceMetadata?: { title?: string }; extracts?: { text?: string }[] }[] };
  // Stellen je Dokument bündeln und nummerieren, damit die KI „Dokument, Stelle“ nennen kann
  const dokumente = new Map<string, { titel: string; link: string; stellen: string[] }>();
  for (const h of j.retrievalHits ?? []) {
    const link = h.webUrl ?? "";
    const titel = h.resourceMetadata?.title || link.split("/").pop()?.replace(/\.[^.]+$/, "") || "Dokument";
    const d = dokumente.get(link || titel) ?? { titel, link, stellen: [] };
    for (const e of h.extracts ?? []) { const t = e.text?.trim(); if (t && !d.stellen.includes(t)) d.stellen.push(t); }
    if (d.stellen.length) dokumente.set(link || titel, d);
  }
  const teile = [...dokumente.values()].map((d) => [`Dokument: ${d.titel}`, d.link ? `Link: ${linkSauber(d.link)}` : "", ...d.stellen.map((t, i) => `Stelle ${i + 1}:\n${t}`)].filter(Boolean).join("\n"));
  return teile.join("\n\n");
}

/**
 * Gelesene Dateien bleiben zehn Minuten im Speicher, je Person (speicherSchluessel): Ein Chat fragt sie bei jeder Frage,
 * der Inhalt ändert sich dabei nicht
 */
const dateiCache = new Map<string, { zeit: number; auszug: Auszug }>();
const DATEI_CACHE_MS = 10 * 60_000;

/** Inhalt einer einzelnen Datei (SharePoint/OneDrive-Adresse), als Text wie bei einem Upload */
async function dateiAuszug(q: Quelle, token: string, signal?: AbortSignal): Promise<Auszug> {
  const schluessel = await speicherSchluessel(q.url.trim(), dateiCache);
  const alt = schluessel ? dateiCache.get(schluessel) : undefined;
  if (alt && Date.now() - alt.zeit < DATEI_CACHE_MS) return { ...alt.auszug, titel: q.titel || alt.auszug.titel };
  const auszug = await dateiLaden(q, token, signal);
  if (schluessel) dateiCache.set(schluessel, { zeit: Date.now(), auszug });
  return auszug;
}

type Element = { name?: string; inhaltUrl: string };
/**
 * Laufwerkselement zu einer Dateiadresse: Freigabe-API für normale Adressen und Freigabelinks; Office-Links
 * (Doc.aspx mit sourcedoc/file) findet die Graph-Suche über Dateiname und Website.
 */
async function dateiFinden(url: string, token: string, signal?: AbortSignal): Promise<Element> {
  const kopf = { headers: { Authorization: `Bearer ${token}` }, signal };
  const office = officeLink(url);
  if (!office) {
    const r = await fetch(`${GRAPH}/shares/${shareId(url)}/driveItem`, kopf);
    if (!r.ok) throw new Error(r.status === 403 ? "kein Lesezugriff" : r.status === 404 ? "Datei nicht gefunden" : `HTTP ${r.status}`);
    const meta = (await r.json()) as { name?: string };
    return { name: meta.name, inhaltUrl: `${GRAPH}/shares/${shareId(url)}/driveItem/content` };
  }
  const r = await fetch(`${GRAPH}/search/query`, {
    method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ entityTypes: ["driveItem"], query: { queryString: `filename:"${office.name.replace(/"/g, "")}" path:"${office.site}"` }, from: 0, size: 10 }] }),
  });
  if (!r.ok) throw new Error(r.status === 403 ? "kein Lesezugriff" : `Suche HTTP ${r.status}`);
  const j = (await r.json()) as { value?: { hitsContainers?: { hits?: { resource?: { id?: string; name?: string; parentReference?: { driveId?: string } } }[] }[] }[] };
  const treffer = (j.value ?? []).flatMap((v) => v.hitsContainers ?? []).flatMap((c) => c.hits ?? []).map((h) => h.resource).filter((x): x is NonNullable<typeof x> => !!x?.id && !!x.parentReference?.driveId);
  const genau = treffer.find((t) => t.name?.toLowerCase() === office.name.toLowerCase()) ?? treffer[0];
  if (!genau) throw new Error(`Datei „${office.name}“ in ${office.site} nicht gefunden`);
  return { name: genau.name ?? office.name, inhaltUrl: `${GRAPH}/drives/${genau.parentReference!.driveId}/items/${genau.id}/content` };
}

async function dateiLaden(q: Quelle, token: string, signal?: AbortSignal): Promise<Auszug> {
  const meta = await dateiFinden(bereichAdresse(q.url), token, signal);
  const inhalt = await fetch(meta.inhaltUrl, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!inhalt.ok) throw new Error(`Download HTTP ${inhalt.status}`);
  const blob = await inhalt.blob();
  const { extractText } = await import("../files");
  const text = await extractText(new File([blob], meta.name || "datei", { type: blob.type }));
  return { titel: q.titel || meta.name || q.url, url: q.url, text: text.slice(0, MAX_JE_QUELLE), quelleTyp: "datei" };
}

/**
 * Auszüge für alle lesbaren Quellen (SharePoint-Bereiche und einzelne Dateien). Webseiten kann der Hub nicht selbst
 * laden; sie bleiben ein Hinweis an die KI. Fehler werden je Quelle vermerkt, der Schritt läuft trotzdem.
 */
/**
 * breiter: Suchtext mit dem Thema der App (Name, Schrittname). Liefert die Suche zur eigentlichen Frage nichts (bei sehr
 * kurzen Fragen wie „was ist der cra“ passiert das), wird einmal damit nachgesucht.
 */
export async function wissenAuszuege(quellen: Quelle[], suche: string, signal?: AbortSignal, breiter?: string): Promise<Auszug[]> {
  const lesbar = quellen.filter((q) => (q.typ === "sharepoint" || q.typ === "datei") && q.url.trim());
  if (!lesbar.length || !wissenMoeglich()) return [];
  const token = await graphToken();
  return Promise.all(lesbar.map(async (q) => {
    try { return q.typ === "datei" ? await dateiAuszug(q, token, signal) : await sharepointAuszuege(q, suche, token, signal, breiter); }
    catch (e) { return { titel: q.titel || q.url, url: q.url, text: "", fehler: e instanceof Error ? e.message : String(e) }; }
  }));
}

/*
 * Regeln für jeden Agenten mit Wissensquellen (gelten unabhängig von seiner Rolle, die nur Tonfall, Länge und Belegregel
 * festlegt). Gefunden in Tests mit dem CRA-Experten.
 */
/** Personen: Namen aus Tabellen und Listen vollständig nennen, bei Zuständigkeit auch Leitung und „Responsible“, nicht nur die mit Sonderrolle */
const PERSONEN_REGEL = "Fragt jemand nach Personen („wer“, Namen, zuständig, Ansprechpartner), nenne die konkreten Personen aus Tabellen und Listen in den Auszügen, wenn welche passen, zusätzlich zur Beschreibung der Rolle. Nenne alle passenden Zeilen, nicht nur einige, und wie sie eingetragen sind (z. B. Bereich, Position, Rolle). Bei Zuständigkeit für einen Bereich gehören alle Personen dieses Bereichs dazu, auch Leitung und Verantwortliche, nicht nur die mit einer Sonderrolle.";
/** Mehrdeutige Begriffe („Automation“: Firma oder Abteilung): die gewählte Lesart nennen und die andere anbieten */
const MEHRDEUTIG_REGEL = "Kann ein Begriff in der Frage zweierlei meinen (z. B. eine Firma oder eine Abteilung gleichen Namens), sag in einem Halbsatz, wie du ihn verstanden hast, und biete die andere Lesart an.";
/** Falsche Annahmen („Warum gilt der CRA erst ab 2029?“): richtigstellen statt nur „nichts gefunden“ (im Test so geschehen) */
const ANNAHMEN_REGEL = "Steckt in der Frage eine Annahme, die die Auszüge widerlegen (z. B. ein falsches Datum oder eine falsche Zuständigkeit), stelle sie zuerst richtig, nenne den belegten richtigen Wert und belege das; antworte nicht nur, dazu stehe nichts in den Unterlagen.";
/** Empfehlungen und Zusammenfassungen („Was sollte ich als neuer PSSA tun?“): aus Belegtem ableiten statt „kein Plan gefunden“ */
const ABLEITUNG_REGEL = "Fragt jemand nach einer Empfehlung, Zusammenfassung oder nächsten Schritten, die so nicht wörtlich in den Auszügen stehen, leite sie aus den belegten Inhalten ab (z. B. aus Aufgaben einer Rolle), kennzeichne sie als Ableitung und nenne die Quellen; erfinde dabei nichts, was nicht belegt ist.";
/** Schreibvarianten: „R&D Software“ und „Software R&D“ sind derselbe Bereich (im Test fehlte sonst ein Eintrag) */
const VARIANTEN_REGEL = "Bereiche und Begriffe in anderer Schreibweise gehören dazu, z. B. „R&D Software“ und „Software R&D“, „Elektrokonstruktion“ und „E-Konstruktion“, Abkürzung und ausgeschriebene Form; nimm solche Einträge mit auf und nenne die Schreibweise, wie sie eingetragen ist.";
/** Quellen: auf das Dokument verlinken, nie auf die Bibliothek; jede Quelle einmal */
const QUELLEN_REGEL = "Quellenangaben schreibst du als Markdown-Link auf den Link des Dokuments (die Adresse hinter „Link:“) und nennst die Stelle: die Überschrift oder den Abschnitt, unter dem der Inhalt in der Stelle steht, sonst die Nummer der Stelle, z. B. [CRA Q&A, Abschnitt Scope](https://…) oder [CRA Schulung, Stelle 3](https://…). Verlinke nie die Bibliothek oder den Bereich selbst, und nenne jede Quelle nur einmal. Gib nie die nackte Adresse aus, immer Linktext in eckigen Klammern und Adresse in runden Klammern";

/** Text für die Anfrage */
export function auszuegeText(a: Auszug[]): string {
  if (!a.length) return "";
  return `Auszüge aus den hinterlegten Wissensquellen (nur diese Inhalte gelten als belegt). Nutze alle passenden Dokumente und Stellen, nicht nur das erste. ${PERSONEN_REGEL} ${VARIANTEN_REGEL} ${MEHRDEUTIG_REGEL} ${ANNAHMEN_REGEL} ${ABLEITUNG_REGEL} ${QUELLEN_REGEL}:\n\n` + a.map((x) =>
    (x.fehler ? `### ${x.titel}\n(konnte nicht gelesen werden: ${x.fehler})` : `### ${x.titel}\n${x.text ? `${x.quelleTyp === "datei" ? `Link: ${linkSauber(x.url)}\n` : ""}${x.text}` : "(keine passenden Inhalte gefunden)"}`) + dateiListe(x.dateien, x.dateienGesamt)).join("\n\n");
}

/** Dateien eines Bereichs als Liste für die KI (die relevantesten zuerst): So kann sie Dateien nennen oder nachschlagen, die keine Stelle geliefert haben */
function dateiListe(namen?: string[], gesamt?: number): string {
  if (!namen?.length) return "";
  const alle = Math.max(gesamt ?? 0, namen.length);
  return `\n\nDateien in diesem Bereich (${alle}${alle > namen.length ? `, davon die ${namen.length} passendsten` : ""}): ${namen.join("; ")}`;
}
