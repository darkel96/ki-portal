/** Erkennen, welcher Codeblock ein Diagramm ist (ohne DOM, damit auch der Hub-Dienst es nutzen kann) */

/**
 * Text-Pfeildiagramm (Blöcke, dazwischen Zeilen nur mit ↓) als Mermaid-Ablauf: erste Zeile eines Blocks ist der Titel,
 * weitere Zeilen die Erläuterung. Manche KI-Antworten zeichnen Abläufe so, statt Mermaid zu schreiben.
 */
export function textAblauf(text: string): string | null {
  const PFEIL = /^\s*(↓|⬇|⇓|⇩|v|V|\||│)\s*$/;
  const gruppen: string[][] = [];
  let akt: string[] = [], pfeile = 0;
  for (const z of text.split("\n")) {
    if (PFEIL.test(z)) { if (!akt.length) return null; gruppen.push(akt); akt = []; pfeile++; continue; }
    if (z.trim()) akt.push(z.trim());
  }
  if (akt.length) gruppen.push(akt);
  if (pfeile < 2 || gruppen.length !== pfeile + 1 || gruppen.some((g) => g.length > 4)) return null;
  const q = (s: string) => s.replace(/"/g, "#quot;").replace(/[<>]/g, "").replace(/^[+•-]\s*/, "");
  return ["flowchart TD", ...gruppen.map((g, i) => `  n${i}["${g.map(q).join("<br/>")}"]`), ...gruppen.slice(1).map((_, i) => `  n${i} --> n${i + 1}`)].join("\n");
}

/** Diagramm in einem Codeblock (Art und zu zeichnender Quelltext), auch aus einem Text-Pfeildiagramm */
export function diagrammQuelle(sprache: string, text: string): { art: "mermaid" | "svg" | "drawio"; code: string } | null {
  const art = diagrammArt(sprache, text);
  if (art) return { art, code: text };
  const ablauf = ["", "text", "txt", "plain", "plaintext"].includes(sprache) ? textAblauf(text) : null;
  return ablauf ? { art: "mermaid", code: ablauf } : null;
}

/** Codeblock, den der Hub als Diagramm zeichnet: Mermaid, SVG oder eine draw.io-Datei */
export function diagrammArt(sprache: string, text: string): "mermaid" | "svg" | "drawio" | null {
  const t = text.trim();
  if (sprache === "mermaid" || (!sprache && /^(flowchart|graph|sequenceDiagram|gantt|classDiagram|stateDiagram(-v2)?|erDiagram|journey|mindmap|timeline|pie)\b/.test(t))) return "mermaid";
  if (sprache === "svg" || ((sprache === "xml" || sprache === "html" || !sprache) && /^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t))) return "svg";
  if (sprache === "drawio" || /^(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)[\s>]/i.test(t)) return "drawio";
  return null;
}
