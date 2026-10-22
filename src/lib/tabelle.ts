/**
 * Baustein „Tabelle“: Zeilen aus einem KI-Ergebnis (Spalten „ki“) plus Spalten zum Eintragen („eingabe“).
 * Der Wert steht wie bei allen Feldern als Text in den Werten der App: JSON {"zeilen": [...], "zusatz": [...]}.
 * „zusatz“ sind Zahlenspalten, die die Person beim Ausfüllen angelegt hat (z. B. je Mitarbeiter).
 */
import type { PropsOf } from "./schema";
import { slug } from "./model";

export type TabProps = PropsOf<"tabelle">;
export type Spalte = TabProps["spalten"][number];
export type Zeile = Record<string, string>;
export type TabWert = { zeilen: Zeile[]; zusatz: string[] };

const MAX_ZEILEN = 500;

/** Schlüssel einer Zusatzspalte aus ihrem Titel */
export const zusatzKey = (titel: string) => `z_${slug(titel)}`;

/** Wert aus den Werten der App lesen; alles Unlesbare ergibt eine leere Tabelle. */
export function tabelleLesen(v: unknown): TabWert {
  if (typeof v !== "string" || !v.trim()) return { zeilen: [], zusatz: [] };
  try {
    const j = JSON.parse(v) as { zeilen?: unknown; zusatz?: unknown };
    const zeilen = (Array.isArray(j.zeilen) ? j.zeilen : []).slice(0, MAX_ZEILEN).filter((z) => z && typeof z === "object")
      .map((z) => Object.fromEntries(Object.entries(z as Record<string, unknown>).map(([k, x]) => [k, x == null ? "" : String(x)])));
    const zusatz = (Array.isArray(j.zusatz) ? j.zusatz : []).map((t) => String(t ?? "").trim().slice(0, 60)).filter(Boolean).slice(0, 20);
    return { zeilen, zusatz };
  } catch { return { zeilen: [], zusatz: [] }; }
}

export const tabelleSchreiben = (w: TabWert): string => (w.zeilen.length || w.zusatz.length ? JSON.stringify(w) : "");

/** Alle Spalten in Anzeigereihenfolge: die festen aus dem Baukasten, dann die beim Ausfüllen angelegten */
export function alleSpalten(p: Pick<TabProps, "spalten">, w: TabWert): Spalte[] {
  return [...p.spalten, ...w.zusatz.map((t): Spalte => ({ key: zusatzKey(t), titel: t, typ: "zahl", art: "eingabe", summe: true }))];
}

/** Zahl aus einer Eingabe: „1.234,5“, „12,5“ und „12.5“; NaN, wenn keine Zahl darin steht. */
export function zahlAus(s: string): number {
  const t = String(s ?? "").replace(/\s|€|EUR/gi, "");
  if (!t) return NaN;
  const norm = /,\d{1,}$/.test(t) || (t.includes(",") && !t.includes(".")) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

export const zahlText = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** Summe einer Spalte (leere und nicht lesbare Zellen zählen nicht) */
export function summeVon(zeilen: Zeile[], key: string): number {
  return zeilen.reduce((s, z) => { const n = zahlAus(z[key] ?? ""); return Number.isNaN(n) ? s : s + n; }, 0);
}

/** Wert eines Objekts unter einem Schlüssel, ohne Beachtung der Schreibweise; auch unter dem Titel der Spalte */
function feldIn(o: Record<string, unknown>, sp: Spalte): unknown {
  const ks = Object.keys(o);
  const k = ks.find((x) => x === sp.key) ?? ks.find((x) => x.toLowerCase() === sp.key.toLowerCase()) ?? ks.find((x) => slug(x) === sp.key || slug(x) === slug(sp.titel));
  return k === undefined ? undefined : o[k];
}

const zellText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return Array.isArray(v) ? v.map(zellText).filter(Boolean).join(", ") : zellText((v as { wert?: unknown }).wert ?? JSON.stringify(v));
  return String(v).trim();
};

/**
 * Zeilen aus dem KI-Ergebnis: eine Liste von Objekten (oder ein Objekt, dessen einziger Inhalt eine solche Liste ist).
 * Übernommen werden nur die Spalten mit art „ki“; Eingabespalten bleiben leer.
 */
export function ausKi(p: Pick<TabProps, "spalten">, roh: unknown): TabWert {
  let liste = roh;
  if (liste && typeof liste === "object" && !Array.isArray(liste)) {
    const werte = Object.values(liste as Record<string, unknown>);
    const einzige = werte.filter(Array.isArray);
    liste = einzige.length === 1 ? einzige[0] : werte.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? werte : [liste];
  }
  if (!Array.isArray(liste)) return { zeilen: [], zusatz: [] };
  const ki = p.spalten.filter((s) => s.art === "ki");
  const zeilen = liste.slice(0, MAX_ZEILEN).filter((o) => o && typeof o === "object" && !Array.isArray(o)).map((o) => {
    const z: Zeile = {};
    for (const sp of ki) z[sp.key] = zellText(feldIn(o as Record<string, unknown>, sp));
    return z;
  }).filter((z) => Object.values(z).some(Boolean));
  return { zeilen, zusatz: [] };
}

/** Tabelle als Markdown für Prompts, mit Summenzeile, wenn eine Spalte summiert wird */
export function alsMarkdown(p: Pick<TabProps, "spalten">, v: unknown): string {
  const w = tabelleLesen(v);
  if (!w.zeilen.length) return "";
  const sp = alleSpalten(p, w);
  const zelle = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const zeilen = [
    `| ${sp.map((s) => zelle(s.titel)).join(" | ")} |`,
    `| ${sp.map((s) => (s.typ === "zahl" ? "---:" : "---")).join(" | ")} |`,
    ...w.zeilen.map((z) => `| ${sp.map((s) => zelle(z[s.key] ?? "")).join(" | ")} |`),
  ];
  if (sp.some((s) => s.summe && s.typ === "zahl")) zeilen.push(`| ${sp.map((s, i) => (s.summe && s.typ === "zahl" ? `**${zahlText(summeVon(w.zeilen, s.key))}**` : i === 0 ? "**Summe**" : "")).join(" | ")} |`);
  return zeilen.join("\n");
}
