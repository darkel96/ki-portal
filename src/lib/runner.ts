import { tabellenReparieren } from "./tabellenreparatur";
import type { App, Quelle, Step } from "./schema";
import { fieldsOf, slug, stepsFor, stepsUsing, stepText, varsIn } from "./model";
import { auszuegeZusammen, buildRequest, wissenFuer, type FileInfo, type KiRequest, type WissenAuszug } from "./request";
import { KiSimulation, kiSenden } from "./ki";
import { parsePaket, type Paket } from "./paket";
import { dokumentLinks, linksBenennen, quellenVerlinken, verweiseAufloesen, type DokLink } from "./verweise";
import { teamAusfuehren, type Beitrag } from "./team";
import { alsMarkdown, tabelleLesen } from "./tabelle";

export type Werte = Record<string, string | boolean>;
export type TeamLog =
  | { art: "moderation"; runde: number; naechster: string; auftrag: string; begruendung: string }
  | { art: "beitrag"; beitrag: Beitrag };

export type OutState = {
  status: "wartet" | "laeuft" | "fertig" | "simuliert" | "uebersprungen" | "fehler" | "gestoppt";
  text?: string;
  paket?: Paket | null;
  req?: KiRequest;
  meldung?: string;
  team?: TeamLog[];
  /** Zeitmessung (ms seit 1970): Start des Schritts, Quellen gelesen und Anfrage bereit, Ende */
  start?: number;
  bereit?: number;
  ende?: number;
};

export const STATUS_LABEL: Record<OutState["status"], string> = {
  wartet: "Wartet", laeuft: "Läuft", fertig: "Fertig", simuliert: "Simulation", uebersprungen: "Übersprungen", fehler: "Fehler", gestoppt: "Gestoppt",
};

/** Werte der Eingabefelder als Text, so wie sie in Prompts eingesetzt werden. */
export function kontext(app: App, werte: Werte, files: Record<string, FileInfo>): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const b of fieldsOf(app)) {
    const k = b.props.key;
    let v: string;
    if (b.type === "checkbox") v = werte[k] ? "ja" : "nein";
    else if (b.type === "file") v = files[k]?.text ?? "";
    else if (b.type === "tabelle") v = alsMarkdown(b.props, werte[k]);
    else v = String(werte[k] ?? "").trim();
    ctx[k.toLowerCase()] = v || "(keine Angabe)";
    if (b.type === "file") {
      // Zusatz-Platzhalter: {{key_name}}, {{key_titel}}, {{key_datum}}
      const f = files[k];
      const kl = k.toLowerCase();
      ctx[`${kl}_name`] = f?.name || "(keine Angabe)";
      ctx[`${kl}_titel`] = f?.name ? f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() : "(keine Angabe)";
      ctx[`${kl}_datum`] = f?.geaendert ? new Date(f.geaendert).toLocaleDateString("de-DE", { dateStyle: "long" }) : "(keine Angabe)";
    }
  }
  return ctx;
}

/** Pflichtfelder, die für die gestarteten Schritte fehlen. */
export function fehlendePflichtfelder(app: App, steps: Step[], werte: Werte, files: Record<string, FileInfo>): string[] {
  const idx = new Set(steps.map((s) => app.steps.indexOf(s)));
  return fieldsOf(app).filter((b) => b.props.pflicht && stepsUsing(app, b.props.key).some((i) => idx.has(i))).filter((b) => {
    const k = b.props.key;
    if (b.type === "checkbox") return !werte[k];
    if (b.type === "file") return !files[k]?.text;
    if (b.type === "tabelle") return !tabelleLesen(werte[k]).zeilen.length;
    return !String(werte[k] ?? "").trim();
  }).map((b) => b.props.key);
}

/** Früherer Schritt, dessen Ergebnis fehlt (weder gestartet noch schon gelaufen). */
export function fehlendeVorstufe(app: App, steps: Step[], ergebnisse: Record<string, string>): { step: Step; fehlt: Step } | null {
  const idx = new Set(steps.map((s) => app.steps.indexOf(s)));
  for (const s of steps) {
    const i = app.steps.indexOf(s), used = varsIn(stepText(s));
    const fehlt = app.steps.slice(0, i).find((p) => !idx.has(app.steps.indexOf(p)) && !(p.key in ergebnisse) && used.includes(p.key.toLowerCase()));
    if (fehlt) return { step: s, fehlt };
  }
  return null;
}

/** Werte, die bei einem Ankreuzfeld „angehakt“ bzw. „nicht angehakt“ heißen (die KI schreibt gern true/false) */
const JA = /^(ja|true|wahr|1|x|an|ein|yes|on|angehakt|aktiv|ausgewählt|gewählt|checked)$/;
const NEIN = /^(nein|false|falsch|0|aus|no|off|nicht angehakt|leer|unchecked)$/;

/** Feld der Bedingung: der Schlüssel, sonst ein Feld mit passendem Namen (die KI nennt gern die Beschriftung) */
function bedingungsFeld(feld: string, ctx: Record<string, string>, app?: App): string {
  const k = feld.toLowerCase();
  if (k in ctx || !app) return k;
  const f = fieldsOf(app).find((x) => slug(x.props.label) === slug(feld) || slug(x.props.key) === slug(feld));
  return f ? f.props.key.toLowerCase() : k;
}

export function bedingungErfuellt(s: Step, ctx: Record<string, string>, app?: App): boolean {
  const b = s.bedingung;
  if (!b?.feld) return true;
  let v = ctx[bedingungsFeld(b.feld, ctx, app)] ?? "";
  if (v === "(keine Angabe)") v = "";
  v = v.trim().toLowerCase();
  let w = b.wert.trim().toLowerCase();
  // Ankreuzfelder liefern „ja“/„nein“: „true“, „an“, „angehakt“ usw. zählen genauso
  if (v === "ja" || v === "nein") { if (JA.test(w)) w = "ja"; else if (NEIN.test(w)) w = "nein"; }
  switch (b.op) {
    case "gefuellt": return !!v && v !== "nein";
    case "leer": return !v || v === "nein";
    case "ungleich": return v !== w;
    default: return v === w;
  }
}

/** Bedingung in Worten für Meldungen: „„To-dos erstellen“ ist angehakt“ */
export function bedingungText(s: Step, app: App): string {
  const b = s.bedingung;
  if (!b?.feld) return "keine Bedingung";
  const f = fieldsOf(app).find((x) => x.props.key.toLowerCase() === b.feld.toLowerCase() || slug(x.props.label) === slug(b.feld));
  const name = `„${f?.props.label || b.feld}“`;
  const w = b.wert.trim().toLowerCase();
  if (f?.type === "checkbox") {
    const an = b.op === "gefuellt" || (b.op === "gleich" && JA.test(w)) || (b.op === "ungleich" && NEIN.test(w));
    return `${name} ist ${an ? "" : "nicht "}angehakt`;
  }
  return b.op === "gefuellt" ? `${name} ist ausgefüllt` : b.op === "leer" ? `${name} ist leer` : `${name} ${b.op === "ungleich" ? "ist nicht" : "ist"} „${b.wert}“`;
}

/** Meldung für einen übersprungenen Schritt: „Übersprungen, weil „Briefing erstellen“ nicht angehakt ist.“ */
export function uebersprungenGrund(s: Step, app: App): string {
  const t = bedingungText(s, app);
  const m = /^(„.+“) ist (nicht )?angehakt$/.exec(t);
  if (m) return `Übersprungen, weil ${m[1]} ${m[2] ? "" : "nicht "}angehakt ist.`;
  return `Übersprungen, weil die Bedingung nicht zutrifft (${t}).`;
}

/** Schritte dieses Laufs, deren Ergebnis ein Schritt braucht (Platzhalter oder Bedingung). */
export function abhaengigkeiten(s: Step, steps: Step[]): Step[] {
  const text = [stepText(s), s.rolle, s.team?.moderation ?? "", ...(s.team?.agenten.map((a) => a.rolle) ?? [])].join(" ");
  const used = new Set(varsIn(text));
  if (s.bedingung?.feld) used.add(s.bedingung.feld.toLowerCase());
  return steps.slice(0, steps.indexOf(s)).filter((p) => used.has(p.key.toLowerCase()));
}

/** Die Anfrage konnte nicht aufgebaut werden (z. B. Vorlagenordner nicht lesbar) */
export class VorbereitungsFehler extends Error {}

/**
 * Baut die Anfrage eines Schritts samt Wissen: Vorlagenliste eines Dateipakets (SharePoint-Ordner) und Auszüge aus den
 * Wissensquellen (SharePoint-Bereiche, Dateien). Gemeinsam für den Durchlauf und den Chat.
 */
/** Fehlertext in der Diagnose für eine SharePoint- oder Dateiquelle ohne Adresse */
export const OHNE_ADRESSE = "keine Adresse hinterlegt";

/** vorher: Auszüge eines früheren Durchlaufs derselben Frage (Nachschlagen); sie bleiben erhalten und werden ergänzt */
export async function anfrageVorbereiten(app: App, s: Step, ctx: Record<string, string>, files: Record<string, FileInfo>, signal?: AbortSignal, melden?: (text: string) => void, suche?: string, vorher: WissenAuszug[] = []): Promise<KiRequest> {
  let vorlagen: { url: string; text: string } | undefined;
  const vorlagenQuelle = s.format === "dateien" ? wissenFuer(app, s).quellen.find((q) => q.typ === "sharepoint" && q.url.trim()) : undefined;
  if (vorlagenQuelle) {
    const v = await import("./ki/vorlagen");
    if (v.vorlagenMoeglich()) {
      melden?.("Vorlagenordner wird gelesen\u00a0…");
      try {
        const liste = await v.vorlagenAuflisten(vorlagenQuelle.url.trim(), signal);
        vorlagen = { url: vorlagenQuelle.url.trim(), text: v.vorlagenText(liste, vorlagenQuelle.titel || "Vorlagen") };
      } catch (e) {
        throw new VorbereitungsFehler(`Der Vorlagenordner „${vorlagenQuelle.titel || vorlagenQuelle.url}“ konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  // Wissensquellen: passende Auszüge aus SharePoint und einzelne Dateien an die Anfrage hängen (nicht der Vorlagenordner eines Dateipakets)
  let auszuege = "";
  let gelesene: WissenAuszug[] = [];
  const diagnose: NonNullable<KiRequest["diagnose"]> = { suche: "", gelesen: false, auszuege: [], links: [] };
  const { istM365Quelle, filterAufloesen } = await import("./ki/m365quellen");
  const wq = wissenFuer(app, s).quellen
    .filter((q) => !(vorlagenQuelle && q.url.trim() === vorlagenQuelle.url.trim()))
    // Filter wie „{{thema}}“ bei E-Mail- und Teams-Quellen aus den Eingaben füllen
    .map((q) => filterAufloesen(q, ctx as Record<string, unknown>));
  const lesbar = (q: Quelle) => q.typ === "sharepoint" || q.typ === "datei";
  // Eine SharePoint- oder Dateiquelle ohne Adresse kann der Hub nicht lesen: Das steht in der Diagnose, statt still zu fehlen
  diagnose.auszuege = wq.filter((q) => lesbar(q) && !q.url.trim()).map((q) => ({ titel: q.titel || "Wissensquelle", zeichen: 0, fehler: OHNE_ADRESSE }));
  if (wq.some((q) => (lesbar(q) && q.url.trim()) || istM365Quelle(q))) {
    const w = await import("./ki/wissen");
    // E-Mails, Teams und Kalender liest der Hub auch ohne SharePoint-Anbindung (Beispiele ohne Copilot-Anmeldung)
    if (w.wissenMoeglich() || wq.some(istM365Quelle)) {
      melden?.("Wissensquellen werden gelesen\u00a0…");
      // Suchtext: im Chat die Frage (mit Vorfragen), sonst die Aufgabe mit Eingaben. Sehr kurze Fragen („was ist der cra“)
      // bekommen das Thema der App dazu; liefert die Suche nichts, wird einmal mit dem Thema nachgesucht.
      const vorab = suche ?? buildRequest(app, s, ctx, files).nachricht;
      const thema = [app.name, s.name].filter(Boolean).join(" ");
      const inhaltswoerter = vorab.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/).filter((x) => x.length >= 4).length;
      const abfrage = `${s.name}: ${vorab.slice(0, 1200)}`;
      const breiter = `${abfrage} ${thema}`;
      diagnose.suche = inhaltswoerter < 4 ? breiter : abfrage;
      diagnose.gelesen = true;
      const gefunden = auszuegeZusammen(vorher, await w.wissenAuszuege(wq, diagnose.suche, signal, breiter));
      gelesene = gefunden;
      diagnose.auszuege = [...diagnose.auszuege, ...gefunden.map((x) => ({ titel: x.titel, zeichen: x.text.length, ...(x.fehler ? { fehler: x.fehler } : {}) }))];
      diagnose.links = gefunden.flatMap((x): DokLink[] => [...dokumentLinks(x.text), ...(x.quelleTyp === "datei" && x.text ? [{ titel: x.titel, link: x.url }] : [])]);
      console.info("[KI-Hub] Wissen", s.name, diagnose.auszuege);
      auszuege = w.auszuegeText(gefunden);
    }
  }
  return { ...buildRequest(app, s, ctx, files, vorlagen, auszuege), diagnose, auszuege: gelesene };
}

/**
 * Führt die gestarteten Schritte aus. Schritte, die nicht aufeinander aufbauen, laufen gleichzeitig;
 * ein Schritt startet, sobald alle Schritte fertig sind, deren Ergebnis er braucht.
 * Bei einem Fehler oder Stopp startet nichts Neues mehr; laufende Schritte dürfen zu Ende laufen.
 */
export async function ablaufStarten(opts: {
  app: App; aktion: string; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>;
  signal: AbortSignal; setOut: (stepId: string, s: OutState | ((prev: OutState | undefined) => OutState)) => void;
}): Promise<Record<string, string>> {
  const { app, werte, files, signal, setOut } = opts;
  const steps = stepsFor(app, opts.aktion);
  const ergebnisse = { ...opts.ergebnisse };
  const ctx = { ...kontext(app, werte, files), ...lower(ergebnisse) };
  const deps = new Map(steps.map((s) => [s, abhaengigkeiten(s, steps)]));
  const erledigt = new Set<Step>();
  const gestartet = new Set<Step>();
  const laufend = new Map<Step, Promise<void>>();
  let abbruch = false;

  /** Ein Schritt; gibt false zurück, wenn danach nichts mehr starten soll. */
  const schritt = async (s: Step): Promise<boolean> => {
    if (!bedingungErfuellt(s, ctx, app)) {
      ergebnisse[s.key] = ""; ctx[s.key.toLowerCase()] = "";
      setOut(s.id, { status: "uebersprungen", meldung: uebersprungenGrund(s, app) });
      return true;
    }
    const start = Date.now();
    setOut(s.id, { status: "laeuft", req: buildRequest(app, s, ctx, files), team: s.art === "team" ? [] : undefined, start });
    // Jeder Abschluss bekommt das Ende der Zeitmessung
    const ende = (o: OutState): OutState => ({ ...o, start, ende: Date.now() });
    try {
      const req = await anfrageVorbereiten(app, s, ctx, files, signal, (meldung) => setOut(s.id, (prev) => ({ ...(prev ?? { status: "laeuft" }), status: "laeuft", meldung })));
      // Während des Lesens gestoppt: nicht mehr fragen (Lesefehler werden je Quelle abgefangen, der Stopp sonst übersehen)
      if (signal.aborted) throw new DOMException("Abgebrochen.", "AbortError");
      setOut(s.id, (prev) => ({ ...(prev ?? { status: "laeuft" }), status: "laeuft", req, meldung: undefined, start, bereit: Date.now() }));
      let text: string;
      if (s.art === "team") {
        text = await teamAusfuehren({
          app, step: s, ctx, files, signal,
          onRequest: (r) => setOut(s.id, (prev) => ({ ...(prev ?? { status: "laeuft" }), req: r })),
          onUpdate: (u) => setOut(s.id, (prev) => {
            const team = [...(prev?.team ?? [])];
            if (u.art === "moderation") team.push(u);
            if (u.art === "beitrag") team.push({ art: "beitrag", beitrag: u.beitrag });
            return { ...(prev ?? { status: "laeuft" }), team, meldung: u.art === "fertig" ? u.begruendung : prev?.meldung };
          }),
        });
      } else {
        // Text-Ergebnisse wachsen sichtbar mit; JSON und Dateipakete erst, wenn sie vollständig sind
        const live = s.format === "markdown" || s.format === "text" ? mitlesen((t) => setOut(s.id, (prev) => ({ ...(prev ?? { status: "laeuft" }), text: t }))) : undefined;
        text = await kiSenden(req, signal, live?.teil);
        live?.ende();
        // Quellen verlinken und jedem Link einen sprechenden Text geben; nackte Adressen nur im formatierten Text zu Links
        if (s.format === "markdown" || s.format === "text") {
          const links = req.diagnose?.links ?? [];
          text = linksBenennen(quellenVerlinken(verweiseAufloesen(text), links), links, s.format === "markdown");
          // Tabellen ohne äußere Striche und Trennzeile (kommt bei Copilot vor) zu echten Tabellen
          if (s.format === "markdown") text = tabellenReparieren(text);
        }
      }
      const paket = s.format === "dateien" ? parsePaket(text) : undefined;
      if (paket && req.vorlagenUrl) paket.vorlagenUrl = req.vorlagenUrl;
      setOut(s.id, (prev) => ende({
        ...(prev ?? { status: "fertig" }), status: s.format === "dateien" && !paket ? "fehler" : "fertig", text, paket,
        meldung: s.format === "dateien" && !paket ? "Die KI hat kein gültiges Dateipaket geliefert. Starte den Schritt erneut." : prev?.meldung,
      }));
      ergebnisse[s.key] = text; ctx[s.key.toLowerCase()] = text;
      return true;
    } catch (e) {
      if (e instanceof KiSimulation) {
        const text = `‹Ergebnis von ${s.name}›`;
        setOut(s.id, (prev) => ende({ ...(prev ?? { status: "simuliert" }), status: "simuliert", req: "applikation" in e.req ? e.req : prev?.req }));
        ergebnisse[s.key] = text; ctx[s.key.toLowerCase()] = text;
        return s.art !== "team";
      }
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        setOut(s.id, (prev) => ende({ ...(prev ?? { status: "gestoppt" }), status: "gestoppt" }));
        return false;
      }
      if (e instanceof VorbereitungsFehler) { setOut(s.id, ende({ status: "fehler", meldung: e.message })); return false; }
      setOut(s.id, (prev) => ende({ ...(prev ?? { status: "fehler" }), status: "fehler", meldung: fehlerText(e) }));
      return false;
    }
  };

  for (;;) {
    if (!abbruch && !signal.aborted) {
      for (const s of steps) {
        if (gestartet.has(s) || !deps.get(s)!.every((d) => erledigt.has(d))) continue;
        gestartet.add(s);
        laufend.set(s, schritt(s).then((weiter) => { erledigt.add(s); if (!weiter) abbruch = true; laufend.delete(s); }));
      }
    }
    if (!laufend.size) break;
    await Promise.race(laufend.values());
  }
  return ergebnisse;
}

/**
 * Bündelt Zwischenstände auf höchstens einen pro Bildschirm-Aktualisierung, damit lange Antworten flüssig bleiben.
 * Ohne Bildschirm (Hub-Dienst) höchstens alle 2 Sekunden.
 */
function mitlesen(zeigen: (text: string) => void) {
  let letzter = "", geplant: ReturnType<typeof setTimeout> | number = 0, aus = false;
  const browser = typeof requestAnimationFrame === "function";
  return {
    teil: (t: string) => {
      letzter = t;
      const los = () => { geplant = 0; if (!aus) zeigen(letzter); };
      geplant ||= browser ? requestAnimationFrame(los) : setTimeout(los, 2000);
    },
    ende: () => { aus = true; if (browser) cancelAnimationFrame(geplant as number); else clearTimeout(geplant as ReturnType<typeof setTimeout>); },
  };
}

/** Fehlermeldung für Menschen: Technisches („Failed to fetch“) in einen Satz mit nächstem Schritt übersetzen. */
function fehlerText(e: unknown): string {
  const t = e instanceof Error ? e.message : "";
  if (!t || /failed to fetch|networkerror|load failed/i.test(t)) return "Die Verbindung zur KI ist abgebrochen. Prüf die Internetverbindung und versuch es erneut.";
  return t;
}

const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

/** Dauer lesbar: „8 s“, „1 min 12 s“, „1 h 3 min“ */
export function dauerText(ms: number): string {
  const sek = Math.max(0, Math.round(ms / 1000));
  if (sek < 1) return "unter 1 s";
  if (sek < 60) return `${sek} s`;
  const min = Math.floor(sek / 60);
  if (min < 60) return `${min} min${sek % 60 ? ` ${sek % 60} s` : ""}`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Dauer eines Schritts samt Aufteilung (Quellen lesen, KI); "" ohne Messung */
export function schrittDauer(o: OutState | undefined): string {
  if (typeof o?.start !== "number" || typeof o.ende !== "number") return "";
  const gesamt = dauerText(o.ende - o.start);
  if (typeof o.bereit !== "number" || o.bereit - o.start < 1000) return gesamt;
  return `${gesamt} (Quellen lesen ${dauerText(o.bereit - o.start)}, KI ${dauerText(o.ende - o.bereit)})`;
}

/** Dauer mehrerer Schritte vom ersten Start bis zum letzten Ende; "" ohne Messung */
export function laufDauer(outs: (OutState | undefined)[]): string {
  const mit = outs.filter((o): o is OutState & { start: number; ende: number } => typeof o?.start === "number" && typeof o.ende === "number");
  if (!mit.length) return "";
  return dauerText(Math.max(...mit.map((o) => o.ende)) - Math.min(...mit.map((o) => o.start)));
}
