/**
 * Export für Microsoft Project: Der Hub liest eine Vorgangstabelle aus dem Ergebnis (Markdown) und schreibt daraus
 * selbst eine Datei im Microsoft-Project-XML-Format (MSPDI), die MS Project direkt öffnet (Datei → Öffnen → XML).
 * Erkannt wird die erste Tabelle mit einer Namensspalte (Vorgang, Vorgangsname, Aufgabe, Name, Task) und Dauer,
 * Anfang oder Ende. Optional: Nr, Vorgänger („2“, „2;3“, „2EA+1“, „3AA“, „4FS“), Gewerk bzw. Phase (wird Sammelvorgang).
 * Reihenfolge der Elemente folgt dem MSPDI-Schema, MS Project lehnt sonst die Datei ab.
 */

export type Verknuepfung = { nr: string; typ: "EA" | "AA" | "EE" | "AE"; abstandTage: number };
export type Vorgang = { nr: string; name: string; dauerTage: number | null; anfang: string | null; ende: string | null; vorgaenger: Verknuepfung[]; gruppe: string };

const SPALTEN = {
  name: /^(vorgangs?name|vorgang|aufgabe|arbeitspaket|t[aä]tigkeit|name|task( name)?)$/,
  nr: /^(nr\.?|id|#|lfd\.? ?nr\.?|nummer)$/,
  dauer: /^(dauer|duration)( ?\((arbeits)?tage?\)| in (arbeits)?tagen| ?\(at\)| ?\(d\))?$/,
  anfang: /^(anfang|start|beginn|startdatum)$/,
  ende: /^(ende|finish|fertigstellung|enddatum)$/,
  vorgaenger: /^(vorg[aä]nger|predecessors?|abh[aä]ngigkeit(en)?)$/,
  gruppe: /^(gewerk|phase|abschnitt|bereich|sammelvorgang)$/,
};

const zellen = (zeile: string) => zeile.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((z) => z.replace(/\\\|/g, "|").replace(/\*\*|__/g, "").trim());
const kopf = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Alle Markdown-Tabellen: Kopf und Zeilen */
function tabellen(text: string): { kopf: string[]; zeilen: string[][] }[] {
  const out: { kopf: string[]; zeilen: string[][] }[] = [];
  const z = String(text).split(/\r?\n/);
  for (let i = 0; i < z.length - 1; i++) {
    if (!z[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(z[i + 1])) continue;
    const t = { kopf: zellen(z[i]), zeilen: [] as string[][] };
    let j = i + 2;
    for (; j < z.length && z[j].trim().startsWith("|"); j++) t.zeilen.push(zellen(z[j]));
    out.push(t);
    i = j - 1;
  }
  return out;
}

/** Datum als JJJJ-MM-TT aus „2027-03-15“, „15.03.2027“ oder „15.03.27“; null, wenn keins darin steht */
export function datumAus(s: string): string | null {
  const t = String(s ?? "").trim();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(t);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Dauer in Arbeitstagen aus „5“, „5 Tage“, „2,5 T“, „1 Woche“, „16 Std“ */
function dauerAus(s: string): number | null {
  const t = String(s ?? "").toLowerCase().replace(",", ".");
  const m = /(-?\d+(?:\.\d+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (/woche|wk|\bw\b/.test(t)) return n * 5;
  if (/std|stunde|\bh\b/.test(t)) return n / 8;
  return n;
}

/** Vorgänger: „2“, „2; 3“, „2EA+1“, „3AA“, „4 FS-2“ (FS/SS/FF/SF werden auf EA/AA/EE/AE abgebildet) */
function vorgaengerAus(s: string): Verknuepfung[] {
  const typen: Record<string, Verknuepfung["typ"]> = { ea: "EA", fs: "EA", aa: "AA", ss: "AA", ee: "EE", ff: "EE", ae: "AE", sf: "AE" };
  return [...String(s ?? "").matchAll(/(\d+)\s*(ea|aa|ee|ae|fs|ss|ff|sf)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*(?:t|tage?|d|at)?)?/gi)]
    .map((m) => ({ nr: m[1], typ: typen[(m[2] ?? "ea").toLowerCase()], abstandTage: m[4] ? Number(m[4].replace(",", ".")) * (m[3] === "-" ? -1 : 1) : 0 }));
}

/** Vorgänge aus der ersten passenden Tabelle; leere Liste, wenn das Ergebnis keine Vorgangstabelle hat */
export function vorgaengeAus(text: string): Vorgang[] {
  for (const t of tabellen(text)) {
    const k = t.kopf.map(kopf);
    const idx = (re: RegExp) => k.findIndex((x) => re.test(x));
    const iName = idx(SPALTEN.name), iDauer = idx(SPALTEN.dauer), iAnfang = idx(SPALTEN.anfang), iEnde = idx(SPALTEN.ende);
    if (iName < 0 || (iDauer < 0 && iAnfang < 0 && iEnde < 0)) continue;
    const iNr = idx(SPALTEN.nr), iVor = idx(SPALTEN.vorgaenger), iGruppe = idx(SPALTEN.gruppe);
    const zelle = (z: string[], i: number) => (i < 0 ? "" : z[i] ?? "");
    const liste = t.zeilen.map((z, n): Vorgang => ({
      nr: zelle(z, iNr).replace(/\D/g, "") || String(n + 1),
      name: zelle(z, iName).slice(0, 250),
      dauerTage: iDauer < 0 ? null : dauerAus(zelle(z, iDauer)),
      anfang: datumAus(zelle(z, iAnfang)),
      ende: datumAus(zelle(z, iEnde)),
      vorgaenger: vorgaengerAus(zelle(z, iVor)),
      gruppe: zelle(z, iGruppe).slice(0, 120),
    })).filter((v) => v.name && !/^(summe|gesamt|total)$/i.test(v.name));
    if (liste.length) return liste;
  }
  return [];
}

/* ---------- Arbeitstage (Montag bis Freitag) ---------- */
const alsDatum = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const istArbeitstag = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
function naechsterArbeitstag(isoDatum: string): string {
  const d = alsDatum(isoDatum);
  while (!istArbeitstag(d)) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}
/** Letzter Arbeitstag eines Vorgangs, der am Anfang beginnt und so viele Arbeitstage dauert */
function endeNach(anfang: string, tage: number): string {
  const d = alsDatum(naechsterArbeitstag(anfang));
  for (let n = Math.max(1, Math.ceil(tage)) - 1; n > 0;) { d.setUTCDate(d.getUTCDate() + 1); if (istArbeitstag(d)) n--; }
  return iso(d);
}
function arbeitstageZwischen(anfang: string, ende: string): number {
  const d = alsDatum(anfang), e = alsDatum(ende);
  let n = 0;
  while (d <= e) { if (istArbeitstag(d)) n++; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dauerXml = (tage: number) => { const min = Math.round(tage * 480); return `PT${Math.floor(min / 60)}H${min % 60}M0S`; };
const LINK_TYP: Record<Verknuepfung["typ"], number> = { EE: 0, EA: 1, AE: 2, AA: 3 };

/**
 * MSPDI-Datei. Vorgänge werden automatisch geplant: Ein Anfang wird zur Einschränkung „Anfang nicht früher als“,
 * Vorgänger zu Verknüpfungen; MS Project rechnet die Termine mit seinem Standardkalender (Mo–Fr, 8 h) nach.
 * Mit Gruppenspalte (Gewerk, Phase) steht je Gruppe ein Sammelvorgang darüber.
 */
export function msProjectXml(vorgaenge: Vorgang[], meta: { titel: string; heute?: string }): string {
  const heute = meta.heute ?? iso(new Date());
  // Fehlende Daten ergänzen: Dauer aus Anfang und Ende, Ende aus Anfang und Dauer
  const v = vorgaenge.map((x) => {
    const anfang = x.anfang ? naechsterArbeitstag(x.anfang) : null;
    let dauer = x.dauerTage;
    if (dauer == null && anfang && x.ende) dauer = arbeitstageZwischen(anfang, x.ende);
    if (dauer == null) dauer = 1;
    dauer = Math.max(0, dauer);
    const ende = anfang ? (dauer === 0 ? anfang : endeNach(anfang, dauer)) : x.ende;
    return { ...x, anfang, ende, dauer };
  });
  const projektStart = v.map((x) => x.anfang).filter((x): x is string => !!x).sort()[0] ?? naechsterArbeitstag(heute);
  const mitGruppen = v.some((x) => x.gruppe);
  type Zeile = { uid: number; name: string; ebene: number; nummer: string; sammel: boolean; anfang: string; ende: string; dauer: number; constraint: string | null; links: Verknuepfung[]; nr?: string };
  const zeilen: Zeile[] = [];
  let uid = 1;
  const gruppen = mitGruppen ? [...new Set(v.map((x) => x.gruppe || "Weitere Vorgänge"))] : [""];
  gruppen.forEach((g, gi) => {
    const drin = mitGruppen ? v.filter((x) => (x.gruppe || "Weitere Vorgänge") === g) : v;
    if (mitGruppen) {
      const a = drin.map((x) => x.anfang ?? projektStart).sort()[0], e = drin.map((x) => x.ende ?? x.anfang ?? projektStart).sort().reverse()[0];
      zeilen.push({ uid: uid++, name: g, ebene: 1, nummer: String(gi + 1), sammel: true, anfang: a, ende: e, dauer: arbeitstageZwischen(a, e), constraint: null, links: [] });
    }
    drin.forEach((x, i) => {
      const a = x.anfang ?? projektStart;
      zeilen.push({ uid: uid++, name: x.name, ebene: mitGruppen ? 2 : 1, nummer: mitGruppen ? `${gi + 1}.${i + 1}` : String(i + 1), sammel: false, anfang: a, ende: x.ende ?? (x.dauer === 0 ? a : endeNach(a, x.dauer)), dauer: x.dauer, constraint: x.anfang, links: x.vorgaenger, nr: x.nr });
    });
  });
  const uidVonNr = new Map(zeilen.filter((z) => z.nr).map((z) => [z.nr!, z.uid]));
  const task = (z: Zeile, id: number) => [
    "    <Task>",
    `      <UID>${z.uid}</UID>`, `      <ID>${id}</ID>`, `      <Name>${xml(z.name)}</Name>`,
    "      <Manual>0</Manual>", "      <Type>0</Type>", "      <IsNull>0</IsNull>",
    `      <OutlineNumber>${z.nummer}</OutlineNumber>`, `      <OutlineLevel>${z.ebene}</OutlineLevel>`,
    `      <Start>${z.anfang}T08:00:00</Start>`, `      <Finish>${z.ende}T17:00:00</Finish>`,
    `      <Duration>${dauerXml(z.dauer)}</Duration>`, "      <DurationFormat>7</DurationFormat>",
    `      <Milestone>${!z.sammel && z.dauer === 0 ? 1 : 0}</Milestone>`, `      <Summary>${z.sammel ? 1 : 0}</Summary>`,
    `      <ConstraintType>${z.constraint ? 4 : 0}</ConstraintType>`,
    ...(z.constraint ? [`      <ConstraintDate>${z.constraint}T08:00:00</ConstraintDate>`] : []),
    ...z.links.filter((l) => uidVonNr.has(l.nr) && uidVonNr.get(l.nr) !== z.uid).map((l) => [
      "      <PredecessorLink>", `        <PredecessorUID>${uidVonNr.get(l.nr)}</PredecessorUID>`, `        <Type>${LINK_TYP[l.typ]}</Type>`,
      `        <LinkLag>${Math.round(l.abstandTage * 4800)}</LinkLag>`, "        <LagFormat>7</LagFormat>", "      </PredecessorLink>",
    ].join("\n")),
    "    </Task>",
  ].join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `  <Name>${xml(meta.titel)}.xml</Name>`, `  <Title>${xml(meta.titel)}</Title>`,
    "  <ScheduleFromStart>1</ScheduleFromStart>", `  <StartDate>${projektStart}T08:00:00</StartDate>`,
    "  <Tasks>", ...zeilen.map((z, i) => task(z, i + 1)), "  </Tasks>",
    "</Project>", "",
  ].join("\n");
}
