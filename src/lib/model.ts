import {
  AppSchema, PropsSchemas, StepSchema, isFieldType,
  type App, type Block, type BlockType, type Step, type FieldType, type PropsOf,
} from "./schema";

export const rid = (p: string) => p + Math.random().toString(36).slice(2, 9);
export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function slug(s: string): string {
  return String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "feld";
}
export function uniqueKey(base: string, taken: Set<string>): string {
  let k = base, n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  return k;
}
export function varsIn(text: string | undefined): string[] {
  return [...String(text ?? "").matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].toLowerCase());
}
export function fill(tpl: string, ctx: Record<string, string>): string {
  return String(tpl ?? "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k: string) => {
    const key = k.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : m;
  });
}

/* ---------- Baum der Bausteine ---------- */
export function walk(list: Block[], fn: (b: Block) => void) {
  for (const b of list) {
    fn(b);
    if (b.children) walk(b.children, fn);
    if (b.cols) b.cols.forEach((c) => walk(c, fn));
  }
}
export type Located = { list: Block[]; i: number; b: Block };
export function locate(list: Block[], id: string): Located | null {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.id === id) return { list, i, b };
    for (const sub of [b.children, ...(b.cols ?? [])]) {
      if (!sub) continue;
      const r = locate(sub, id);
      if (r) return r;
    }
  }
  return null;
}
export function contains(b: Block, id: string): boolean {
  let found = false;
  walk([b], (x) => { if (x.id === id) found = true; });
  return found;
}
export type FieldBlock = Extract<Block, { type: FieldType }>;
export function fieldsOf(app: Pick<App, "blocks">): FieldBlock[] {
  const out: FieldBlock[] = [];
  walk(app.blocks, (b) => { if (isFieldType(b.type)) out.push(b as FieldBlock); });
  return out;
}
export function allKeys(app: Pick<App, "blocks" | "steps">, except?: unknown): Set<string> {
  const s = new Set<string>();
  fieldsOf(app).forEach((b) => { if (b !== except) s.add(b.props.key); });
  zusatzKeys(app).forEach((k) => s.add(k));
  app.steps.forEach((st) => { if (st !== except) s.add(st.key); });
  return s;
}

/* ---------- Neue Bausteine und Schritte ---------- */
export function makeBlock<T extends BlockType>(type: T, app?: Pick<App, "blocks" | "steps">): Block {
  const props = PropsSchemas[type].parse({}) as PropsOf<T>;
  const b = { id: rid("b"), type, props } as Block;
  if (type === "section" || type === "seite") b.children = [];
  if (type === "columns") b.cols = [[], []];
  if (isFieldType(type) && app) {
    const p = b.props as PropsOf<FieldType>;
    p.key = uniqueKey(slug(p.label), allKeys(app));
  }
  if (type === "output" && app?.steps[0]) (b.props as PropsOf<"output">).quelle = app.steps[0].id;
  return b;
}
export function makeStep(app: Pick<App, "blocks" | "steps">, art: "prompt" | "team" = "prompt"): Step {
  const n = app.steps.length + 1;
  const step = StepSchema.parse({ id: rid("s"), name: art === "team" ? "Agenten-Team" : `KI-Schritt ${n}`, key: uniqueKey(`schritt${n}`, allKeys(app)), art });
  if (art === "team") {
    step.team = {
      ziel: "Ein abgestimmtes Ergebnis, dem alle Agenten zustimmen.",
      maxRunden: 8,
      moderation: "",
      agenten: [
        { id: rid("g"), name: "Planer", rolle: "Zerlegt die Aufgabe in Schritte und schlägt das Vorgehen vor." },
        { id: rid("g"), name: "Fachexperte", rolle: "Bringt Fachwissen ein und arbeitet Inhalte konkret aus." },
        { id: rid("g"), name: "Prüfer", rolle: "Prüft Ergebnisse kritisch auf Lücken, Risiken und Widersprüche." },
      ],
    };
    step.prompt = "";
  }
  return step;
}
export function cloneBlock(b: Block, app: Pick<App, "blocks" | "steps">): Block {
  const c = clone(b);
  const taken = allKeys(app);
  const re = (x: Block) => {
    x.id = rid("b");
    if (isFieldType(x.type)) {
      const p = x.props as PropsOf<FieldType>;
      p.key = uniqueKey(slug(p.key), taken);
      taken.add(p.key);
    }
    x.children?.forEach(re);
    x.cols?.forEach((col) => col.forEach(re));
  };
  re(c);
  return c;
}
export function setCols(b: Block, n: 2 | 3) {
  if (b.type !== "columns" || !b.cols) return;
  while (b.cols.length < n) b.cols.push([]);
  while (b.cols.length > n) {
    const extra = b.cols.pop()!;
    b.cols[b.cols.length - 1].push(...extra);
  }
  b.props.count = n;
}

/* ---------- Variablen ---------- */
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function renameRefs(app: App, oldK: string, newK: string) {
  // Auch die Zusatz-Platzhalter von Datei-Feldern ({{alt_name}} → {{neu_name}}) mitnehmen.
  const re = new RegExp(`\\{\\{\\s*${escRe(oldK)}(_(?:name|titel|datum))?\\s*\\}\\}`, "gi");
  const neu = (_: string, zusatz?: string) => `{{${newK}${zusatz ?? ""}}}`;
  for (const s of app.steps) {
    s.prompt = s.prompt.replace(re, neu);
    s.wissen = s.wissen.replace(re, neu);
    if (s.team) s.team.ziel = s.team.ziel.replace(re, neu);
    if (s.bedingung?.feld === oldK) s.bedingung.feld = newK;
  }
}
export function removeVar(s: Step, k: string) {
  const kre = escRe(k);
  const tok = new RegExp(`\\{\\{\\s*${kre}\\s*\\}\\}`, "gi");
  s.prompt = s.prompt
    .replace(new RegExp(`\\n*[^\\n{}]*:[ \\t]*\\n\\{\\{\\s*${kre}\\s*\\}\\}[ \\t]*`, "gi"), "")
    .replace(tok, "").replace(/\n{3,}/g, "\n\n").trim();
  s.wissen = s.wissen.replace(tok, "").trim();
}
export function stepText(s: Step): string {
  return [s.prompt, s.wissen, s.team?.ziel ?? ""].join(" ");
}
/** Indizes der Schritte, die ein Feld bekommen (Platzhalter oder „alle Eingaben anhängen“). */
export function stepsUsing(app: Pick<App, "steps">, key: string): number[] {
  const k = key.toLowerCase();
  const out: number[] = [];
  // Zusatz-Platzhalter einer Datei ({{key_name}} usw.) zählen als Nutzung des Datei-Felds.
  const treffer = (v: string) => v === k || DATEI_ZUSATZ.some((z) => v === `${k}_${z.key}`);
  app.steps.forEach((s, i) => { if (s.autoAll || varsIn(stepText(s)).some(treffer)) out.push(i); });
  return out;
}

/** Zusätzliche Platzhalter je Datei-Feld: Dateiname, Titel (Dateiname ohne Endung) und Änderungsdatum der Datei. */
export const DATEI_ZUSATZ = [
  { key: "name", label: "Dateiname" },
  { key: "titel", label: "Titel" },
  { key: "datum", label: "Datum" },
] as const;
export function zusatzKeys(app: Pick<App, "blocks">): string[] {
  return fieldsOf(app).filter((b) => b.type === "file").flatMap((b) => DATEI_ZUSATZ.map((z) => `${b.props.key.toLowerCase()}_${z.key}`));
}

/* ---------- Buttons ---------- */
export function stepsFor(app: Pick<App, "steps">, aktion: string | undefined): Step[] {
  const a = aktion || "alle";
  if (a === "alle") return app.steps.slice();
  if (a.startsWith("ab:")) {
    const i = app.steps.findIndex((s) => s.id === a.slice(3));
    return i < 0 ? [] : app.steps.slice(i);
  }
  return app.steps.filter((s) => s.id === a);
}

/* ---------- Neue App und älteres Format ---------- */
type LegacyField = { key: string; label: string; typ?: string; optionen?: string[]; pflicht?: boolean; beispiel?: string };
type LegacyStep = { titel?: string; rolle?: string; prompt?: string; modell?: string; format?: string };
export type LegacyApp = {
  id?: string | null; name: string; bereich?: string; beschreibung?: string; typ?: "baukasten" | "link"; url?: string;
  farbe?: string; felder?: LegacyField[]; schritte?: LegacyStep[]; status?: App["status"]; version?: number;
};

/** Baut aus einer einfachen Beschreibung (Felder + Schritte) eine App mit Standard-Layout. */
export function fromSimple(d: LegacyApp): App {
  const app = AppSchema.parse({
    id: d.id ?? null, name: d.name || "Neue Applikation", bereich: d.bereich || "Allgemein", beschreibung: d.beschreibung || "",
    typ: d.typ || "baukasten", url: d.url || "", theme: { accent: d.farbe || "" }, status: d.status ?? "freigegeben", version: d.version ?? 1,
  });
  if (app.typ === "link") return app;
  app.steps = (d.schritte ?? []).map((s, i) => StepSchema.parse({
    id: rid("s"), name: s.titel || `KI-Schritt ${i + 1}`, key: `schritt${i + 1}`, rolle: s.rolle || "", prompt: s.prompt || "",
    modell: s.modell === "quick" || s.modell === "complex" ? s.modell : "default", format: s.format === "text" || s.format === "json" || s.format === "dateien" ? s.format : "markdown",
  }));
  const typeMap: Record<string, FieldType> = { text: "input", textarea: "textarea", auswahl: "select" };
  const fields: Block[] = (d.felder ?? []).map((f) => {
    const t = typeMap[f.typ ?? "text"] ?? "input";
    const props = PropsSchemas[t].parse({ label: f.label, key: f.key, keyAuto: false, pflicht: !!f.pflicht, beispiel: f.beispiel ?? "", ...(t === "select" ? { optionen: f.optionen ?? [] } : {}) });
    return { id: rid("b"), type: t, props } as Block;
  });
  const button = makeBlock("button");
  (button.props as PropsOf<"button">).text = "Ausführen";
  const heading = makeBlock("heading");
  Object.assign(heading.props, { text: "Eingaben", level: 3 });
  const left = makeBlock("section");
  left.children = [heading, ...fields, button];
  const right: Block[] = app.steps.map((s) => {
    const o = makeBlock("output");
    Object.assign(o.props, { titel: s.name, quelle: s.id });
    return o;
  });
  const h1 = makeBlock("heading");
  Object.assign(h1.props, { text: app.name, level: 1 });
  const intro = makeBlock("text");
  Object.assign(intro.props, { text: app.beschreibung });
  // Eine Seite für die Eingaben, danach je KI-Schritt eine Seite mit seinem Ergebnis.
  app.blocks = [neueSeite("Eingaben", [h1, intro, left]), ...right.map((o, i) => neueSeite(app.steps[i]?.name ?? "Ergebnis", [o]))];
  return app;
}

/* ---------- Seiten ---------- */
export function neueSeite(titel: string, children: Block[] = []): Block {
  const p = makeBlock("seite");
  (p.props as PropsOf<"seite">).titel = titel.slice(0, 60);
  p.children = children;
  return p;
}
export const seitenVon = (app: Pick<App, "blocks">): Block[] => app.blocks.filter((b) => b.type === "seite");
export const seitenTitel = (p: Block | undefined, i: number) => (p?.type === "seite" && p.props.titel) || `Seite ${i + 1}`;
/** Index der Seite, die einen passenden Baustein enthält (-1, wenn keine). */
export function seiteMit(app: Pick<App, "blocks">, pred: (b: Block) => boolean): number {
  return seitenVon(app).findIndex((p) => {
    let ja = false;
    walk(p.children ?? [], (b) => { if (!ja && pred(b)) ja = true; });
    return ja;
  });
}

/** Ergebnis-Elemente aus einem Baum herauslösen; leere Container entfernen, Spalten mit nur einer gefüllten Spalte auflösen. */
function ausgabenHerausloesen(list: Block[], outs: Block[]): Block[] {
  const res: Block[] = [];
  for (const b of list) {
    if (b.type === "output") { outs.push(b); continue; }
    if (b.children) {
      b.children = ausgabenHerausloesen(b.children, outs);
      if (!b.children.length && b.type === "section") continue;
    }
    if (b.cols) {
      b.cols = b.cols.map((c) => ausgabenHerausloesen(c, outs));
      const voll = b.cols.filter((c) => c.length);
      if (!voll.length) continue;
      if (voll.length === 1) { res.push(...voll[0]); continue; }
    }
    res.push(b);
  }
  return res;
}

/** Stellt sicher, dass die oberste Ebene nur aus Seiten besteht (ältere Apps werden aufgeteilt). */
export function seitenSicherstellen(blocks: Block[], steps: Pick<Step, "id" | "name">[] = []): Block[] {
  const lose = blocks.filter((b) => b.type !== "seite");
  const vorhanden = blocks.filter((b) => b.type === "seite");
  if (!lose.length) return vorhanden.length ? vorhanden : [neueSeite("Seite 1")];
  const outs: Block[] = [];
  const eingaben = ausgabenHerausloesen(lose, outs);
  const neu = [neueSeite("Eingaben", eingaben), ...outs.map((o) => neueSeite((o.type === "output" && (steps.find((s) => s.id === o.props.quelle)?.name || o.props.titel)) || "Ergebnis", [o]))];
  return [...neu.filter((p) => p.children?.length), ...vorhanden];
}

export function newApp(): App {
  const app = fromSimple({
    name: "Neue Applikation", bereich: "Allgemein", beschreibung: "Beschreib hier kurz, was die Applikation macht.", status: "entwurf", version: 0,
    felder: [{ key: "text", label: "Text", typ: "textarea", pflicht: true }],
    schritte: [{ titel: "Ergebnis", prompt: "Fasse den folgenden Text in fünf Stichpunkten zusammen:\n\n{{text}}" }],
  });
  return app;
}

/** Leerer Entwurf als Ausgangspunkt für den KI-Assistenten („baue komplett neu auf“). */
export function leereApp(bereich = "Allgemein"): App {
  const app = AppSchema.parse({ id: null, name: "Neue Applikation", bereich: bereich || "Allgemein" });
  app.blocks = [neueSeite("Eingaben")];
  return app;
}

/* ---------- Prüfung ---------- */
export type Warnung = { text: string; weich: boolean };
export function appWarnings(app: App): Warnung[] {
  const w: Warnung[] = [];
  const hard = (text: string) => w.push({ text, weich: false });
  const soft = (text: string) => w.push({ text, weich: true });
  const fieldKeys = fieldsOf(app).map((b) => b.props.key);
  if (!app.name.trim()) hard("Gib der Applikation einen Namen.");
  if (!app.steps.length) hard("Leg im KI-Ablauf mindestens einen KI-Schritt an.");
  app.steps.forEach((s, i) => {
    const avail = new Set([...fieldKeys, ...zusatzKeys(app), ...app.steps.slice(0, i).map((x) => x.key)]);
    for (const k of varsIn(stepText(s))) if (!avail.has(k)) hard(`„${s.name}“ nutzt {{${k}}}. Diese Variable gibt es an dieser Stelle nicht.`);
    if (!s.prompt.trim()) hard(`„${s.name}“ hat noch keine Aufgabe.`);
    if (s.bedingung?.feld && !fieldKeys.includes(s.bedingung.feld)) hard(`Die Bedingung von „${s.name}“ verweist auf ein Feld, das es nicht mehr gibt.`);
    if (s.quellen.some((q) => !q.url.trim())) soft(`„${s.name}“ hat eine Wissensquelle ohne Adresse.`);
    if (s.art === "team") {
      if (!s.team || s.team.agenten.length < 2) hard(`Das Agenten-Team „${s.name}“ braucht mindestens zwei Agenten.`);
      else if (s.team.agenten.some((a) => !a.rolle.trim())) soft(`Im Agenten-Team „${s.name}“ hat ein Agent noch keine Rolle.`);
      if (!s.team?.ziel.trim()) hard(`Das Agenten-Team „${s.name}“ hat noch kein Ziel.`);
    }
  });
  let hasBtn = false;
  const outSrc = new Set<string>();
  walk(app.blocks, (b) => {
    if (b.type === "button") {
      hasBtn = true;
      if (b.props.aktion !== "alle" && !stepsFor(app, b.props.aktion).length) hard(`Der Button „${b.props.text}“ startet einen Schritt, den es nicht mehr gibt.`);
    }
    if (b.type === "output") {
      if (!app.steps.some((s) => s.id === b.props.quelle)) hard(`Das Ergebnis-Element „${b.props.titel}“ ist mit keinem KI-Schritt verbunden.`);
      outSrc.add(b.props.quelle);
    }
    if ((b.type === "select" || b.type === "radio") && !b.props.optionen.length) hard(`„${b.props.label}“ hat noch keine Optionen.`);
  });
  if (app.steps.length && !hasBtn) hard("Auf der Oberfläche fehlt ein KI-Button, der den Ablauf startet.");
  seitenVon(app).forEach((p, i) => { if (!p.children?.length) soft(`Seite ${i + 1} „${(p.props as PropsOf<"seite">).titel}“ ist leer.`); });
  app.steps.forEach((s) => { if (!outSrc.has(s.id)) soft(`Für „${s.name}“ gibt es kein Ergebnis-Element. Das Ergebnis erscheint als Kachel in der Ergebnisübersicht der App.`); });
  fieldsOf(app).forEach((b) => { if (!stepsUsing(app, b.props.key).length) soft(`Die Eingabe „${b.props.label}“ geht an keinen KI-Schritt.`); });
  return w;
}

/* ---------- Bereiche ---------- */
export const AREA_ORDER = ["Allgemein", "Vertrieb", "Personal", "Marketing", "IT", "Recht", "Einkauf"];
export function areaIdx(area: string): number {
  const i = AREA_ORDER.indexOf(area);
  if (i >= 0) return i;
  let h = 0;
  for (const c of String(area)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 7;
}
export function areaList(apps: Pick<App, "bereich">[]): string[] {
  return [...new Set(apps.map((a) => a.bereich).filter(Boolean))].sort((a, b) => {
    const ia = AREA_ORDER.indexOf(a), ib = AREA_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b, "de");
  });
}
export function initials(name: string): string {
  const w = String(name).replace(/[^A-Za-zÄÖÜäöüß0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean);
  if (!w.length) return "KI";
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
export function inkFor(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.38 ? "#00050d" : "#fbfaf9";
}
