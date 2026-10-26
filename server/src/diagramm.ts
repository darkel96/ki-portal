/**
 * Diagramme (Mermaid, SVG) für Mail und Teams als PNG, ohne offenen Browser: Der Dienst öffnet seine eigene Seite
 * diagramm.html in einem Headless-Chromium (--dump-dom) und liest das Bild aus der Seite. Gezeichnet wird mit
 * derselben Logik wie im Hub. Fehlt Chromium oder der ausgelieferte Hub, gehen Diagramme als Quelltext raus.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagrammBild, DiagrammMaler } from "@/lib/versand";
import { UMGEBUNG } from "./umgebung";

const KANDIDATEN = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome"];

export function chromiumPfad(): string {
  const e = UMGEBUNG.chromium;
  if (/^(aus|0|nein|false)$/i.test(e)) return "";
  if (e) return existsSync(e) ? e : "";
  return KANDIDATEN.find((k) => existsSync(k)) ?? "";
}

/** Zeichner für die Zustellung, oder undefined, wenn der Dienst keine Diagramme zeichnen kann */
export function diagrammMalerImDienst(): DiagrammMaler | undefined {
  const exe = chromiumPfad();
  if (!exe || !UMGEBUNG.statisch || !existsSync(join(UMGEBUNG.statisch, "diagramm.html"))) return undefined;
  return (code, art) => einreihen(() => zeichnen(exe, code, art));
}

// Ein Chromium nach dem anderen: jedes braucht rund 100 MB Speicher
let schlange: Promise<unknown> = Promise.resolve();
function einreihen<T>(f: () => Promise<T>): Promise<T> {
  const p = schlange.then(f, f);
  schlange = p.catch(() => undefined);
  return p;
}

const entschluesseln = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

async function zeichnen(exe: string, code: string, art: "mermaid" | "svg"): Promise<DiagrammBild> {
  const anker = Buffer.from(JSON.stringify({ art, code }), "utf8").toString("base64url");
  const url = `http://127.0.0.1:${UMGEBUNG.port}/diagramm.html#${anker}`;
  const profil = mkdtempSync(join(tmpdir(), "kihub-chromium-"));
  try {
    const dom = await new Promise<string>((ok, fehler) => {
      // --no-sandbox: im Container ohne Benutzer-Namensräume startet Chromium sonst nicht; die Seite kommt vom Dienst selbst
      const p = spawn(exe, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--hide-scrollbars", "--mute-audio", `--user-data-dir=${profil}`, "--window-size=1200,900",
        "--virtual-time-budget=20000", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
      let text = "", fehlerText = "";
      p.stdout.on("data", (d: Buffer) => { text += d.toString("utf8"); });
      p.stderr.on("data", (d: Buffer) => { fehlerText = (fehlerText + d.toString("utf8")).slice(-600); });
      const uhr = setTimeout(() => { p.kill("SIGKILL"); fehler(new Error("Chromium hat nach 45 Sekunden kein Diagramm geliefert.")); }, 45_000);
      p.on("error", (e) => { clearTimeout(uhr); fehler(e); });
      p.on("close", (code) => { clearTimeout(uhr); if (text) ok(text); else fehler(new Error(`Chromium endete ohne Ausgabe (Code ${code}). ${fehlerText.trim()}`)); });
    });
    const m = /<pre id="ergebnis">([\s\S]*?)<\/pre>/.exec(dom);
    if (!m) throw new Error("Die Diagramm-Seite hat kein Ergebnis geliefert.");
    const r = JSON.parse(entschluesseln(m[1]!)) as Partial<DiagrammBild> & { fehler?: string };
    if (r.fehler || !r.png) throw new Error(r.fehler || "Kein Bild erhalten.");
    return { png: r.png, breite: Number(r.breite) || 800, hoehe: Number(r.hoehe) || 600 };
  } finally {
    rmSync(profil, { recursive: true, force: true });
  }
}
