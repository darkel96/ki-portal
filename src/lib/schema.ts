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
  aus: z.string().max(120).default("").describe('Vorbelegung aus einem KI-Ergebnis im Format json: "<key des Schritts>.<pfad im JSON>", z. B. "lesen.produkte.wartung.status"; die Person kann den Wert danach ändern (Prüfseite); "" = keine'),
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
  checkbox: z.object({ ...fieldBase, label: fieldBase.label.default("Bestätigung") }),
  number: z.object({ ...fieldBase, label: fieldBase.label.default("Zahl") }),
  date: z.object({ ...fieldBase, label: fieldBase.label.default("Datum") }),
  file: z.object({ ...fieldBase, label: fieldBase.label.default("Datei"), uebergabe: z.enum(["text", "referenz"]).default("text") }),
  /**
   * Tabelle mit Zeilen aus einem KI-Ergebnis (Spalten „ki“, vorbelegt über „aus“ aus einer Liste von Objekten) und
   * Spalten zum Eintragen („eingabe“), z. B. Positionen einer Kalkulation und rechts die Stunden je Gewerk.
   * Wert: JSON {"zeilen": [{<spaltenkey>: Wert}], "zusatz": ["Titel weiterer Spalten"]}; im Prompt als Markdown-Tabelle.
   */
  tabelle: z.object({
    ...fieldBase, label: fieldBase.label.default("Tabelle"),
    aus: fieldBase.aus.describe('Vorbelegung der Zeilen: Liste von Objekten im JSON-Ergebnis, z. B. "lesen.positionen"; die Schlüssel der Objekte = key der Spalten mit art "ki"'),
    spalten: z.array(z.object({
      key: Key.describe("Schlüssel im JSON der Zeile"),
      titel: z.string().min(1).max(60),
      typ: z.enum(["text", "zahl", "datum"]).default("text"),
      art: z.enum(["ki", "eingabe"]).default("eingabe").describe('"ki" = aus dem KI-Ergebnis, "eingabe" = trägt die Person ein'),
      summe: z.boolean().default(false).describe("Summenzeile unter Zahlenspalten"),
    })).min(1).max(20).default([
      { key: "bezeichnung", titel: "Bezeichnung", typ: "text", art: "ki", summe: false },
      { key: "menge", titel: "Menge", typ: "zahl", art: "ki", summe: false },
      { key: "stunden", titel: "Stunden", typ: "zahl", art: "eingabe", summe: true },
    ]),
    kiBearbeitbar: z.boolean().default(false).describe("Werte aus dem KI-Ergebnis dürfen korrigiert werden"),
    zeilenHinzufuegen: z.boolean().default(true).describe("Zeilen von Hand ergänzen und löschen"),
    spaltenHinzufuegen: z.boolean().default(false).describe("beim Ausfüllen weitere Zahlenspalten anlegen, z. B. je Mitarbeiter"),
  }),
  button: z.object({ text: z.string().max(80).default("KI starten"), aktion: z.string().max(200).default("alle").describe('"alle", Step-ID, mehrere Step-IDs mit Komma oder "ab:" + Step-ID (ab diesem Schritt bis zum Ende)'), stil: z.enum(["filled", "outline"]).default("filled"), align: Align.default("left"), color: ColorOrEmpty.default("") }),
  chat: z.object({
    titel: z.string().max(120).default("Fachexperte"),
    quelle: z.string().max(40).default("").describe("ID des KI-Schritts, der als Experte antwortet (rolle, wissen, quellen, wissenModus gelten); sein prompt darf {{frage}} und {{verlauf}} enthalten"),
    begruessung: z.string().max(600).default("Was möchtest du wissen?").describe("erste Nachricht des Experten"),
    platzhalter: z.string().max(120).default("Frage stellen …"),
  }),
  postfach: z.object({
    titel: z.string().max(120).default("Postfach"),
    anzahl: z.union([z.literal(10), z.literal(25), z.literal(50)]).default(25).describe("Nachrichten je Seite"),
    vorschau: z.boolean().default(true).describe("erste Zeile des Inhalts in der Liste zeigen"),
    /** Vordefinierte Prozeduren: Mails zu einem Thema aus den letzten Tagen in einen Ordner ablegen */
    prozeduren: z.array(z.object({
      name: z.string().max(80).default("Aufräumen"),
      thema: z.string().max(200).default("").describe("Thema oder Suchbegriffe, z. B. „Cyber Resilience Act, CRA“"),
      tage: z.number().int().min(1).max(365).default(30),
      zielordner: z.string().max(120).default("").describe("Name des Zielordners; wird angelegt, wenn es ihn nicht gibt"),
      ki: z.boolean().default(true).describe("KI entscheidet thematisch, sonst nur Wortsuche in Betreff, Absender und Vorschau"),
    })).max(10).default([]),
  }).describe("Postfach der angemeldeten Person wie in Outlook: Ordner, Nachrichten, geöffnete Nachricht; KI zur offenen Mail (Zusammenfassung, Antwortentwurf, Aufgaben, freie Frage) und Prozeduren (Mails zu einem Thema in einen Ordner ablegen). Microsoft Graph Mail.Read, Schreiben mit Mail.ReadWrite"),
  output: z.object({ titel: z.string().max(120).default("Ergebnis"), quelle: z.string().max(40).default("").describe("ID eines Schritts"), stil: z.enum(["card", "plain"]).default("card"), pfad: z.string().max(120).default("").describe('bei format json: nur diesen Teil des Ergebnisses zeigen, z. B. "bericht" oder "produkte.wartung"; Text wird als Markdown gezeigt, Listen und Objekte als Liste bzw. Tabelle; "" = ganzes Ergebnis') }),
} as const;

export type BlockType = keyof typeof PropsSchemas;
export const BLOCK_TYPES = Object.keys(PropsSchemas) as BlockType[];
export const FIELD_TYPES = ["input", "textarea", "select", "radio", "checkbox", "number", "date", "file", "tabelle"] as const;
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
  /** mail, teams, kalender: die eigenen E-Mails, Teams-Chats und -Kanäle bzw. Termine der Person (Microsoft Graph), ohne Adresse */
  typ: z.enum(["sharepoint", "datei", "web", "mail", "teams", "kalender"]).default("sharepoint"),
  titel: z.string().max(120).default(""),
  url: z.string().max(800).default(""),
  /** mail, teams, kalender: Zeitraum in Tagen (Kalender: zurück und voraus) */
  tage: z.number().int().min(1).max(90).default(7),
  /** mail, teams: nur Nachrichten, in denen eines dieser Wörter vorkommt (Komma getrennt; Platzhalter wie {{thema}} erlaubt); leer = alle */
  filter: z.string().max(200).default(""),
});
/** Quellen, die der Hub aus Microsoft 365 der angemeldeten Person liest (keine Adresse nötig) */
export const M365_QUELLEN = new Set(["mail", "teams", "kalender"]);

/** Wissensmodus: womit die KI arbeiten darf */
export const WissenModusSchema = z.enum(["eingaben", "m365", "web"]).describe('"eingaben" = nur Eingaben und hinterlegte Quellen; "m365" = zusätzlich Wissen aus Microsoft 365 (Dokumente, E-Mails, Chats); "web" = zusätzlich Websuche');
export const WISSEN_MODUS_LABEL: Record<z.infer<typeof WissenModusSchema>, string> = {
  eingaben: "Nur Eingaben und hinterlegte Quellen", m365: "Zusätzlich Wissen aus Microsoft 365", web: "Zusätzlich Websuche",
};
/** Wissen der ganzen App: Modus, fester Text und Quellen gelten für alle Schritte; Schritte ergänzen oder überschreiben */
export const WissenSchema = z.object({
  modus: WissenModusSchema.default("eingaben"),
  text: z.string().max(20000).default("").describe("festes Hintergrundwissen für alle Schritte"),
  quellen: z.array(QuelleSchema).max(20).default([]),
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
  /** ID eines Agenten aus der Agentenbibliothek: Name und Rolle kommen beim Lauf von dort (Feinjustierung wirkt in allen Apps) */
  vorlage: z.string().max(60).default("").describe("nie selbst setzen"),
});

/** Agent der Agentenbibliothek: einmal angelegt und feinjustiert, in jedem Agenten-Team verwendbar */
export const AgentVorlageSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  beschreibung: z.string().max(300).default(""),
  rolle: z.string().max(4000).default(""),
  /** Feinjustierung: Regeln, Tonfall, Grenzen; wird an die Rolle angehängt */
  hinweise: z.string().max(4000).default(""),
  geaendert: z.string().default(""),
  erstelltVon: z.string().max(200).default(""),
});
export type AgentVorlage = z.output<typeof AgentVorlageSchema>;

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
  /** ID eines Agenten aus der Agentenbibliothek: seine Rolle und Feinjustierung gelten für diesen Schritt (wirkt in allen Apps) */
  agent: z.string().max(60).default("").describe("nie selbst setzen"),
  wissen: z.string().max(20000).default(""),
  prompt: z.string().max(8000).default("").describe('Aufgabe; bei art "team" die Startsituation'),
  modell: z.enum(["quick", "default", "complex"]).default("default"),
  format: z.enum(["markdown", "text", "json", "dateien"]).default("markdown"),
  datei: z.enum(["", "pdf", "docx", "xlsx", "pptx", "wunsch"]).default("")
    .describe('Ergebnis zusätzlich als fertige Datei: "pdf", "docx" (Word), "xlsx" (Excel), "pptx" (PowerPoint), "wunsch" = die Datei, die in Aufgabe oder Eingaben verlangt wird; "" = keine'),
  autoAll: z.boolean().default(false),
  /** Vorlage für das Ergebnis: Aufbau und Stil als Text (aus einer Beispieldatei oder selbst geschrieben); bei einer
      Word-Vorlage zusätzlich die Datei (Base64), deren Design der Hub für die Word-Ausgabe übernimmt */
  vorlage: z.object({ name: z.string().max(200).default(""), text: z.string().max(20_000).default(""), docx: z.string().max(2_800_000).default("") }).nullable().default(null),
  wissenModus: z.enum(["app", "eingaben", "m365", "web"]).default("app").describe('"app" = Wissensmodus der App; sonst eigener Modus für diesen Schritt'),
  quellen: z.array(QuelleSchema).max(20).default([]),
  bedingung: BedingungSchema.nullable().default(null),
  /** Lernschicht: aus Rückmeldungen freigegebene Hausregeln, als Fassungen (die letzte gilt); der Hub hängt sie an die Rolle an */
  hausregeln: z.object({
    fassungen: z.array(z.object({ nr: z.number().int().min(1), datum: z.string().max(40).default(""), text: z.string().max(6000).default(""), grund: z.string().max(300).default("") })).max(60).default([]),
  }).default({ fassungen: [] }),
  /** Häufige Fragen: freigegebene Antworten, die der Chat sofort gibt (ohne KI), wenn eine Frage dazu passt */
  faq: z.object({
    eintraege: z.array(z.object({ id: z.string().max(40), frage: z.string().max(300), varianten: z.array(z.string().max(300)).max(10).default([]), antwort: z.string().max(4000), datum: z.string().max(40).default(""), quelle: z.enum(["lern", "hand"]).default("hand") })).max(100).default([]),
  }).default({ eintraege: [] }),
  team: TeamSchema.optional(),
});

/* ---------- Applikation ---------- */
/** Empfehlung einer App für einen regelmäßigen Auftrag (Zeitplan und Zustellung); der Auftrag-Dialog übernimmt sie als Vorschlag */
export const AuftragEmpfehlungSchema = z.object({
  art: z.enum(["taeglich", "werktags", "woechentlich", "monatlich"]).default("woechentlich"),
  uhrzeit: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
  wochentag: z.number().int().min(1).max(7).default(1),
  tag: z.number().int().min(1).max(28).default(1),
  ziel: z.enum(["hub", "email", "teams"]).default("email"),
});
export type AuftragEmpfehlung = z.output<typeof AuftragEmpfehlungSchema>;

export const AppSchema = z.object({
  id: z.string().nullable(),
  /** Empfohlener Auftrag (z. B. montags 07:00 per E-Mail); fehlt bei den meisten Apps */
  auftrag: AuftragEmpfehlungSchema.optional(),
  v: z.literal(2).default(2),
  typ: z.enum(["baukasten", "link"]).default("baukasten"),
  url: z.string().max(800).default(""),
  name: z.string().min(1).max(60),
  bereich: z.string().min(1).max(40).default("Allgemein"),
  beschreibung: z.string().max(300).default(""),
  theme: ThemeSchema.default({ accent: "", bg: "", font: "sans", radius: "m", width: "m" }),
  wissen: WissenSchema.default({ modus: "eingaben", text: "", quellen: [] }),
  blocks: z.array(BlockSchema).default([]),
  steps: z.array(StepSchema).max(10).default([]),
  /** gesperrt: nur noch für Personen mit Bearbeiten-Recht zu öffnen (Entsperren setzt „freigegeben“) */
  status: z.enum(["entwurf", "pruefung", "freigegeben", "gesperrt"]).default("entwurf"),
  /** „Weiter“ erst, wenn die Pflichtfelder der aktuellen Seite ausgefüllt sind */
  pflichtSperre: z.boolean().default(true),
  owner: z.string().max(120).default(""),
  /** Wer die App angelegt hat (E-Mail); darf sie immer bearbeiten */
  erstelltVon: z.string().max(200).default(""),
  /** Rechte je App: E-Mails; leere Liste bei „nutzen“ = alle dürfen */
  rechte: z.object({ bearbeiten: z.array(z.string().max(200)).default([]), nutzen: z.array(z.string().max(200)).default([]) }).default({ bearbeiten: [], nutzen: [] }),
  schutz: z.enum(["oeffentlich", "intern", "vertraulich"]).default("intern"),
  version: z.number().int().min(0).default(0),
  geaendert: z.string().default(""),
});

export type Theme = z.output<typeof ThemeSchema>;
export type Step = z.output<typeof StepSchema>;
export type Team = z.output<typeof TeamSchema>;
export type Agent = z.output<typeof AgentSchema>;
export type Quelle = z.output<typeof QuelleSchema>;
export type Wissen = z.output<typeof WissenSchema>;
export type WissenModus = z.output<typeof WissenModusSchema>;
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
