import DOMPurify from "dompurify";
import type { Step } from "./schema";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

function table(rows: string[]): string {
  const cells = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
  if (!body.length) return "";
  const [head, ...rest] = body;
  return `<div class="tbl"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** Einfaches Markdown für KI-Antworten. Das Ergebnis wird immer mit DOMPurify bereinigt. */
export function markdown(src: string): string {
  const lines = String(src).replace(/\r/g, "").split("\n");
  let html = "", i = 0;
  const blockStart = /^(#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$|\s*(---|\*\*\*)\s*$|\s*```)/;
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
    const para = [inline(lines[i++])];
    while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i])) para.push(inline(lines[i++]));
    html += `<p>${para.join("<br>")}</p>`;
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function renderResult(text: string, format: Step["format"]): string {
  if (format === "json") return DOMPurify.sanitize(`<pre class="code">${esc(text)}</pre>`);
  if (format === "text") return DOMPurify.sanitize(`<p>${esc(text).replace(/\n/g, "<br>")}</p>`);
  return markdown(text);
}
