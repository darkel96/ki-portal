/**
 * Bringt fremde App-Daten (KI-Assistent, JSON-Import, gespeicherte Altstände) in ein gültiges Format.
 * Grundlage ist ausschließlich das Zod-Schema: ungültige Werte fallen auf den Standardwert zurück,
 * statt die ganze App zu verwerfen.
 */
import { z } from "zod";
import {
  AgentSchema, AppSchema, BedingungSchema, PropsSchemas, QuelleSchema, StepSchema, ThemeSchema, WissenModusSchema, isFieldType,
  BLOCK_TYPES, type App, type Block, type BlockType, type Step,
} from "./schema";
import { clone, rid, slug, uniqueKey, walk, fromSimple, seitenSicherstellen, type LegacyApp } from "./model";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Wert eines Felds prüfen; bei Fehler den Standardwert des Schemas nehmen. */
function field<S extends z.ZodType>(schema: S, value: unknown, fallback: z.output<S>): z.output<S> {
  const r = schema.safeParse(value);
  return r.success ? r.data : fallback;
}
function objectLenient<S extends z.ZodObject>(schema: S, raw: unknown): z.output<S> {
  const def = schema.parse({}) as Obj;
  const src = isObj(raw) ? raw : {};
  const shape = schema.shape as Record<string, z.ZodType>;
  const out: Obj = {};
  for (const k of Object.keys(shape)) out[k] = k in src ? field(shape[k], src[k], def[k]) : def[k];
  return out as z.output<S>;
}

export function sanitizeApp(raw: unknown, base: App): App {
  const r = isObj(raw) ? raw : {};
  const app = clone(base);
  if (typeof r.name === "string" && r.name.trim()) app.name = r.name.trim().slice(0, 60);
  if (typeof r.bereich === "string" && r.bereich.trim()) app.bereich = r.bereich.trim().slice(0, 40);
  if (typeof r.beschreibung === "string") app.beschreibung = r.beschreibung.slice(0, 300);
  app.theme = isObj(r.theme) ? { ...base.theme, ...objectLenient(ThemeSchema, { ...base.theme, ...r.theme }) } : base.theme;
  if (isObj(r.wissen)) {
    const w = r.wissen;
    app.wissen = {
      modus: field(WissenModusSchema, w.modus, base.wissen.modus),
      text: typeof w.text === "string" ? w.text.slice(0, 20000) : base.wissen.text,
      quellen: (Array.isArray(w.quellen) ? w.quellen : base.wissen.quellen).slice(0, 20).map((q) => objectLenient(QuelleSchema, q)),
    };
  }

  const ids = new Set<string>();
  const keys = new Set<string>();
  const renames: [string, string][] = [];
  const stepMap = new Map<string, string>();
  const cleanId = (id: unknown, p: string) => {
    let s = String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    if (!s || ids.has(s)) s = rid(p);
    ids.add(s);
    return s;
  };

  const stepsIn = Array.isArray(r.steps) ? r.steps : base.steps;
  app.steps = stepsIn.slice(0, 10).filter(isObj).map((s, i): Step => {
    const id = cleanId(s.id, "s");
    stepMap.set(String(s.id), id);
    const key = uniqueKey(slug(String(s.key || `schritt${i + 1}`)), keys);
    keys.add(key);
    if (s.key && s.key !== key) renames.push([String(s.key), key]);
    const def = StepSchema.parse({ id, key });
    const shape = StepSchema.shape;
    const step: Step = {
      ...def,
      name: field(shape.name, s.name, `KI-Schritt ${i + 1}`),
      art: field(shape.art, s.art, "prompt"),
      rolle: field(shape.rolle, s.rolle, ""),
      wissen: field(shape.wissen, s.wissen, ""),
      prompt: field(shape.prompt, s.prompt, ""),
      modell: field(shape.modell, s.modell, "default"),
      format: field(shape.format, s.format, "markdown"),
      datei: field(shape.datei, s.datei, ""),
      autoAll: !!s.autoAll,
      vorlage: isObj(s.vorlage) && (s.vorlage.text || s.vorlage.docx) ? field(StepSchema.shape.vorlage, { name: String(s.vorlage.name ?? ""), text: String(s.vorlage.text ?? "").slice(0, 20_000), docx: typeof s.vorlage.docx === "string" && s.vorlage.docx.length <= 2_800_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(s.vorlage.docx) ? s.vorlage.docx : "" }, null) : null,
      // Ältere Apps: Schalter „Websuche“ und „Wissen begrenzt“ werden zum Wissensmodus
      wissenModus: field(shape.wissenModus, s.wissenModus, s.wissenBegrenzt ? "eingaben" : s.web ? "web" : "app"),
      quellen: (Array.isArray(s.quellen) ? s.quellen : []).slice(0, 20).map((q) => objectLenient(QuelleSchema, q)),
      bedingung: isObj(s.bedingung) && s.bedingung.feld ? field(BedingungSchema.nullable(), { op: "gleich", wert: "", ...s.bedingung, feld: slug(String(s.bedingung.feld)) }, null) : null,
      // Lernschicht: freigegebene Hausregeln (Fassungen) bleiben erhalten
      hausregeln: field(shape.hausregeln, s.hausregeln, { fassungen: [] }),
    };
    if (step.art === "team") {
      const t = isObj(s.team) ? s.team : {};
      const agenten = (Array.isArray(t.agenten) ? t.agenten : []).slice(0, 6).filter(isObj)
        .map((a) => ({ ...objectLenient(AgentSchema.omit({ id: true }), a), id: cleanId(a.id, "g") }));
      while (agenten.length < 2) agenten.push({ id: rid("g"), name: `Agent ${agenten.length + 1}`, rolle: "" });
      step.team = {
        ziel: typeof t.ziel === "string" ? t.ziel.slice(0, 4000) : "",
        maxRunden: field(z.number().int().min(2).max(20), t.maxRunden, 8),
        moderation: typeof t.moderation === "string" ? t.moderation.slice(0, 2000) : "",
        agenten,
      };
    }
    return step;
  });

  /** Ein Block oder, wenn die KI Felder in ein „columns“ ohne Spalten gesteckt hat, dessen Inhalt als Nachbarn */
  const liste = (roh: unknown, depth: number): Block[] => (Array.isArray(roh) ? roh : []).flatMap((c) => sb(c, depth));
  /** Häufige Verschreiber der KI für Bausteintypen */
  const SYNONYME: Record<string, string> = {
    dropdown: "select", auswahl: "select", auswahlliste: "select", textfeld: "textarea", textzeile: "input", eingabe: "input",
    upload: "file", datei: "file", zahl: "number", datum: "date", ankreuzfeld: "checkbox", auswahlknoepfe: "radio",
    ueberschrift: "heading", absatz: "text", paragraph: "text", hinweis: "callout", abschnitt: "section", spalten: "columns",
    ergebnis: "output", knopf: "button", bild: "image", page: "seite",
  };
  function sb(roh: unknown, depth: number): Block[] {
    if (!isObj(roh) || typeof roh.type !== "string" || depth > 5) return [];
    const b: Obj = roh;
    let typName: string = roh.type;
    if (!(BLOCK_TYPES as string[]).includes(typName)) {
      const t = SYNONYME[typName.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")];
      if (!t) return [];
      typName = t;
    }
    if (typName === "seite" && depth > 0) return [];   // Seiten nur auf oberster Ebene
    // „columns“ mit children statt cols (häufiger KI-Fehler): die Felder stehen dann einfach nacheinander;
    // gleichartige Felder ordnet die App ohnehin zu dritt nebeneinander an
    if (typName === "columns" && !Array.isArray(b.cols) && Array.isArray(b.children)) return liste(b.children, depth);
    const type = typName as BlockType;
    const props = objectLenient(PropsSchemas[type] as z.ZodObject, b.props) as Obj;
    const nb = { id: cleanId(b.id, "b"), type, props } as Block;
    if (isFieldType(type)) {
      const p = isObj(b.props) ? b.props : {};
      const orig = String(p.key || p.label || "feld");
      const key = uniqueKey(slug(orig), keys);
      keys.add(key);
      if (p.key && p.key !== key) renames.push([String(p.key), key]);
      props.key = key;
      props.keyAuto = false;
    }
    if (type === "section" || type === "seite") nb.children = liste(b.children, depth + 1);
    if (type === "columns") {
      const cols = (Array.isArray(b.cols) ? b.cols : []).slice(0, 3).map((c) => liste(c, depth + 1));
      while (cols.length < 2) cols.push([]);
      nb.cols = cols;
      props.count = cols.length;
    }
    return [nb];
  }
  const blocksIn = Array.isArray(r.blocks) ? r.blocks : base.blocks;
  app.blocks = seitenSicherstellen(liste(blocksIn, 0), app.steps);

  for (const [o, k] of renames) {
    const re = new RegExp(`\\{\\{\\s*${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi");
    for (const s of app.steps) {
      s.prompt = s.prompt.replace(re, `{{${k}}}`);
      s.wissen = s.wissen.replace(re, `{{${k}}}`);
      if (s.team) s.team.ziel = s.team.ziel.replace(re, `{{${k}}}`);
      if (s.bedingung?.feld === o) s.bedingung.feld = k;
    }
  }
  fixRefs(app, stepMap);
  return app;
}

/** Repariert Verweise von Buttons und Ergebnis-Elementen auf Schritte. */
export function fixRefs(app: App, stepMap?: Map<string, string>) {
  const ids = new Set(app.steps.map((s) => s.id));
  walk(app.blocks, (b) => {
    if (b.type === "button") {
      const a = b.props.aktion;
      const ab = a.startsWith("ab:");
      // Eine ID, „ab:“ + ID oder mehrere IDs mit Komma; unbekannte fallen weg, ohne gültige bleibt „alle“
      const neu = (ab ? a.slice(3) : a).split(",").map((x) => x.trim()).map((id) => stepMap?.get(id) ?? id).filter((id) => ids.has(id));
      b.props.aktion = a === "alle" || !neu.length ? "alle" : ab ? `ab:${neu[0]}` : neu.join(",");
    }
    if (b.type === "output" || b.type === "chat") {
      const nid = stepMap?.get(b.props.quelle) ?? b.props.quelle;
      b.props.quelle = ids.has(nid) ? nid : "";
    }
  });
}

const VISUAL = ["align", "color", "size", "level", "bg", "pad", "border", "stil", "tone", "h"] as const;
export type AssistScope = "alles" | "ui" | "design";

/** Wendet den gewählten Umfang an: nur Oberfläche bzw. nur Design übernehmen. */
export function applyScope(next: App, base: App, scope: AssistScope): App {
  if (scope === "ui") {
    next.steps = clone(base.steps);
    next.wissen = clone(base.wissen);
    fixRefs(next);
    return next;
  }
  if (scope === "design") {
    const out = clone(base);
    out.theme = next.theme;
    const map = new Map<string, Block>();
    walk(next.blocks, (b) => map.set(b.id, b));
    walk(out.blocks, (b) => {
      const n = map.get(b.id);
      if (!n || n.type !== b.type) return;
      const bp = b.props as Obj, np = n.props as Obj;
      for (const k of VISUAL) if (k in bp && k in np) bp[k] = np[k];
    });
    return out;
  }
  return next;
}

/** Lädt eine gespeicherte App, auch aus älteren Formaten. Wirft nie: eine defekte App ergibt null, nicht den Verlust aller anderen. */
export function loadApp(raw: unknown): App | null {
  try { return loadAppStrikt(raw); } catch (e) { console.warn("Applikation übersprungen:", e); return null; }
}
function loadAppStrikt(raw: unknown): App | null {
  if (!isObj(raw)) return null;
  if (!Array.isArray(raw.blocks) && (Array.isArray(raw.felder) || raw.typ === "link")) return fromSimple(raw as unknown as LegacyApp);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : "Ohne Namen";
  const base = AppSchema.parse({ id: typeof raw.id === "string" ? raw.id : null, name });
  const app = sanitizeApp(raw, base);
  const meta = AppSchema.pick({ typ: true, url: true, status: true, owner: true, schutz: true, version: true, geaendert: true, erstelltVon: true, rechte: true, pflichtSperre: true });
  const m = meta.safeParse({ typ: raw.typ, url: raw.url, status: raw.status, owner: raw.owner, schutz: raw.schutz, version: raw.version, geaendert: raw.geaendert, erstelltVon: raw.erstelltVon, rechte: raw.rechte, pflichtSperre: raw.pflichtSperre });
  if (m.success) Object.assign(app, m.data);
  else {
    // Rechte-Angaben einzeln retten, damit ein Tippfehler darin nicht die übrigen Angaben verwirft
    const r = AppSchema.pick({ erstelltVon: true, rechte: true, pflichtSperre: true }).safeParse({ erstelltVon: raw.erstelltVon, rechte: raw.rechte, pflichtSperre: raw.pflichtSperre });
    if (r.success) Object.assign(app, r.data);
  }
  return app;
}
