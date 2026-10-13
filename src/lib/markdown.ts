import DOMPurify from "dompurify";
import type { Step } from "./schema";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Links öffnen in einem neuen Tab (Quellen in SharePoint), ohne Zugriff auf das Hub-Fenster */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});
const link = (href: string, text: string, title = "") => `<a href="${href}"${title ? ` title="${title}"` : ""}>${text}</a>`;
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
const inline = (s: string) => esc(s)
  // [Text](https://…) und nackte Adressen (nicht schon Teil eines Links); Satzzeichen am Ende bleiben draußen
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => link(u, t))
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

function bloecke(lines: string[]): string {
  let html = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m: RegExpMatchArray | null;
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      html += `<pre class="code">${esc(code.join("\n"))}</pre>`;
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
