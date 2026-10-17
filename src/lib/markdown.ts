import DOMPurify from "dompurify";
import type { Step } from "./schema";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Links öffnen in einem neuen Tab (Quellen in SharePoint), ohne Zugriff auf das Hub-Fenster */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});
/**
 * Dateien, die Copilot in seiner eigenen Umgebung ablegt (Teams-Objektspeicher), sind von außen nicht abrufbar:
 * kein toter Link, sondern ein ehrlicher Hinweis.
 */
export const istTotLink = (href: string) => {
  try { return /(^|\.)asyncgw\.teams\.microsoft\.com$/i.test(new URL(href.replace(/&amp;/g, "&")).hostname); } catch { return false; }
};
/** Leerzeichen in einer Adresse kodieren (SharePoint-Pfade mit Ordnernamen wie „KPSS Templates“) */
const hrefSauber = (href: string) => href.replace(/ /g, "%20");
const link = (href: string, text: string, title = "") => istTotLink(href)
  ? `<span class="o-totlink" title="Diese Datei liegt nur in der Copilot-Umgebung und lässt sich hier nicht herunterladen.">${text} <em>(nur in Copilot abrufbar)</em></span>`
  : `<a href="${hrefSauber(href)}"${title ? ` title="${title}"` : ""}>${text}</a>`;
/** Dateiendungen, bis zu denen eine nackte Adresse auch über Leerzeichen hinweg als eine Adresse gilt */
const DATEI_ENDUNG = "docx?|pptx?|xlsx?|pdf|md|txt|csv|aspx";
/** Lesbarer Name für eine nackte Adresse: der Dateiname bzw. letzte Pfadteil ohne Prozentzeichen, sonst der Host */
export function linkName(url: string): string {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    const teile = u.pathname.split("/").filter(Boolean);
    let letzter = teile.at(-1) ?? "";
    try { letzter = decodeURIComponent(letzter); } catch { /* ungültige Kodierung: so lassen */ }
    letzter = letzter.replace(/\.aspx$/i, "").replace(/[_-]+/g, " ").trim();
    return esc(letzter || u.hostname);
  } catch { return url; }
}
export { dokumentName, verweiseAufloesen } from "./verweise";

const inline = (s: string) => esc(s)
  // [Text](https://…) und nackte Adressen (nicht schon Teil eines Links); Satzzeichen am Ende bleiben draußen
  // Adressen dürfen Klammern enthalten („…/Cyber Resilience Act (CRA) EU …“), solange sie paarig sind
  .replace(/\[([^\]]+)\]\(((?:sandbox|attachment):[^\s)]+)\)/g, (_, t: string) => `<span class="o-totlink" title="Diese Datei liegt nur in der Copilot-Umgebung und lässt sich hier nicht herunterladen.">${t} <em>(nur in Copilot abrufbar)</em></span>`)
  // Linkadressen dürfen Leerzeichen enthalten (werden kodiert), nicht aber unpaarige Klammern
  .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\n]|\([^()\n]*\))+?)\)/g, (_, t: string, u: string) => link(u.trim(), t))
  // Nackte Dateiadresse mit Leerzeichen im Pfad („…/KPSS Templates/Archive/Cheat Sheet.docx“): bis zur Dateiendung eine Adresse
  .replace(new RegExp(`(^|[^"&>\\w/])(https?:\\/\\/[^\\s<]+?(?: [^\\s<]+?)*?\\.(?:${DATEI_ENDUNG}))(?=$|[\\s.,;:)!?])`, "gi"), (_, vor: string, u: string) => vor + link(u, linkName(u), u))
  .replace(/(^|[^"&>\w/])(https?:\/\/[^\s<]*[^\s<.,;:)!?])/g, (_, vor: string, u: string) => vor + link(u, linkName(u), u))
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

function table(rows: string[]): string {
  const cells = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
  if (!body.length) return "";
  const [head, ...rest] = body;
  return `<div class="tbl"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const blockStart = /^(#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$|\s*(---|\*\*\*)\s*$|\s*```|\s*>)/;

/** Einfaches Markdown für KI-Antworten. Das Ergebnis wird immer mit DOMPurify bereinigt. */
export function markdown(src: string): string {
  return DOMPurify.sanitize(bloecke(String(src).replace(/\r/g, "").split("\n")), { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
}

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

function bloecke(lines: string[]): string {
  let html = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m: RegExpMatchArray | null;
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) {
      const sprache = (l.match(/^\s*```\s*([\w.+-]*)/)?.[1] ?? "").toLowerCase();
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      const offen = i >= lines.length; // Block noch nicht geschlossen (Antwort kommt noch)
      i++;
      const q = diagrammQuelle(sprache, code.join("\n")), art = q?.art ?? null, text = q?.code ?? code.join("\n");
      html += art
        ? `<figure class="o-diagramm" data-art="${art}"${offen ? ' data-offen="1"' : ""}><pre class="code">${esc(text)}</pre></figure>`
        : `<pre class="code">${esc(text)}</pre>`;
      continue;
    }
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { const h = Math.min(m[1].length + 2, 5); html += `<h${h}>${inline(m[2])}</h${h}>`; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { const rows: string[] = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]); html += table(rows); continue; }
    if (/^\s*[-*•]\s+/.test(l)) { html += "<ul>"; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-*•]\s+/, ""))}</li>`; html += "</ul>"; continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { html += "<ol>"; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`; html += "</ol>"; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { html += "<hr>"; i++; continue; }
    // Zitat/Rückfrage: „> Text“, auch mehrzeilig, innen wieder Markdown
    if (/^\s*>/.test(l)) { const z: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i])) z.push(lines[i++].replace(/^\s*>\s?/, "")); html += `<blockquote>${bloecke(z)}</blockquote>`; continue; }
    const para = [inline(lines[i++])];
    while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i])) para.push(inline(lines[i++]));
    html += `<p>${para.join("<br>")}</p>`;
  }
  return html;
}

export function renderResult(text: string, format: Step["format"]): string {
  if (format === "json") return DOMPurify.sanitize(`<pre class="code">${esc(text)}</pre>`);
  if (format === "text") return DOMPurify.sanitize(`<p>${esc(text).replace(/\n/g, "<br>")}</p>`);
  return markdown(text);
}
