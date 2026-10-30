/** Die Schnittstelle des Dienstes für den Hub (alles unter /api). */
import type { IncomingMessage, ServerResponse } from "node:http";
import { KeineAnmeldungGespeichert, NichtAngemeldet, anmeldungPruefen, zugangLoeschen, zugangUebernehmen, zugangVorhanden, type Nutzer } from "./anmeldung";
import type { Laeufe } from "./laeufe";
import type { DateiSpeicher } from "./speicher";
import { UMGEBUNG } from "./umgebung";
import type { Zeitplan } from "./zeitplan";
import type { Lernen } from "./lernen";
import { HubDatenFehler, hubDatenAendern, hubDatenSchreibbar, rechteVonNutzer } from "./hubdaten";
import type { Personen } from "./personen";
import type { Laufwerk } from "./laufwerk";
import { istFesterAdmin } from "@/lib/rechte";

export class ApiFehler extends Error { constructor(public status: number, msg: string) { super(msg); } }

export type Dienste = { speicher: DateiSpeicher; laeufe: Laeufe; zeitplan: Zeitplan; lernen: Lernen; personen: Personen; laufwerk: Laufwerk };

/** Verwaltung? Laut rechte.json im Git-Speicher; ohne Git-Speicher nur die fest eingetragene Verwaltung */
async function istVerwaltung(n: Nutzer): Promise<boolean> {
  if (istFesterAdmin(n.email)) return true;
  if (!hubDatenSchreibbar()) return false;
  try { return (await rechteVonNutzer({ id: n.id, name: n.name, email: n.email })).has("admin"); } catch { return false; }
}

export async function api(req: IncomingMessage, res: ServerResponse, pfad: string, query: URLSearchParams, body: unknown, d: Dienste): Promise<void> {
  const json = (status: number, wert: unknown) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(wert)); };
  const methode = req.method ?? "GET";
  try {
    if (pfad === "/dienst" && methode === "GET") {
      return json(200, { dienst: "KI-Hub", version: UMGEBUNG.version, testmodus: UMGEBUNG.testmodus, apiScope: UMGEBUNG.apiScope, clientId: UMGEBUNG.clientId, tenantId: UMGEBUNG.tenantId, hubDaten: hubDatenSchreibbar(), zeit: new Date().toISOString() });
    }
    const { nutzer, token } = await anmeldungPruefen(req.headers.authorization);
    // Jede Anmeldung vermerken, damit die Verwaltung alle Personen sieht (auch aus anderen Browsern)
    await d.personen.vermerken(nutzer).catch((e) => console.warn("[Hub-Dienst] Anmeldung nicht vermerkt:", e));
    /** Zugang der Person hinterlegen bzw. auffrischen (bei allem, was der Dienst später in ihrem Namen tut) */
    const uebernehmen = () => zugangUebernehmen(d.speicher, nutzer, token);
    const eigener = (id: string) => {
      const l = d.laeufe.holen(id);
      if (!l || l.nutzer !== nutzer.id) throw new ApiFehler(404, "Diesen Lauf gibt es nicht.");
      return l;
    };

    if (pfad === "/konto") {
      if (methode === "GET") return json(200, { nutzer: oeffentlich(nutzer), zugang: await zugangVorhanden(d.speicher, nutzer.id) });
      if (methode === "DELETE") { await zugangLoeschen(d.speicher, nutzer.id); return json(200, { ok: true }); }
    }

    if (pfad === "/laeufe") {
      if (methode === "POST") {
        const b = (body ?? {}) as { app?: unknown; aktion?: string; werte?: Record<string, string | boolean>; files?: Record<string, never>; ergebnisse?: Record<string, string>; titel?: string };
        await uebernehmen();
        const l = d.laeufe.anlegen({ nutzer: nutzer.id, app: b.app, aktion: String(b.aktion || "alle"), werte: b.werte ?? {}, files: b.files ?? {}, ergebnisse: b.ergebnisse ?? {}, titel: String(b.titel ?? "") });
        return json(201, { id: l.id, version: l.version });
      }
      if (methode === "GET") {
        const seit = query.get("seit") ? Date.parse(query.get("seit")!) : 0;
        const liste = d.laeufe.von(nutzer.id, { appId: query.get("app") ?? undefined, nurAuftraege: query.get("auftraege") === "1", seit: Number.isFinite(seit) ? seit : 0 });
        return json(200, liste.slice(0, 60).map((l) => d.laeufe.kurz(l)));
      }
    }
    const lauf = /^\/laeufe\/([^/]+)(?:\/(gesehen|eingaben))?$/.exec(pfad);
    if (lauf) {
      const l = eigener(lauf[1]);
      if (methode === "GET" && !lauf[2]) {
        // Nur Neues: der Hub nennt die Version, die er schon hat
        const ab = Number(query.get("ab") ?? 0);
        if (ab && ab >= l.version) return json(200, { id: l.id, version: l.version, status: l.status, unveraendert: true });
        const { app: _a, files: _f, ...rest } = l;
        return json(200, { ...rest, files: Object.fromEntries(Object.entries(l.files).map(([k, f]) => [k, { ...f, text: query.get("mitDateien") === "1" ? f.text : "" }])) });
      }
      if (methode === "GET" && lauf[2] === "eingaben") return json(200, { werte: l.werte, files: l.files, app: l.app });
      if (methode === "POST" && lauf[2] === "gesehen") { d.laeufe.gesehen(l.id); return json(200, { ok: true }); }
      // Laufend: abbrechen; sonst aus dem Dienst löschen (die Person hat ihn aus dem Verlauf entfernt)
      if (methode === "DELETE") { if (l.status === "laeuft") d.laeufe.abbrechen(l.id); else await d.laeufe.loeschen(l.id); return json(200, { ok: true }); }
    }

    if (pfad === "/anmeldung" && methode === "POST") return json(200, { ok: true });
    // Personenliste für Verwaltung und Baukasten (Personenwahl bei „Freigabe“)
    if (pfad === "/personen" && methode === "GET") {
      if (hubDatenSchreibbar()) {
        const r = await rechteVonNutzer({ id: nutzer.id, name: nutzer.name, email: nutzer.email });
        if (!r.has("admin") && !r.has("bauen")) throw new ApiFehler(403, "Die Personenliste sehen nur Verwaltung und Baukasten.");
      }
      return json(200, await d.personen.alle());
    }

    // Netzlaufwerk: Stand und Freigaben (Verwaltung), Ordner zum Auswählen, Suche
    if (pfad.startsWith("/laufwerk")) {
      const lw = d.laufwerk;
      const admin = await istVerwaltung(nutzer);
      if (pfad === "/laufwerk" && methode === "GET") {
        return json(200, { aktiv: lw.aktiv, name: UMGEBUNG.laufwerkName, unc: UMGEBUNG.laufwerkUnc, admin, freigaben: admin ? lw.alleFreigaben() : lw.freigabenFuer(nutzer.email).map((f) => ({ ...f, fuer: [] })), stand: lw.stand });
      }
      if (!lw.aktiv) throw new ApiFehler(404, "Im Hub-Dienst ist kein Netzlaufwerk eingebunden (HUB_LAUFWERK).");
      if (pfad === "/laufwerk/ordner" && methode === "GET") {
        // Verwaltung: ganzes Laufwerk (zum Freigeben); sonst nur innerhalb der eigenen Freigaben
        const p = query.get("pfad") ?? "";
        if (!admin && !lw.freigabenFuer(nutzer.email).some((f) => (p + "/").toLowerCase().startsWith(f.pfad.toLowerCase() + "/") || p.toLowerCase() === f.pfad.toLowerCase())) throw new ApiFehler(403, "Dieser Ordner ist für dich nicht freigegeben.");
        try { return json(200, await lw.ordner(p)); } catch (e) { throw new ApiFehler(404, e instanceof Error && /Ungültig/.test(e.message) ? e.message : "Diesen Ordner gibt es nicht."); }
      }
      if (pfad === "/laufwerk/freigaben" && methode === "PUT") {
        if (!admin) throw new ApiFehler(403, "Freigaben ändert nur die Verwaltung.");
        return json(200, await lw.freigabenSetzen(body));
      }
      if (pfad === "/laufwerk/einlesen" && methode === "POST") {
        if (!admin) throw new ApiFehler(403, "Einlesen startet nur die Verwaltung.");
        void lw.einlesen();
        return json(200, { ok: true });
      }
      if (pfad === "/laufwerk/suche" && methode === "POST") {
        const b = (body ?? {}) as { pfad?: string; frage?: string; breiter?: string; titel?: string };
        const titel = String(b.titel ?? "") || UMGEBUNG.laufwerkName;
        let r = lw.suchen(nutzer.email, String(b.pfad ?? ""), String(b.frage ?? ""), titel);
        if (!r.fehler && !r.text && b.breiter) r = lw.suchen(nutzer.email, String(b.pfad ?? ""), String(b.breiter), titel);
        return json(200, r);
      }
    }

    if (pfad === "/auftraege") {
      if (methode === "GET") return json(200, ohneApps(await d.zeitplan.lesen(nutzer.id)));
      if (methode === "PUT") {
        await uebernehmen();
        return json(200, ohneApps(await d.zeitplan.schreiben(nutzer.id, (body ?? {}) as Record<string, never>)));
      }
    }
    const jetzt = /^\/auftraege\/([^/]+)\/jetzt$/.exec(pfad);
    if (jetzt && methode === "POST") {
      await uebernehmen();
      return json(201, { id: await d.zeitplan.jetzt(nutzer.id, jetzt[1]) });
    }
    // Lernschicht: Rückmeldungen (anonym), Auswertung, Freigabe-Stand der Vorschläge
    // Hub-Daten (Apps, Papierkorb, Agenten, Rechte) im Git-Speicher schreiben, mit dem Token des Dienstes
    const hubDaten = /^\/hub-daten\/(.+)$/.exec(pfad);
    if (hubDaten && (methode === "PUT" || methode === "DELETE")) {
      await hubDatenAendern(nutzer, decodeURIComponent(hubDaten[1]!), methode === "PUT" ? body : undefined);
      return json(200, { ok: true });
    }
    const lernen = /^\/lernen\/([^/]+)(?:\/(rueckmeldungen|auswerten|vorschlaege)|\/vorschlaege\/([^/]+))?$/.exec(pfad);
    if (lernen) {
      const appId = decodeURIComponent(lernen[1]);
      if (!lernen[2] && !lernen[3] && methode === "GET") return json(200, await d.lernen.standVon(appId));
      if (lernen[2] === "rueckmeldungen" && methode === "POST") { await d.lernen.rueckmeldung(appId, body); return json(201, { ok: true }); }
      if (lernen[2] === "auswerten" && methode === "POST") { await uebernehmen(); return json(200, await d.lernen.auswerten(appId, nutzer.id, body)); }
      if (lernen[2] === "vorschlaege" && methode === "POST") return json(201, await d.lernen.einreichen(appId, body));
      if (lernen[3] && methode === "PUT") return json(200, await d.lernen.vorschlag(appId, decodeURIComponent(lernen[3]), (body as { stand?: unknown })?.stand));
    }
    throw new ApiFehler(404, `Unbekannt: ${methode} /api${pfad}`);
  } catch (e) {
    if (e instanceof NichtAngemeldet) return json(401, { fehler: e.message });
    if (e instanceof KeineAnmeldungGespeichert) return json(409, { fehler: e.message });
    if (e instanceof ApiFehler) return json(e.status, { fehler: e.message });
    if (e instanceof HubDatenFehler) return json(e.status, { fehler: e.message });
    console.error("[Hub-Dienst] API:", e);
    return json(500, { fehler: e instanceof Error ? e.message : "Unbekannter Fehler im Dienst." });
  }
}

const oeffentlich = (n: Nutzer) => ({ id: n.id, name: n.name, email: n.email });
const ohneApps = <T extends { apps: unknown }>(s: T) => { const { apps, ...rest } = s; return { ...rest, appIds: Object.keys(apps as object) }; };
