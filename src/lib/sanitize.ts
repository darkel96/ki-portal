/**
 * Bringt fremde App-Daten (KI-Assistent, JSON-Import, gespeicherte Altstände) in ein gültiges Format.
 * Grundlage ist ausschließlich das Zod-Schema: ungültige Werte fallen auf den Standardwert zurück,
 * statt die ganze App zu verwerfen.
 */
import { z } from "zod";
import {
  AgentSchema, AppSchema, BedingungSchema, PropsSchemas, QuelleSchema, StepSchema, ThemeSchema, isFieldType,
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
      web: !!s.web,
      quellen: (Array.isArray(s.quellen) ? s.quellen : []).slice(0, 20).map((q) => objectLenient(QuelleSchema, q)),
      bedingung: isObj(s.bedingung) && s.bedingung.feld ? field(BedingungSchema.nullable(), { op: "gleich", wert: "", ...s.bedingung, feld: slug(String(s.bedingung.feld)) }, null) : null,
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

  function sb(b: unknown, depth: number): Block | null {
    if (!isObj(b) || typeof b.type !== "string" || !(BLOCK_TYPES as string[]).includes(b.type) || depth > 5) return null;
    if (b.type === "seite" && depth > 0) return null;   // Seiten nur auf oberster Ebene
    const type = b.type as BlockType;
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
    if (type === "section" || type === "seite") nb.children = (Array.isArray(b.children) ? b.children : []).map((c) => sb(c, depth + 1)).filter((x): x is Block => !!x);
    if (type === "columns") {
      const cols = (Array.isArray(b.cols) ? b.cols : []).slice(0, 3).map((c) => (Array.isArray(c) ? c : []).map((x) => sb(x, depth + 1)).filter((x): x is Block => !!x));
      while (cols.length < 2) cols.push([]);
      nb.cols = cols;
      props.count = cols.length;
    }
    return nb;
  }
  const blocksIn = Array.isArray(r.blocks) ? r.blocks : base.blocks;
  app.blocks = seitenSicherstellen(blocksIn.map((b) => sb(b, 0)).filter((x): x is Block => !!x), app.steps);

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
      const id = ab ? a.slice(3) : a;
      const nid = stepMap?.get(id) ?? id;
      b.props.aktion = a === "alle" || !ids.has(nid) ? "alle" : ab ? `ab:${nid}` : nid;
    }
    if (b.type === "output") {
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

/** Lädt eine gespeicherte App, auch aus älteren Formaten. */
export function loadApp(raw: unknown): App | null {
  if (!isObj(raw)) return null;
  if (!Array.isArray(raw.blocks) && (Array.isArray(raw.felder) || raw.typ === "link")) return fromSimple(raw as unknown as LegacyApp);
  const base = AppSchema.parse({ id: typeof raw.id === "string" ? raw.id : null, name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Ohne Namen" });
  const app = sanitizeApp(raw, base);
  const meta = AppSchema.pick({ typ: true, url: true, status: true, owner: true, schutz: true, version: true, geaendert: true });
  const m = meta.safeParse({ typ: raw.typ, url: raw.url, status: raw.status, owner: raw.owner, schutz: raw.schutz, version: raw.version, geaendert: raw.geaendert });
  if (m.success) Object.assign(app, m.data);
  return app;
}
