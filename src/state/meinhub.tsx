import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApps } from "./apps";
import { aktuellesKonto } from "@/lib/ki/auth";
import {
  AuftragSchema, LaufSchema, LokalerMeinHubSpeicher, MeinHubSchema, VoreinstellungSchema, ausfuehren, kurz, naechsterLauf, neueId,
  type Auftrag, type Lauf, type MeinHub, type MeinHubSpeicher, type Voreinstellung,
} from "@/lib/meinhub";
import type { App } from "@/lib/schema";
import type { OutState } from "@/lib/runner";

type Ctx = {
  daten: MeinHub;
  geladen: boolean;
  nutzerName: string;
  laufend: Lauf | null;
  istGepinnt: (appId: string) => boolean;
  pinUmschalten: (appId: string) => void;
  vorlagenFuer: (appId: string) => Voreinstellung[];
  vorlageSpeichern: (v: Omit<Voreinstellung, "id" | "erstellt" | "geaendert"> & { id?: string }) => Voreinstellung;
  vorlageLoeschen: (id: string) => void;
  vorlageUmbenennen: (id: string, name: string) => void;
  /** Lauf aus der App-Ansicht im Verlauf ablegen */
  laufAblegen: (app: App, outs: Record<string, OutState>, vorlage: Voreinstellung | null) => void;
  /** Letzter Lauf einer App (aus Aufträgen oder der App-Ansicht) */
  letzterLauf: (appId: string) => Lauf | undefined;
  auftragSpeichern: (a: Omit<Auftrag, "id" | "naechsterLauf" | "letzterLauf" | "erstellt"> & { id?: string }) => Auftrag;
  auftragLoeschen: (id: string) => void;
  auftragAktiv: (id: string, aktiv: boolean) => void;
  /** Auftrag sofort ausführen (in die Warteschlange) */
  jetztAusfuehren: (auftragId: string) => void;
  abbrechen: () => void;
  laufLoeschen: (id: string) => void;
  setAutomatisch: (an: boolean) => void;
};

const C = createContext<Ctx | null>(null);
const speicher: MeinHubSpeicher = new LokalerMeinHubSpeicher();
const PRUEFEN_MS = 30_000;

export function MeinHubProvider({ children }: { children: ReactNode }) {
  const { find, geladen: appsGeladen } = useApps();
  const [daten, setDaten] = useState<MeinHub>(() => MeinHubSchema.parse({}));
  const [geladen, setGeladen] = useState(false);
  const [nutzerName, setNutzerName] = useState("Testnutzer");
  const [laufend, setLaufend] = useState<Lauf | null>(null);
  const datenRef = useRef(daten);
  datenRef.current = daten;
  const schlange = useRef<string[]>([]);
  const ctl = useRef<AbortController | null>(null);

  // Nutzer: mit Anmeldung aus Entra ID, bis dahin ein lokaler Testnutzer je Browser.
  useEffect(() => {
    void (async () => {
      let id = "lokal";
      try {
        const k = await aktuellesKonto();
        if (k) { id = k.homeAccountId || k.localAccountId; setNutzerName(k.name || k.username); }
      } catch { /* ohne Anmeldung */ }
      setDaten(await speicher.laden(id));
      setGeladen(true);
    })();
  }, []);

  // Speichern gebündelt (höchstens alle 800 ms), damit häufige Zwischenstände den Browser nicht ausbremsen.
  const speicherTimer = useRef<number | null>(null);
  const sichern = useCallback((d: MeinHub) => {
    if (speicherTimer.current) window.clearTimeout(speicherTimer.current);
    speicherTimer.current = window.setTimeout(() => {
      speicherTimer.current = null;
      void speicher.speichern(d).catch(() => toast.error("Mein Hub konnte nicht gespeichert werden. Der Speicher des Browsers ist voll."));
    }, 800);
  }, []);
  useEffect(() => {
    // Beim Schließen des Fensters den letzten Stand sofort schreiben.
    const h = () => { if (speicherTimer.current) { window.clearTimeout(speicherTimer.current); void speicher.speichern(datenRef.current); } };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, []);
  const aendern = useCallback((mut: (d: MeinHub) => void) => {
    setDaten((alt) => {
      const neu = structuredClone(alt);
      mut(neu);
      datenRef.current = neu;
      sichern(neu);
      return neu;
    });
  }, [sichern]);

  /* ---------- Ausführung: eine Warteschlange, immer nur ein Lauf gleichzeitig ---------- */
  const abarbeiten = useCallback(async () => {
    if (ctl.current) return;
    while (schlange.current.length) {
      const id = schlange.current.shift()!;
      const a = datenRef.current.auftraege.find((x) => x.id === id);
      if (!a) continue;
      const app = find(a.appId);
      const vorlage = a.voreinstellungId ? datenRef.current.voreinstellungen.find((v) => v.id === a.voreinstellungId) ?? null : null;
      const jetzt = new Date();
      // Nächsten Termin sofort setzen, damit ein Auftrag nicht doppelt startet.
      aendern((d) => { const x = d.auftraege.find((y) => y.id === id); if (x) { x.letzterLauf = jetzt.toISOString(); x.naechsterLauf = naechsterLauf(x.zeitplan, jetzt).toISOString(); } });
      let lauf: Lauf;
      if (!app || app.typ === "link") {
        lauf = { id: neueId("l"), auftragId: a.id, appId: a.appId, appName: app?.name ?? "", titel: a.name, voreinstellungId: a.voreinstellungId, start: jetzt.toISOString(), ende: jetzt.toISOString(), status: "fehler", meldung: "Die Applikation gibt es nicht mehr.", ergebnisse: {} };
      } else {
        const c = new AbortController();
        ctl.current = c;
        // Zwischenstände laufend im Verlauf speichern: Wird der Browser geschlossen, bleiben fertige Schritte erhalten.
        lauf = await ausfuehren({ app, vorlage, auftrag: a, signal: c.signal, onUpdate: (l) => {
          setLaufend(l);
          aendern((d) => { d.laeufe = [l, ...d.laeufe.filter((x) => x.id !== l.id)]; });
        } });
        ctl.current = null;
        setLaufend(null);
      }
      const fertig = lauf;
      aendern((d) => { d.laeufe = [fertig, ...d.laeufe.filter((x) => x.id !== fertig.id)]; });
      if (lauf.status === "fertig") toast.success(`Auftrag „${a.name}“ ist fertig. Das Ergebnis liegt im Verlauf von Mein Hub.`);
      else if (lauf.status === "fehler") toast.error(`Auftrag „${a.name}“: ${lauf.meldung}`);
    }
  }, [aendern, find]);

  const einreihen = useCallback((id: string) => {
    if (!schlange.current.includes(id)) schlange.current.push(id);
    void abarbeiten();
  }, [abarbeiten]);

  // Fällige Aufträge prüfen: beim Öffnen (verpasste Termine laufen einmal nach) und danach regelmäßig.
  useEffect(() => {
    if (!geladen || !appsGeladen) return;
    const pruefen = () => {
      const d = datenRef.current;
      if (!d.automatisch) return;
      const jetzt = Date.now();
      d.auftraege.filter((a) => a.aktiv && a.naechsterLauf && Date.parse(a.naechsterLauf) <= jetzt).forEach((a) => einreihen(a.id));
    };
    pruefen();
    const t = window.setInterval(pruefen, PRUEFEN_MS);
    return () => window.clearInterval(t);
  }, [geladen, appsGeladen, einreihen]);

  const wert = useMemo<Ctx>(() => ({
    daten, geladen, nutzerName, laufend,
    istGepinnt: (appId) => daten.pins.some((p) => p.appId === appId),
    pinUmschalten: (appId) => aendern((d) => {
      d.pins = d.pins.some((p) => p.appId === appId) ? d.pins.filter((p) => p.appId !== appId) : [...d.pins, { appId, seit: new Date().toISOString() }];
    }),
    vorlagenFuer: (appId) => daten.voreinstellungen.filter((v) => v.appId === appId),
    vorlageSpeichern: (v) => {
      const jetzt = new Date().toISOString();
      const alt = v.id ? daten.voreinstellungen.find((x) => x.id === v.id) : undefined;
      const neu = VoreinstellungSchema.parse({ ...v, id: v.id ?? neueId("v"), erstellt: alt?.erstellt ?? jetzt, geaendert: jetzt });
      aendern((d) => {
        d.voreinstellungen = [...d.voreinstellungen.filter((x) => x.id !== neu.id), neu];
        if (!d.pins.some((p) => p.appId === neu.appId)) d.pins.push({ appId: neu.appId, seit: jetzt });
      });
      return neu;
    },
    vorlageUmbenennen: (id, name) => aendern((d) => {
      const v = d.voreinstellungen.find((x) => x.id === id);
      if (v && name.trim()) { v.name = name.trim().slice(0, 80); v.geaendert = new Date().toISOString(); }
    }),
    laufAblegen: (app, outs, vorlage) => {
      const jetzt = new Date().toISOString();
      const l = LaufSchema.parse({
        id: neueId("l"), auftragId: null, appId: app.id ?? "", appName: app.name, titel: vorlage ? `${app.name}: ${vorlage.name}` : app.name,
        voreinstellungId: vorlage?.id ?? null, start: jetzt, ende: jetzt,
        status: Object.values(outs).some((o) => o.status === "fehler") ? "fehler" : Object.values(outs).some((o) => o.status === "gestoppt") ? "abgebrochen" : "fertig",
        ergebnisse: kurz(outs, app),
      });
      aendern((d) => { d.laeufe = [l, ...d.laeufe]; });
    },
    letzterLauf: (appId) => daten.laeufe.find((l) => l.appId === appId && l.status !== "laeuft"),
    vorlageLoeschen: (id) => aendern((d) => {
      d.voreinstellungen = d.voreinstellungen.filter((v) => v.id !== id);
      d.auftraege.forEach((a) => { if (a.voreinstellungId === id) { a.voreinstellungId = null; a.aktiv = false; } });
    }),
    auftragSpeichern: (a) => {
      const jetzt = new Date();
      const alt = a.id ? daten.auftraege.find((x) => x.id === a.id) : undefined;
      const neu = AuftragSchema.parse({ ...a, id: a.id ?? neueId("a"), erstellt: alt?.erstellt ?? jetzt.toISOString(), letzterLauf: alt?.letzterLauf ?? "", naechsterLauf: naechsterLauf(a.zeitplan, jetzt).toISOString() });
      aendern((d) => {
        d.auftraege = [...d.auftraege.filter((x) => x.id !== neu.id), neu];
        if (!d.pins.some((p) => p.appId === neu.appId)) d.pins.push({ appId: neu.appId, seit: jetzt.toISOString() });
      });
      return neu;
    },
    auftragLoeschen: (id) => aendern((d) => { d.auftraege = d.auftraege.filter((a) => a.id !== id); }),
    auftragAktiv: (id, aktiv) => aendern((d) => {
      const a = d.auftraege.find((x) => x.id === id);
      if (a) { a.aktiv = aktiv; if (aktiv) a.naechsterLauf = naechsterLauf(a.zeitplan).toISOString(); }
    }),
    jetztAusfuehren: (id) => einreihen(id),
    abbrechen: () => { schlange.current = []; ctl.current?.abort(); },
    laufLoeschen: (id) => aendern((d) => { d.laeufe = d.laeufe.filter((l) => l.id !== id); }),
    setAutomatisch: (an) => aendern((d) => { d.automatisch = an; }),
  }), [daten, geladen, nutzerName, laufend, aendern, einreihen]);

  return <C.Provider value={wert}>{children}</C.Provider>;
}

export function useMeinHub(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useMeinHub außerhalb von MeinHubProvider");
  return c;
}
