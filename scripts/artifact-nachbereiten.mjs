// Nach `vite build --mode artifact`: Seite hub.html für claude.ai erzeugen und Zeichen maskieren,
// die die Veröffentlichung ablehnt (U+FFFD in Bibliotheken wie docx und pdfmake).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "dist-artifact";
const FFFD = String.fromCharCode(0xfffd);
const ESC = String.fromCharCode(92) + "uFFFD";
for (const f of readdirSync(`${dir}/assets`).filter((f) => f.endsWith(".js"))) {
  const p = `${dir}/assets/${f}`;
  const s = readFileSync(p, "utf8");
  if (s.includes(FFFD)) writeFileSync(p, s.split(FFFD).join(ESC), "utf8");
}
const idx = readFileSync(`${dir}/index.html`, "utf8");
const tags = [...idx.matchAll(/<(script|link)[^>]*(src|href)="\.\/assets\/[^"]+"[^>]*>(<\/script>)?/g)].map((m) => m[0]);
writeFileSync(`${dir}/hub.html`, ["<title>KI-Hub Testfassung</title>", ...tags, '<div id="root"></div>', ""].join("\n"));
console.log("dist-artifact/hub.html erzeugt. Die pdf.worker-Datei (.mjs) nicht mitveröffentlichen.");
