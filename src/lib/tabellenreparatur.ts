/**
 * Copilot liefert Tabellen manchmal ohne äußere Striche und ohne Trennzeile („A | B | C“ je Zeile). Solche Blöcke
 * werden zu einer echten Markdown-Tabelle, damit Anzeige, Word/PDF und Mail sie als Tabelle zeigen.
 * Erkannt wird nur ein Block aus mindestens zwei aufeinanderfolgenden Zeilen mit gleich vielen (mindestens drei)
 * Zellen; einzelne Zeilen mit „|“ im Fließtext bleiben unverändert.
 */
const zellen = (z: string) => z.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const randlos = (z: string) => !/^\s*\|/.test(z) && /\S\s*\|\s*\S/.test(z) && !/^\s*(```|#|>)/.test(z);
const trennzeile = (z: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(z);

export function tabellenReparieren(text: string): string {
  if (!text.includes("|")) return text;
  const zeilen = text.split("\n");
  const aus: string[] = [];
  let imCode = false;
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]!;
    if (/^\s*```/.test(z)) imCode = !imCode;
    if (imCode || !randlos(z)) { aus.push(z); continue; }
    const n = zellen(z).length;
    let j = i;
    while (j + 1 < zeilen.length && (trennzeile(zeilen[j + 1]!) || (randlos(zeilen[j + 1]!) && zellen(zeilen[j + 1]!).length === n))) j++;
    const block = zeilen.slice(i, j + 1).filter((x) => !trennzeile(x));
    if (n < 3 || block.length < 2) { aus.push(z); continue; }
    const zeile = (x: string) => `| ${zellen(x).join(" | ")} |`;
    aus.push(zeile(block[0]!), `|${" --- |".repeat(n)}`, ...block.slice(1).map(zeile));
    i = j;
  }
  return aus.join("\n");
}
