/**
 * App-Schema: einzige Quelle für Typen, Standardwerte, Prüfung (sanitizeApp)
 * und den Schema-Teil im Prompt des KI-Assistenten.
 */
import { z } from "zod";

export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const ColorOrEmpty = z.union([z.literal(""), Hex]);
const Align = z.enum(["left", "center", "right"]);
export const Key = z.string().regex(/^[a-z0-9_]{1,40}$/);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/* ---------- Gestaltung ---------- */
export const ThemeSchema = z.object({
  accent: ColorOrEmpty.default("").describe("Akzentfarbe für Buttons, leer = Standard"),
  bg: ColorOrEmpty.default("").describe("Hintergrund, leer = folgt Hell/Dunkel"),
  font: z.enum(["sans", "serif", "display", "mono"]).default("sans"),
  radius: z.enum(["s", "m", "l"]).default("m"),
  width: z.enum(["s", "m", "l"]).default("m"),
});

/* ---------- Bausteine: Props je Typ ---------- */
const fieldBase = {
  label: z.string().max(200).default("Eingabe"),
  key: Key.default("feld").describe("Variable, im Prompt als {{key}}"),
  keyAuto: z.boolean().default(true),
  pflicht: z.boolean().default(false),
  hilfe: z.string().max(500).default(""),
  beispiel: z.string().max(4000).default("").describe("realistischer Testwert"),
  placeholder: z.string().max(200).default(""),
};

export const PropsSchemas = {
  /** Eine Seite der App. Seiten stehen nur auf oberster Ebene; die App blättert zwischen ihnen statt zu scrollen. */
  seite: z.object({ titel: z.string().max(60).default("Seite") }),
  section: z.object({ bg: ColorOrEmpty.default(""), pad: z.enum(["s", "m", "l"]).default("m"), border: z.boolean().default(true) }),
  columns: z.object({ count: z.union([z.literal(2), z.literal(3)]).default(2) }),
  spacer: z.object({ h: z.union([z.literal(12), z.literal(24), z.literal(48)]).default(24) }),
  divider: z.object({}),
  heading: z.object({ text: z.string().max(300).default("Überschrift"), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2), align: Align.default("left"), color: ColorOrEmpty.default("") }),
  text: z.object({ text: z.string().max(4000).default("Beschreib hier kurz, was zu tun ist."), size: z.enum(["s", "m", "l"]).default("m"), align: Align.default("left"), color: ColorOrEmpty.default("") }),
  callout: z.object({ text: z.string().max(2000).default("Bitte keine personenbezogenen Daten eingeben."), tone: z.enum(["info", "warn", "ok"]).default("info") }),
  image: z.object({ src: z.union([z.literal(""), z.string().regex(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/).max(400_000)]).default("").describe("nie selbst setzen"), alt: z.string().max(300).default(""), size: z.enum(["s", "m", "l", "full"]).default("m"), align: Align.default("left") }),
  input: z.object({ ...fieldBase, label: fieldBase.label.default("Textzeile") }),
  textarea: z.object({ ...fieldBase, label: fieldBase.label.default("Textfeld"), rows: z.union([z.literal(3), z.literal(5), z.literal(9)]).default(5) }),
  select: z.object({ ...fieldBase, label: fieldBase.label.default("Auswahlliste"), optionen: z.array(z.string().min(1).max(120)).max(20).default(["Option A", "Option B"]) }),
  radio: z.object({ ...fieldBase, label: fieldBase.label.default("Auswahlknöpfe"), optionen: z.array(z.string().min(1).max(120)).max(20).default(["Option A", "Option B"]) }),
  checkbox: z.object({ ...fieldBase, label: fieldBase.label.default("Ja, das trifft zu") }),
  number: z.object({ ...fieldBase, label: fieldBase.label.default("Zahl") }),
  date: z.object({ ...fieldBase, label: fieldBase.label.default("Datum") }),
  file: z.object({ ...fieldBase, label: fieldBase.label.default("Datei"), uebergabe: z.enum(["text", "referenz"]).default("text") }),
  button: z.object({ text: z.string().max(80).default("KI starten"), aktion: z.string().max(60).default("alle").describe('"alle", Step-ID oder "ab:" + Step-ID'), stil: z.enum(["filled", "outline"]).default("filled"), align: Align.default("left"), color: ColorOrEmpty.default("") }),
  output: z.object({ titel: z.string().max(120).default("Ergebnis"), quelle: z.string().max(40).default("").describe("ID eines Schritts"), stil: z.enum(["card", "plain"]).default("card") }),
} as const;

export type BlockType = keyof typeof PropsSchemas;
export const BLOCK_TYPES = Object.keys(PropsSchemas) as BlockType[];
export const FIELD_TYPES = ["input", "textarea", "select", "radio", "checkbox", "number", "date", "file"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const isFieldType = (t: string): t is FieldType => (FIELD_TYPES as readonly string[]).includes(t);

export type PropsOf<T extends BlockType> = z.output<(typeof PropsSchemas)[T]>;

/* Ein Baustein. Container: section (children) und columns (cols). */
export type Block = {
  [T in BlockType]: { id: string; type: T; props: PropsOf<T>; children?: Block[]; cols?: Block[][] };
}[BlockType];

export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.union(
    BLOCK_TYPES.map((t) =>
      z.object({
        id: Id,
        type: z.literal(t),
        props: PropsSchemas[t],
        children: z.array(BlockSchema).optional(),
        cols: z.array(z.array(BlockSchema)).min(2).max(3).optional(),
      })
    ) as unknown as [z.ZodType<Block>, z.ZodType<Block>, ...z.ZodType<Block>[]]
  )
) as z.ZodType<Block>;

/* ---------- KI-Ablauf ---------- */
export const QuelleSchema = z.object({
  typ: z.enum(["sharepoint", "datei", "web"]).default("sharepoint"),
  titel: z.string().max(120).default(""),
  url: z.string().max(800).default(""),
});

export const BedingungSchema = z.object({
  feld: Key,
  op: z.enum(["gleich", "ungleich", "gefuellt", "leer"]).default("gleich"),
  wert: z.string().max(200).default(""),
});

export const AgentSchema = z.object({
  id: Id,
  name: z.string().min(1).max(60).default("Agent"),
  rolle: z.string().max(2000).default("").describe("Aufgabe und Haltung des Agenten"),
});

export const TeamSchema = z.object({
  ziel: z.string().max(4000).default("").describe("Woran das Team erkennt, dass es fertig ist; darf {{variablen}} enthalten"),
  agenten: z.array(AgentSchema).min(2).max(6),
  maxRunden: z.number().int().min(2).max(20).default(8),
  moderation: z.string().max(2000).default("").describe("zusätzliche Regeln für die Moderation"),
});

export const StepSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80).default("KI-Schritt"),
  key: Key.describe("Ergebnis-Variable, in späteren Prompts {{key}}"),
  art: z.enum(["prompt", "team"]).default("prompt").describe('"team" = mehrere Agenten lösen die Aufgabe gemeinsam'),
  rolle: z.string().max(4000).default(""),
  wissen: z.string().max(20000).default(""),
  prompt: z.string().max(8000).default("").describe('Aufgabe; bei art "team" die Startsituation'),
  modell: z.enum(["quick", "default", "complex"]).default("default"),
  format: z.enum(["markdown", "text", "json", "dateien"]).default("markdown"),
  datei: z.enum(["", "pdf", "docx", "xlsx", "pptx", "wunsch"]).default("")
    .describe('Ergebnis zusätzlich als fertige Datei: "pdf", "docx" (Word), "xlsx" (Excel), "pptx" (PowerPoint), "wunsch" = die Datei, die in Aufgabe oder Eingaben verlangt wird; "" = keine'),
  autoAll: z.boolean().default(false),
  web: z.boolean().default(false),
  quellen: z.array(QuelleSchema).max(20).default([]),
  bedingung: BedingungSchema.nullable().default(null),
  team: TeamSchema.optional(),
});

/* ---------- Applikation ---------- */
export const AppSchema = z.object({
  id: z.string().nullable(),
  v: z.literal(2).default(2),
  typ: z.enum(["baukasten", "link"]).default("baukasten"),
  url: z.string().max(800).default(""),
  name: z.string().min(1).max(60),
  bereich: z.string().min(1).max(40).default("Allgemein"),
  beschreibung: z.string().max(300).default(""),
  theme: ThemeSchema.default({ accent: "", bg: "", font: "sans", radius: "m", width: "m" }),
  blocks: z.array(BlockSchema).default([]),
  steps: z.array(StepSchema).max(10).default([]),
  status: z.enum(["entwurf", "pruefung", "freigegeben"]).default("entwurf"),
  owner: z.string().max(120).default(""),
  schutz: z.enum(["oeffentlich", "intern", "vertraulich"]).default("intern"),
  version: z.number().int().min(0).default(0),
  geaendert: z.string().default(""),
});

export type Theme = z.output<typeof ThemeSchema>;
export type Step = z.output<typeof StepSchema>;
export type Team = z.output<typeof TeamSchema>;
export type Agent = z.output<typeof AgentSchema>;
export type Quelle = z.output<typeof QuelleSchema>;
export type Bedingung = z.output<typeof BedingungSchema>;
export type App = z.output<typeof AppSchema>;

/* Herkunft einer App im Hub (nicht gespeichert) */
export type AppSource = "vorlage" | "eigene";
export type HubApp = App & { _src: AppSource };

/* ---------- Schema-Text für den Prompt des KI-Assistenten ---------- */
export function blockSchemaForPrompt(): string {
  return BLOCK_TYPES.map((t) => {
    const shape = (PropsSchemas[t] as z.ZodObject).shape as Record<string, z.ZodType>;
    const props = Object.entries(shape).map(([k, s]) => {
      const js = z.toJSONSchema(s, { unrepresentable: "any", io: "input" }) as Record<string, unknown>;
      return `${k}: ${describeJs(js)}`;
    });
    const extra = t === "section" || t === "seite" ? ' + "children": Block[]' : t === "columns" ? ' + "cols": Block[][] (2 oder 3)' : "";
    return `- ${t}: ${props.length ? props.join("; ") : "keine props"}${extra}`;
  }).join("\n");
}

export function stepSchemaForPrompt(): string {
  const js = z.toJSONSchema(StepSchema, { unrepresentable: "any", io: "input" });
  return JSON.stringify(js);
}

function describeJs(js: Record<string, unknown>): string {
  const desc = typeof js.description === "string" ? ` (${js.description})` : "";
  if (Array.isArray(js.enum)) return js.enum.map((v) => JSON.stringify(v)).join("|") + desc;
  if ("const" in js) return JSON.stringify(js.const) + desc;
  if (Array.isArray(js.anyOf)) return (js.anyOf as Record<string, unknown>[]).map((x) => describeJs(x).replace(/ \(.*\)$/, "")).join("|") + desc;
  if (js.type === "array") return "string[]" + desc;
  if (js.type === "string" && typeof js.pattern === "string" && js.pattern.startsWith("^#")) return "#RRGGBB" + desc;
  return String(js.type ?? "wert") + desc;
}
