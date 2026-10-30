/**
 * KI-Hub-Dienst: führt Läufe und Aufträge aus, auch wenn im Browser kein Tab mehr offen ist, und liefert auf Wunsch
 * den gebauten Hub mit aus. Start: `node server/dist/index.mjs`, Einstellungen über die Umgebung (server/.env.example).
 */
import { chromiumPfad, diagrammMalerImDienst } from "./diagramm";
import { hubDatenLesen, hubDatenSchreibbar } from "./hubdaten";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { api } from "./api";
import { attrappe } from "./attrappe";
import { Laeufe } from "./laeufe";
import { Lernen } from "./lernen";
import { Personen } from "./personen";
import { Laufwerk } from "./laufwerk";
import { laufwerkImDienstSetzen } from "@/lib/ki/laufwerkquelle";
import { tokenKontext } from "./alias/auth";
import { DateiSpeicher } from "./speicher";
import { UMGEBUNG, umgebungPruefen } from "./umgebung";
import { zustellenImDienst } from "./versand";
import { zielText } from "@/lib/versand";
import { Zeitplan } from "./zeitplan";

const MAX_BODY = 30 * 1024 * 1024;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".map": "application/json" };

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return undefined;
  const teile: Buffer[] = [];
  let laenge = 0;
  for await (const chunk of req) {
    laenge += (chunk as Buffer).length;
    if (laenge > MAX_BODY) throw new Error("Die Anfrage ist zu groß.");
    teile.push(chunk as Buffer);
  }
  const text = Buffer.concat(teile).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && (UMGEBUNG.urspruenge.includes(origin) || UMGEBUNG.testmodus)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
  return false;
}

/** Gebauter Hub aus HUB_STATISCH; hub-config.json bekommt die Dienst-Adresse „/“ (derselbe Ursprung) */
async function statisch(pfad: string, res: ServerResponse): Promise<boolean> {
  if (!UMGEBUNG.statisch) return false;
  let rel = normalize(decodeURIComponent(pfad.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  if (rel === "/" || rel === "\\") rel = "/index.html";
  const datei = join(UMGEBUNG.statisch, rel);
  if (!datei.startsWith(normalize(UMGEBUNG.statisch))) return false;
  if (rel === "/hub-config.json") {
    let konfig: Record<string, unknown> = {};
    try { konfig = JSON.parse(await readFile(datei, "utf8")); } catch { /* keine Datei */ }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ...konfig, dienst: { ...(konfig.dienst as object ?? {}), url: "/" } }));
    return true;
  }
  // Hub-Daten aus dem Git-Speicher frisch aus dem Repository: Wer ohne Token liest, sähe sonst nur den Stand des letzten Builds
  if (/^\/hub-daten\/[\w.-]+\.json$/.test(rel.replace(/\\/g, "/")) && UMGEBUNG.gitRepo) {
    const frisch = await hubDatenLesen(rel.replace(/\\/g, "/").slice("/hub-daten/".length));
    if (frisch !== null) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(frisch);
      return true;
    }
  }
  try {
    const s = await stat(datei);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { "Content-Type": MIME[extname(datei)] ?? "application/octet-stream", "Cache-Control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
    res.end(await readFile(datei));
    return true;
  } catch {
    if (extname(rel)) return false;
    // Unbekannter Pfad ohne Endung: die App selbst, sie löst Adressen wie /cra-experte im Browser auf
    try { res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" }); res.end(await readFile(join(UMGEBUNG.statisch, "index.html"))); return true; } catch { return false; }
  }
}

async function start() {
  const fehler = umgebungPruefen();
  if (fehler.length) { console.error("[Hub-Dienst] Einstellungen unvollständig:\n - " + fehler.join("\n - ")); process.exit(1); }
  const speicher = new DateiSpeicher(UMGEBUNG.daten);
  const laeufe = new Laeufe(speicher);
  const zeitplan = new Zeitplan(speicher, laeufe);
  const lernen = new Lernen(speicher);
  const personen = new Personen(speicher);
  const laufwerk = new Laufwerk(speicher);
  await laufwerk.laden();
  if (laufwerk.aktiv) {
    // Neues und Geändertes regelmäßig nachlesen (alle 30 Minuten)
    setInterval(() => { void laufwerk.einlesen(); }, 30 * 60_000);
    // Läufe im Dienst: Suche mit der Person des Laufs (Freigaben nach ihrer E-Mail)
    laufwerkImDienstSetzen(async (q, frage, breiter) => {
      const id = tokenKontext.getStore()?.nutzer ?? "";
      const email = (await personen.alle()).find((p) => p.id === id)?.email ?? "";
      const titel = q.titel || UMGEBUNG.laufwerkName;
      let r = laufwerk.suchen(email, q.url, frage, titel);
      if (!r.fehler && !r.text && breiter) r = laufwerk.suchen(email, q.url, breiter, titel);
      return r;
    });
    console.info(`[Hub-Dienst] Netzlaufwerk ${UMGEBUNG.laufwerk}${UMGEBUNG.laufwerkUnc ? ` (${UMGEBUNG.laufwerkUnc})` : ""}: ${laufwerk.alleFreigaben().length} Freigabe(n)`);
  }
  laeufe.onEnde = async (l) => {
    console.info(`[Hub-Dienst] Lauf ${l.id} „${l.titel}“: ${l.status}${l.meldung ? ` (${l.meldung})` : ""}`);
    if (l.auftragId && l.status === "fertig" && l.ziel && l.ziel.art !== "hub") {
      try { l.zustellung = await zustellenImDienst(speicher, l); }
      catch (e) { l.zustellung = `Zustellung ${zielText(l.ziel)} fehlgeschlagen: ${e instanceof Error ? e.message : e}`; }
      l.version++;
      await speicher.schreiben(`laeufe/${l.id}.json`, l);
      console.info(`[Hub-Dienst] Lauf ${l.id}: ${l.zustellung}`);
    }
  };
  await laeufe.laden();
  zeitplan.start();
  setInterval(() => { void laeufe.aufraeumen(); }, 6 * 3600_000);
  // Lernschicht: fällige Auswertungen (Standard alle 10 Minuten prüfen)
  setInterval(() => { void lernen.faellige(); }, Number(process.env.HUB_LERNEN_MS) || 600_000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://hub");
    try {
      if (cors(req, res)) return;
      if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname.slice(4), url.searchParams, await body(req), { speicher, laeufe, zeitplan, lernen, personen, laufwerk });
      if (UMGEBUNG.testmodus && url.pathname.startsWith("/attrappe/")) return await attrappe(req, res, url.pathname.slice(9), await body(req), speicher);
      if (await statisch(url.pathname, res)) return;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(UMGEBUNG.statisch ? "Nicht gefunden." : "KI-Hub-Dienst: Die Schnittstelle liegt unter /api/dienst.");
    } catch (e) {
      console.error("[Hub-Dienst]", e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fehler: e instanceof Error ? e.message : "Fehler im Dienst." }));
    }
  });
  server.listen(UMGEBUNG.port, () => {
    console.info(`[Hub-Dienst] Version ${UMGEBUNG.version} auf Port ${UMGEBUNG.port}${UMGEBUNG.testmodus ? " (Testmodus mit Copilot-Attrappe)" : ""}; Daten unter ${UMGEBUNG.daten}${UMGEBUNG.statisch ? `; Hub aus ${UMGEBUNG.statisch}` : ""}`);
    if (UMGEBUNG.gitRepo) console.info(hubDatenSchreibbar() ? `[Hub-Dienst] Git-Speicher ${UMGEBUNG.gitRepo}: Apps werden über den Dienst für alle gespeichert` : `[Hub-Dienst] Git-Speicher ${UMGEBUNG.gitRepo}: nur lesen (für Speichern ohne Token im Browser HUB_GIT_TOKEN eintragen)`);
    console.info(diagrammMalerImDienst() ? `[Hub-Dienst] Diagramme in Mail und Teams als Bild (Chromium: ${chromiumPfad()})` : "[Hub-Dienst] Diagramme in Mail und Teams als Quelltext (kein Chromium oder kein ausgelieferter Hub; siehe HUB_CHROMIUM)");
  });
  const ende = () => { console.info("[Hub-Dienst] Beende …"); zeitplan.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on("SIGTERM", ende);
  process.on("SIGINT", ende);
}

void start();
