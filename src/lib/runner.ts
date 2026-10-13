import type { App, Step } from "./schema";
import { fieldsOf, stepsFor, stepsUsing, stepText, varsIn } from "./model";
import { buildRequest, type FileInfo, type KiRequest } from "./request";
import { KiSimulation, kiSenden } from "./ki";
import { parsePaket, type Paket } from "./paket";
import { teamAusfuehren, type Beitrag } from "./team";

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

export function bedingungErfuellt(s: Step, ctx: Record<string, string>): boolean {
  const b = s.bedingung;
  if (!b?.feld) return true;
  let v = ctx[b.feld.toLowerCase()] ?? "";
  if (v === "(keine Angabe)") v = "";
  v = v.trim().toLowerCase();
  const w = b.wert.trim().toLowerCase();
  switch (b.op) {
    case "gefuellt": return !!v && v !== "nein";
    case "leer": return !v || v === "nein";
    case "ungleich": return v !== w;
    default: return v === w;
  }
}

/** Schritte dieses Laufs, deren Ergebnis ein Schritt braucht (Platzhalter oder Bedingung). */
export function abhaengigkeiten(s: Step, steps: Step[]): Step[] {
  const text = [stepText(s), s.rolle, s.team?.moderation ?? "", ...(s.team?.agenten.map((a) => a.rolle) ?? [])].join(" ");
  const used = new Set(varsIn(text));
  if (s.bedingung?.feld) used.add(s.bedingung.feld.toLowerCase());
  return steps.slice(0, steps.indexOf(s)).filter((p) => used.has(p.key.toLowerCase()));
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
    if (!bedingungErfuellt(s, ctx)) {
      ergebnisse[s.key] = ""; ctx[s.key.toLowerCase()] = "";
      setOut(s.id, { status: "uebersprungen", meldung: "Übersprungen, weil die Bedingung nicht erfüllt ist." });
      return true;
    }
    let vorlagen: { url: string; text: string } | undefined;
    const vorlagenQuelle = s.format === "dateien" ? s.quellen.find((q) => q.typ === "sharepoint" && q.url.trim()) : undefined;
    setOut(s.id, { status: "laeuft", req: buildRequest(app, s, ctx, files), team: s.art === "team" ? [] : undefined, meldung: vorlagenQuelle ? "Vorlagenordner wird gelesen\u00a0…" : undefined });
    try {
      if (vorlagenQuelle) {
        // Dateipaket mit Vorlagen aus SharePoint: erst die Liste holen, damit Copilot nur vorhandene Dateien kopiert
        const v = await import("./ki/vorlagen");
        if (v.vorlagenMoeglich()) {
          try {
            const liste = await v.vorlagenAuflisten(vorlagenQuelle.url.trim(), signal);
            vorlagen = { url: vorlagenQuelle.url.trim(), text: v.vorlagenText(liste, vorlagenQuelle.titel || "Vorlagen") };
          } catch (e) {
            setOut(s.id, { status: "fehler", meldung: `Der Vorlagenordner „${vorlagenQuelle.titel || vorlagenQuelle.url}“ konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}` });
            return false;
          }
        }
      }
      const req = buildRequest(app, s, ctx, files, vorlagen);
      setOut(s.id, (prev) => ({ ...(prev ?? { status: "laeuft" }), status: "laeuft", req, meldung: undefined }));
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
      }
      const paket = s.format === "dateien" ? parsePaket(text) : undefined;
      if (paket && vorlagen) paket.vorlagenUrl = vorlagen.url;
      setOut(s.id, (prev) => ({
        ...(prev ?? {}), status: s.format === "dateien" && !paket ? "fehler" : "fertig", text, paket,
        meldung: s.format === "dateien" && !paket ? "Die KI hat kein gültiges Dateipaket geliefert. Starte den Schritt erneut." : prev?.meldung,
      }));
      ergebnisse[s.key] = text; ctx[s.key.toLowerCase()] = text;
      return true;
    } catch (e) {
      if (e instanceof KiSimulation) {
        const text = `‹Ergebnis von ${s.name}›`;
        setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "simuliert", req: "applikation" in e.req ? e.req : prev?.req }));
        ergebnisse[s.key] = text; ctx[s.key.toLowerCase()] = text;
        return s.art !== "team";
      }
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "gestoppt" }));
        return false;
      }
      setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "fehler", meldung: fehlerText(e) }));
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

/** Bündelt Zwischenstände auf höchstens einen pro Bildschirm-Aktualisierung, damit lange Antworten flüssig bleiben. */
function mitlesen(zeigen: (text: string) => void) {
  let letzter = "", geplant = 0, aus = false;
  return {
    teil: (t: string) => {
      letzter = t;
      geplant ||= requestAnimationFrame(() => { geplant = 0; if (!aus) zeigen(letzter); });
    },
    ende: () => { aus = true; cancelAnimationFrame(geplant); },
  };
}

/** Fehlermeldung für Menschen: Technisches („Failed to fetch“) in einen Satz mit nächstem Schritt übersetzen. */
function fehlerText(e: unknown): string {
  const t = e instanceof Error ? e.message : "";
  if (!t || /failed to fetch|networkerror|load failed/i.test(t)) return "Die Verbindung zur KI ist abgebrochen. Prüf die Internetverbindung und versuch es erneut.";
  return t;
}

const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
