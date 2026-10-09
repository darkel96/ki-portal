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
  wartet: "wartet", laeuft: "läuft", fertig: "fertig", simuliert: "Simulation", uebersprungen: "übersprungen", fehler: "Fehler", gestoppt: "gestoppt",
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

export async function ablaufStarten(opts: {
  app: App; aktion: string; werte: Werte; files: Record<string, FileInfo>; ergebnisse: Record<string, string>;
  signal: AbortSignal; setOut: (stepId: string, s: OutState | ((prev: OutState | undefined) => OutState)) => void;
}): Promise<Record<string, string>> {
  const { app, werte, files, signal, setOut } = opts;
  const steps = stepsFor(app, opts.aktion);
  const ergebnisse = { ...opts.ergebnisse };
  const ctx = { ...kontext(app, werte, files), ...lower(ergebnisse) };
  for (const s of steps) {
    if (signal.aborted) break;
    if (!bedingungErfuellt(s, ctx)) {
      ergebnisse[s.key] = ""; ctx[s.key] = "";
      setOut(s.id, { status: "uebersprungen", meldung: "Übersprungen, weil die Bedingung nicht erfüllt ist." });
      continue;
    }
    const req = buildRequest(app, s, ctx, files);
    setOut(s.id, { status: "laeuft", req, team: s.art === "team" ? [] : undefined });
    try {
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
        text = await kiSenden(req, signal);
      }
      const paket = s.format === "dateien" ? parsePaket(text) : undefined;
      setOut(s.id, (prev) => ({
        ...(prev ?? {}), status: s.format === "dateien" && !paket ? "fehler" : "fertig", text, paket,
        meldung: s.format === "dateien" && !paket ? "Die KI hat kein gültiges Dateipaket geliefert. Starte den Schritt erneut." : prev?.meldung,
      }));
      ergebnisse[s.key] = text; ctx[s.key] = text;
    } catch (e) {
      if (e instanceof KiSimulation) {
        const text = `‹Ergebnis von ${s.name}›`;
        setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "simuliert", req: "applikation" in e.req ? e.req : prev?.req }));
        ergebnisse[s.key] = text; ctx[s.key] = text;
        if (s.art === "team") break;
        continue;
      }
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "gestoppt" }));
        break;
      }
      setOut(s.id, (prev) => ({ ...(prev ?? {}), status: "fehler", meldung: e instanceof Error ? e.message : "Die Verbindung zur KI ist abgebrochen. Starte erneut." }));
      break;
    }
  }
  return ergebnisse;
}

const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
