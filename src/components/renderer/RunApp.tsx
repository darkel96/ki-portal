import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useBlocker } from "react-router";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { isFieldType, type App, type Block, type Step } from "@/lib/schema";
import { fieldsOf, seiteMit, seitenTitel, seitenVon, stepsFor, walk } from "@/lib/model";
import { Blatt, Pager, blaetterTaste } from "@/components/layout/Pager";
import { readFileInfo, UnsupportedFormatError } from "@/lib/files";
import { STATUS_LABEL, abhaengigkeiten, ablaufStarten, fehlendePflichtfelder, fehlendeVorstufe, type OutState, type Werte } from "@/lib/runner";
import type { FileInfo } from "@/lib/request";
import { BlockContent, type RenderList } from "./BlockContent";
import { OutputView } from "./OutputView";
import { RunContext, type RunCtx } from "./runContext";
import { vorbelegungen } from "@/lib/vorbelegung";
import { themeStyle } from "./theme";

export type RunAppHandle = {
  beispieleEinsetzen: () => void;
  /** Aktuelle Eingaben (für Voreinstellungen) */
  stand: () => { werte: Werte; dateien: Record<string, FileInfo> };
  /** Eingaben einer Voreinstellung übernehmen */
  setzen: (werte: Werte, dateien: Record<string, FileInfo>) => void;
};

const KURZ = new Set(["input", "select", "number", "date"]);
const artVon = (b: Block) => (b.type === "textarea" ? "lang" : KURZ.has(b.type) ? "kurz" : null);
/** Aufeinanderfolgende Eingaben gleicher Art nebeneinander setzen (höchstens drei), damit die Seitenbreite genutzt wird. Auswahlkästchen, Optionen und Dateien stehen allein. */
function inReihen(blocks: Block[], render: (b: Block) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length;) {
    const art = artVon(blocks[i]);
    let j = i + 1;
    if (art) while (j < blocks.length && j - i < 3 && artVon(blocks[j]) === art) j++;
    if (j - i > 1) out.push(<div key={`r-${blocks[i].id}`} className="o-reihe" data-art={art ?? ""} data-n={j - i}>{blocks.slice(i, j).map(render)}</div>);
    else out.push(render(blocks[i]));
    i = j;
  }
  return out;
}


/** Eine Seite, die nur Ergebnisse zeigt (keine Eingaben, keine KI-Buttons), erscheint als Kachel in der Ergebnisübersicht. */
function istErgebnisSeite(p: Block): boolean {
  let ausgabe = false, eingabe = false;
  walk(p.children ?? [], (b) => { if (b.type === "output") ausgabe = true; if (isFieldType(b.type) || b.type === "button") eingabe = true; });
  return ausgabe && !eingabe;
}

/** Fokussierbares Element eines Feldes (bei Dateien der sichtbare Knopf, nicht das versteckte native Feld) */
const feldZiel = (key: string) => `[data-key="${key}"] :is(input:not([type="file"]), textarea, select, .o-file-btn)`;

type Kachel = { id: string; titel: string; seite?: Block; stepIds: string[] };
const FERTIG = new Set<OutState["status"]>(["fertig", "simuliert", "uebersprungen", "fehler", "gestoppt"]);

/** Status einer Kachel aus den Zuständen ihrer Schritte */
function kachelStatus(k: Kachel, outs: Record<string, OutState>): OutState["status"] {
  const st = k.stepIds.map((id) => outs[id]?.status ?? "wartet");
  for (const s of ["laeuft", "fehler", "gestoppt"] as const) if (st.includes(s)) return s;
  if (st.every((s) => s === "uebersprungen")) return "uebersprungen";
  if (st.some((s) => s === "simuliert")) return "simuliert";
  return st.every((s) => FERTIG.has(s)) ? "fertig" : "wartet";
}

/** Kurzer Vorschautext ohne Markdown-Zeichen */
function vorschau(k: Kachel, outs: Record<string, OutState>, laeuft: boolean, app: App): string {
  for (const id of k.stepIds) {
    const o = outs[id];
    if (!o) continue;
    if (o.status === "laeuft") return "Wird erstellt\u00a0…";
    if (o.status === "simuliert") return "Simulation: Die Anfrage ist vorbereitet, es gibt keine KI-Antwort.";
    if ((o.status === "uebersprungen" || o.status === "fehler") && o.meldung) return o.meldung;
    if (o.paket) return `${o.paket.dateien.length} ${o.paket.dateien.length === 1 ? "Datei" : "Dateien"}${o.paket.hinweis ? `: ${o.paket.hinweis}` : ""}`;
    if (o.text) return o.text.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/(^|\s)[-•]\s+/g, " ").replace(/[#*_`>|]+/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
    if (o.status === "gestoppt") return "Gestoppt, bevor ein Ergebnis da war.";
    if (o.status === "fehler") return "Abgebrochen. Öffnen und „Erneut versuchen“.";
    if (o.status === "wartet") {
      if (!laeuft) return "Nicht gestartet, weil der Ablauf vorher gestoppt wurde oder abgebrochen ist.";
      // Schritte ohne Abhängigkeit laufen gleichzeitig; wer wartet, wartet auf ein Ergebnis, das er im Prompt nutzt
      const st = app.steps.find((s) => s.id === id);
      const auf = st ? abhaengigkeiten(st, app.steps).filter((d) => outs[d.id]?.status !== "fertig").map((d) => d.name) : [];
      return auf.length ? `Wartet auf „${auf.join("“, „")}“\u00a0…` : "Wartet\u00a0…";
    }
  }
  return "Wird erstellt, sobald du „Ergebnisse erstellen“ startest.";
}

function Uebersicht({ app, kacheln, outs, laeuft, geaendert, onStart, onOeffnen }: {
  app: App; kacheln: Kachel[]; outs: Record<string, OutState>; laeuft: boolean; geaendert: boolean;
  onStart: () => void; onOeffnen: (id: string) => void;
}) {
  const stati = kacheln.map((k) => kachelStatus(k, outs));
  const fertig = stati.filter((s) => s === "fertig" || s === "simuliert").length;
  const mitFehler = stati.filter((s) => s === "fehler").length;
  const gestartet = stati.some((s) => s !== "wartet");
  return (
    <div className="e-uebersicht">
      <div className="e-kopf">
        <h2 className="o-h o-h2">Ergebnisse</h2>
        <span className="e-stand" aria-live="polite">{laeuft ? `${fertig} von ${kacheln.length} fertig, der Ablauf läuft\u00a0…` : gestartet ? `${fertig} von ${kacheln.length} fertig${mitFehler ? `, ${mitFehler} mit Fehler` : ""}` : "Noch nicht erstellt"}</span>
        <span className="flex-1" />
        {geaendert && !laeuft && gestartet && <span className="e-hinweis">Die Eingaben wurden seitdem geändert.</span>}
        <button type="button" className={`o-btn ${gestartet && !laeuft ? "outline" : ""}`} style={{ "--btn": "var(--signal)", "--btn-ink": "var(--signal-ink)" } as CSSProperties} onClick={onStart}>
          {laeuft ? "Stoppen" : gestartet ? "Neu erstellen" : "Ergebnisse erstellen"}
        </button>
      </div>
      <ul className="e-kacheln">
        {kacheln.map((k, i) => (
          <li key={k.id}>
            <button type="button" className="e-kachel" data-s={stati[i]} onClick={() => onOeffnen(k.id)} aria-labelledby={`et-${k.id}`} aria-describedby={`es-${k.id}`}>
              <span className="e-kachel-kopf"><span className="e-titel" id={`et-${k.id}`}>{k.titel}</span><span className="status-pill" id={`es-${k.id}`} data-s={stati[i]}>{STATUS_LABEL[stati[i]]}</span></span>
              <span className="e-text" aria-hidden="true">{vorschau(k, outs, laeuft, app)}</span>
              <span className="e-oeffnen">Öffnen</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Prüfseite: Stand des Schritts, der die Felder dieser Seite ausfüllt (läuft, fehlgeschlagen, noch nicht gestartet). */
function VorbelegungStand({ schritte, outs, laeuft, onStart }: { schritte: Step[]; outs: Record<string, OutState>; laeuft: boolean; onStart: (st: Step) => void }) {
  if (!schritte.length) return null;
  const zeilen = schritte.map((st) => ({ st, o: outs[st.id] })).filter(({ o }) => !o || o.status === "laeuft" || o.status === "wartet" || o.status === "fehler" || o.status === "gestoppt" || o.status === "simuliert");
  if (!zeilen.length) return null;
  return (
    <div className="o-stack" role="status" aria-live="polite">
      {zeilen.map(({ st, o }) => {
        if (!o || o.status === "gestoppt") return (
          <div key={st.id} className="o-vorbelegung">
            <span>Die Felder werden ausgefüllt, sobald „{st.name}“ gelaufen ist.</span>
            <button type="button" className="o-btn outline" disabled={laeuft} onClick={() => onStart(st)}>{st.name} starten</button>
          </div>
        );
        if (o.status === "fehler") return (
          <div key={st.id} className="o-vorbelegung" data-art="fehler">
            <span>„{st.name}“ ist fehlgeschlagen{o.meldung ? `: ${o.meldung}` : "."} Die Felder kannst du trotzdem von Hand ausfüllen.</span>
            <button type="button" className="o-btn outline" disabled={laeuft} onClick={() => onStart(st)}>Erneut versuchen</button>
          </div>
        );
        if (o.status === "simuliert") return <div key={st.id} className="o-vorbelegung"><span>Simulation: Ohne KI-Anbindung bleiben die Felder leer. Bitte von Hand ausfüllen.</span></div>;
        return <div key={st.id} className="o-vorbelegung"><span>„{st.name}“ läuft, die Felder werden gleich ausgefüllt\u00a0…</span></div>;
      })}
    </div>
  );
}

/** Applikation im Modus „run“: Eingaben aktiv, KI-Buttons starten den Ablauf. */
/**
 * Verlassen-Schutz als eigene Komponente: Der Router kennt nur den zuletzt registrierten Blocker. Eine
 * eingebettete Vorschau (Baukasten, Neue Applikation) darf deshalb keinen anlegen, sonst gilt der der Seite nicht mehr.
 */
function VerlassenSchutz({ ungesichert, laeuft, blatt, onVerlassen }: { ungesichert: boolean; laeuft: boolean; blatt: React.RefObject<HTMLDivElement | null>; onVerlassen: () => void }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => ungesichert && currentLocation.pathname !== nextLocation.pathname);
  /** Element, das den Verlassen-Dialog ausgelöst hat (bekommt nach „Hierbleiben“/Escape den Fokus zurück) */
  const ausloeser = useRef<HTMLElement | null>(null);
  useEffect(() => { if (blocker.state === "blocked") ausloeser.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; }, [blocker.state]);
  useEffect(() => {
    if (!ungesichert) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [ungesichert]);
  return (
    <AlertDialog open={blocker.state === "blocked"} onOpenChange={(o) => { if (!o) blocker.reset?.(); }}>
      <AlertDialogContent onCloseAutoFocus={(e) => { e.preventDefault(); (ausloeser.current?.isConnected ? ausloeser.current : blatt.current)?.focus({ preventScroll: true }); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{laeuft ? "Der Ablauf läuft noch" : "Eingaben verwerfen?"}</AlertDialogTitle>
          <AlertDialogDescription>{laeuft ? "Wenn du die Seite verlässt, wird der Ablauf abgebrochen und die Ergebnisse gehen verloren." : "Deine Eingaben sind noch nicht ausgeführt und gehen verloren. Tipp: Über „Voreinstellungen“ kannst du sie speichern."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Hierbleiben</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onVerlassen(); blocker.proceed?.(); }}>{laeuft ? "Abbrechen und verlassen" : "Verwerfen und verlassen"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const RunApp = forwardRef<RunAppHandle, {
  app: App;
  /** Wird nach jedem Ablauf mit den Ergebnissen der gelaufenen Schritte aufgerufen (z. B. für den Verlauf in Mein Hub) */
  onLaufFertig?: (outs: Record<string, OutState>) => void;
  /** Als Vorschau in einer anderen Seite eingebettet: kein eigener Verlassen-Schutz (die Seite hat ihren eigenen) */
  eingebettet?: boolean;
}>(function RunApp({ app, onLaufFertig, eingebettet }, ref) {
  const [werte, setWerte] = useState<Werte>({});
  const [files, setFiles] = useState<Record<string, FileInfo>>({});
  const [dateiInfo, setDateiInfo] = useState<Record<string, string>>({});
  /** Dateien, die gerade gelesen werden bzw. nicht gelesen werden konnten */
  const [liest, setLiest] = useState<Set<string>>(new Set());
  const [dateiFehler, setDateiFehler] = useState<Set<string>>(new Set());
  const [fehler, setFehler] = useState<Set<string>>(new Set());
  const [outs, setOuts] = useState<Record<string, OutState>>({});
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const ergebnisse = useRef<Record<string, string>>({});
  const ctl = useRef<AbortController | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const blatt = useRef<HTMLDivElement>(null);
  /** Stand der Eingaben beim letzten Start (für den Hinweis „Eingaben geändert“) */
  const [stand, setStand] = useState("");
  /** Zuletzt aus einem KI-Ergebnis vorbelegte Werte je Feld: Nur Felder, die die Person seitdem nicht geändert hat, werden erneut überschrieben */
  const vorbelegt = useRef<Record<string, string | boolean>>({});
  /** Hinweise der KI zu vorbelegten Feldern („zu klären“, Fundstelle); die Markierung verschwindet, sobald die Person das Feld setzt */
  const [hinweise, setHinweise] = useState<Record<string, { hinweis?: string; klaeren?: boolean }>>({});
  const vorbelegen = useCallback((stepKey: string, text: string) => {
    const neu = vorbelegungen(app, stepKey, text);
    if (!neu) return;
    setWerte((w) => {
      const next = { ...w };
      for (const [k, v] of Object.entries(neu)) {
        const alt = w[k];
        const unveraendert = alt === undefined || alt === "" || alt === false || alt === vorbelegt.current[k];
        if (unveraendert) { next[k] = v.wert; vorbelegt.current[k] = v.wert; }
      }
      return next;
    });
    setHinweise((h) => ({ ...h, ...Object.fromEntries(Object.entries(neu).map(([k, v]) => [k, { hinweis: v.hinweis, klaeren: v.klaeren }])) }));
    setFehler((f) => { if (!f.size) return f; const n = new Set(f); Object.keys(neu).forEach((k) => n.delete(k)); return n; });
  }, [app]);

  // Seiten aufteilen: Eingabeseiten werden geblättert, reine Ergebnisseiten erscheinen als Kacheln in der Übersicht.
  const seiten = useMemo(() => seitenVon(app), [app]);
  const eingabeSeiten = useMemo(() => seiten.filter((p) => !istErgebnisSeite(p)), [seiten]);
  const kacheln = useMemo<Kachel[]>(() => {
    const mitElement = new Set<string>();
    walk(app.blocks, (b) => { if (b.type === "output") mitElement.add(b.props.quelle); });
    const ausSeiten = seiten.filter(istErgebnisSeite).map((p) => {
      const ids: string[] = [];
      walk(p.children ?? [], (b) => { if (b.type === "output" && b.props.quelle) ids.push(b.props.quelle); });
      return { id: p.id, titel: seitenTitel(p, seiten.indexOf(p)), seite: p, stepIds: ids };
    });
    // Schritte, deren Ergebnis nur Felder vorbelegt (Prüfseite), brauchen keine Kachel: ihr Ergebnis sind die Felder
    const nurVorbelegung = new Set(fieldsOf(app).map((b) => b.props.aus.trim().split(".")[0].toLowerCase()).filter(Boolean));
    const ohneElement = app.steps.filter((s) => !mitElement.has(s.id) && !nurVorbelegung.has(s.key.toLowerCase())).map((s) => ({ id: `schritt:${s.id}`, titel: s.name, stepIds: [s.id] }));
    return [...ausSeiten, ...ohneElement].filter((k) => k.stepIds.length);
  }, [app, seiten]);
  const mitUebersicht = kacheln.length > 0;
  /**
   * Was „Ergebnisse erstellen“ in der Übersicht startet: alle Schritte, außer die App hat eine Prüfseite (vorbelegte
   * Felder) oder Buttons für einzelne Schritte. Dann nur die Schritte der Kacheln, sonst würden geprüfte Werte überschrieben.
   */
  const uebersichtAktion = useMemo(() => {
    let einzeln = false;
    walk(app.blocks, (b) => { if (b.type === "button" && b.props.aktion !== "alle" && !b.props.aktion.startsWith("ab:")) einzeln = true; });
    const pruefseite = fieldsOf(app).some((b) => b.props.aus.trim());
    if (!einzeln && !pruefseite) return "alle";
    const ids = new Set(kacheln.flatMap((k) => k.stepIds));
    return app.steps.filter((s) => ids.has(s.id)).map((s) => s.id).join(",") || "alle";
  }, [app, kacheln]);
  const anzahl = eingabeSeiten.length + (mitUebersicht ? 1 : 0);
  const uebersichtIdx = eingabeSeiten.length;

  const [seite, setSeite] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const akt = Math.min(seite, Math.max(0, anzahl - 1));
  const imUeberblick = mitUebersicht && akt === uebersichtIdx && !detail;
  const offen = detail ? kacheln.find((k) => k.id === detail) ?? null : null;
  const p = !detail && !imUeberblick ? eingabeSeiten[akt] : undefined;
  const ansicht = offen ? `e:${offen.id}` : imUeberblick ? "uebersicht" : p?.id ?? String(akt);

  /** Nach einem Wechsel: dieses Feld fokussieren, sonst den Seitenanfang. */
  const fokusNach = useRef<string | null>(null);
  const gewechselt = useRef(false);
  const wechseln = useCallback((i: number, fokusKey?: string) => {
    fokusNach.current = fokusKey ?? null;
    gewechselt.current = true;
    setDetail(null);
    setSeite(Math.max(0, Math.min(i, anzahl - 1)));
  }, [anzahl]);
  const oeffnen = useCallback((id: string | null) => { gewechselt.current = true; setDetail(id); }, []);

  useEffect(() => {
    if (!gewechselt.current) return;
    gewechselt.current = false;
    const k = fokusNach.current;
    fokusNach.current = null;
    const ziel = k ? frame.current?.querySelector<HTMLElement>(feldZiel(k)) : null;
    if (ziel) { ziel.focus({ preventScroll: true }); ziel.scrollIntoView({ block: "center" }); }
    else blatt.current?.focus({ preventScroll: true });
  }, [ansicht]);

  useImperativeHandle(ref, () => ({
    beispieleEinsetzen() {
      const next: Werte = {};
      walk(app.blocks, (b) => {
        if (b.type === "file" || !("beispiel" in b.props) || !b.props.beispiel) return;
        next[b.props.key] = b.type === "checkbox" ? /^(ja|true|1|x)$/i.test(b.props.beispiel) : b.props.beispiel;
      });
      setWerte((w) => ({ ...w, ...next }));
      setFehler(new Set());
    },
    stand: () => ({ werte, dateien: files }),
    setzen(w, d) {
      setWerte(w);
      setFiles(d);
      setDateiInfo(Object.fromEntries(Object.entries(d).map(([k, f]) => [k, `${f.name} aus der Voreinstellung (${f.text.length.toLocaleString("de-DE")} Zeichen)`])));
      setFehler(new Set());
    },
  }), [app.blocks, werte, files]);

  const setDatei = useCallback(async (key: string, f: File | null) => {
    const mit = (set: Set<string>, an: boolean) => { const n = new Set(set); if (an) n.add(key); else n.delete(key); return n; };
    setDateiFehler((x) => mit(x, false));
    if (!f) { setFiles(({ [key]: _, ...rest }) => rest); setDateiInfo((d) => ({ ...d, [key]: "" })); return; }
    setDateiInfo((d) => ({ ...d, [key]: `${f.name} wird gelesen\u00a0…` }));
    setLiest((x) => mit(x, true));
    try {
      const info = await readFileInfo(f);
      setFiles((x) => ({ ...x, [key]: info }));
      setFehler((x) => mit(x, false));
      setDateiInfo((d) => ({ ...d, [key]: info.text.trim() ? `${f.name} gelesen (${info.text.length.toLocaleString("de-DE")} Zeichen${info.text.length >= 60000 ? ", gekürzt" : ""})` : `${f.name} enthält keinen lesbaren Text, zum Beispiel ein eingescanntes PDF.` }));
    } catch (e) {
      setFiles(({ [key]: _, ...rest }) => rest);
      setDateiFehler((x) => mit(x, true));
      setDateiInfo((d) => ({ ...d, [key]: e instanceof UnsupportedFormatError ? "Dieses Format kann nicht gelesen werden. Speichere die Datei als .docx, .xlsx, .pdf, .csv oder .txt." : "Die Datei konnte nicht gelesen werden. Versuch es noch einmal oder wähl eine andere Datei." }));
    } finally {
      setLiest((x) => mit(x, false));
    }
  }, []);

  /** Lineare Position (Eingabeseite) der Seite, die einen passenden Baustein enthält; -1 = keine Eingabeseite */
  const eingabeIdxMit = useCallback((pred: (b: Block) => boolean) => {
    const s = seiteMit(app, pred);
    return s >= 0 ? eingabeSeiten.indexOf(seiten[s]) : -1;
  }, [app, eingabeSeiten, seiten]);

  const starten = useCallback(async (buttonId: string, aktion: string, bleiben = false) => {
    if (ctl.current) { ctl.current.abort(); return; }
    const steps = stepsFor(app, aktion);
    if (!steps.length) return;
    if (liest.size) { toast.info("Die Datei wird noch gelesen. Einen Moment, dann noch einmal starten."); return; }
    const fehlend = fehlendePflichtfelder(app, steps, werte, files);
    setFehler(new Set(fehlend));
    if (fehlend.length) {
      const i = eingabeIdxMit((b) => "key" in b.props && b.props.key === fehlend[0]);
      if (i >= 0 && (i !== akt || detail || imUeberblick)) wechseln(i, fehlend[0]);
      else frame.current?.querySelector<HTMLElement>(feldZiel(fehlend[0]))?.focus();
      const namen = fieldsOf(app).filter((f) => fehlend.includes(f.props.key)).map((f) => f.props.label);
      toast.error(`Bitte ausfüllen: ${namen.join(", ")}.`);
      return;
    }
    const vor = fehlendeVorstufe(app, steps, ergebnisse.current);
    if (vor) {
      // Den Button nennen und zeigen, der die fehlende Vorstufe startet; Schrittnamen sieht man in der App nicht
      let knopf: Extract<Block, { type: "button" }> | undefined;
      walk(app.blocks, (b) => { if (!knopf && b.type === "button" && stepsFor(app, b.props.aktion).includes(vor.fehlt)) knopf = b; });
      const wie = knopf ? `Starte zuerst „${knopf.props.text}“.` : `Starte zuerst „${vor.fehlt.name}“.`;
      setOuts((o) => ({ ...o, [vor.step.id]: { status: "fehler", meldung: `Dafür fehlt noch ein Ergebnis. ${wie}` } }));
      toast.error(`Dafür fehlt noch ein Ergebnis. ${wie}`);
      if (knopf) { const i = eingabeIdxMit((b) => b.id === knopf!.id); if (i >= 0 && (i !== akt || detail || imUeberblick)) wechseln(i); }
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setLaeuft(buttonId);
    setStand(JSON.stringify(werte) + Object.keys(files).join("|"));
    // Wohin? Steht das Ergebnis des ersten Schritts auf einer Eingabeseite, dorthin; sonst in die Ergebnisübersicht.
    const inline = eingabeIdxMit((b) => b.type === "output" && b.props.quelle === steps[0].id);
    // Prüfseite: Füllt der erste Schritt Felder einer Seite vor, dorthin (die Person korrigiert dort, während es läuft)
    const pruef = eingabeIdxMit((b) => isFieldType(b.type) && "aus" in b.props && b.props.aus.trim().split(".")[0].toLowerCase() === steps[0].key.toLowerCase());
    if (bleiben) { /* Start im Hintergrund, z. B. Lese-Schritt beim Wechsel auf die Prüfseite: Ansicht bleibt */ }
    else if (pruef >= 0) { if (pruef !== akt || detail || imUeberblick) wechseln(pruef); }
    else if (inline >= 0) {
      if (inline !== akt || detail) wechseln(inline);
      // Ergebnis ins Bild holen, falls es unterhalb der Eingaben steht
      else requestAnimationFrame(() => frame.current?.querySelector(`[data-src="${steps[0].id}"]`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    }
    else if (mitUebersicht && !imUeberblick && !detail) wechseln(uebersichtIdx);
    // Alte Ergebnisse der gestarteten Schritte zurücksetzen, sonst steht „Fertig“ mit altem Text neben dem laufenden Schritt
    setOuts((o) => ({ ...o, ...Object.fromEntries(steps.map((s) => [s.id, { status: "wartet" as const }])) }));
    const gelaufen: Record<string, OutState> = {};
    try {
      ergebnisse.current = await ablaufStarten({
        app, aktion, werte, files, ergebnisse: ergebnisse.current, signal: c.signal,
        setOut: (id, s) => {
          const vorher = gelaufen[id];
          gelaufen[id] = typeof s === "function" ? s(gelaufen[id]) : s;
          setOuts((o) => ({ ...o, [id]: typeof s === "function" ? s(o[id]) : s }));
          // Prüfseite: Sobald ein JSON-Schritt fertig ist, die daran hängenden Felder vorbelegen
          const st = gelaufen[id];
          if (st.status === "fertig" && vorher?.status !== "fertig" && st.text) {
            const step = app.steps.find((x) => x.id === id);
            if (step?.format === "json") vorbelegen(step.key, st.text);
          }
        },
      });
    } finally {
      ctl.current = null;
      setLaeuft(null);
      if (Object.keys(gelaufen).length) onLaufFertig?.(gelaufen);
    }
  }, [onLaufFertig, app, werte, files, liest, akt, detail, imUeberblick, mitUebersicht, uebersichtIdx, wechseln, eingabeIdxMit, vorbelegen]);

  const nochNichtGelaufen = stepsFor(app, uebersichtAktion).every((s) => !outs[s.id]);
  /** „Weiter“ in die Übersicht startet den Ablauf automatisch (einmal); Punkte und Bild-Tasten blättern nur. */
  const weiterKlick = (i: number) => {
    if (mitUebersicht && i === uebersichtIdx && nochNichtGelaufen && !laeuft && app.steps.length) { void starten("uebersicht", uebersichtAktion); return; }
    // Prüfseite: Braucht die nächste Seite ein KI-Ergebnis, das noch nicht da ist, startet der Lese-Schritt mit
    const fehlt = eingabeSeiten[i] ? vorbelegungsSchritte(eingabeSeiten[i]).filter((st) => !outs[st.id] && !laeuft) : [];
    if (fehlt.length) void starten(`vorbelegen:${fehlt[0].id}`, fehlt.map((st) => st.id).join(","), true);
    wechseln(i);
  };
  /** Schritte, aus deren JSON-Ergebnis Felder dieser Seite vorbelegt werden */
  const vorbelegungsSchritte = useCallback((seite: Block): Step[] => {
    const keys = new Set<string>();
    walk(seite.children ?? [], (b) => { if (isFieldType(b.type) && "aus" in b.props && b.props.aus.trim()) keys.add(b.props.aus.trim().split(".")[0].toLowerCase()); });
    return app.steps.filter((st) => keys.has(st.key.toLowerCase()));
  }, [app.steps]);

  const ebenen = useMemo(() => {
    const out: Record<string, number> = {};
    let letzte = 0;
    walk(app.blocks, (b) => { if (b.type === "heading") { const e = Math.max(1, Math.min(b.props.level, letzte + 1)); out[b.id] = e; letzte = e; } });
    return out;
  }, [app.blocks]);

  const ctx: RunCtx = {
    werte,
    setWert: (k, v) => {
      setWerte((w) => ({ ...w, [k]: v }));
      setFehler((f) => { if (!f.has(k)) return f; const n = new Set(f); n.delete(k); return n; });
      // Die Person hat entschieden: Markierung „zu klären“ weg, der Hinweis bleibt als Herkunft stehen
      setHinweise((h) => (h[k]?.klaeren ? { ...h, [k]: { ...h[k], klaeren: false } } : h));
    },
    files, dateiInfo, dateiFehler, setDatei: (k, f) => void setDatei(k, f), fehler, hinweise, outs, laeuft, ebenen, starten: (b, a) => void starten(b, a),
  };

  const renderList: RenderList = (blocks: Block[]) => inReihen(blocks, (b) => <BlockContent key={b.id} b={b} app={app} mode="run" renderList={renderList} />);

  // Passt eine Seite nicht auf den Bildschirm, wird sie stufenweise verdichtet:
  // 1 engere Abstände, 2 Einleitungstexte weg und Textfelder auf 3 Zeilen, 3 (Notfall) Textfelder auf 2 Zeilen.
  const [dicht, setDicht] = useState(0);
  useLayoutEffect(() => { setDicht(0); }, [ansicht]);
  useLayoutEffect(() => {
    const el = blatt.current;
    if (el && dicht < 3 && el.scrollHeight > el.clientHeight + 2) setDicht(dicht + 1);
  }, [ansicht, dicht]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let w = el.clientWidth, h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w && el.clientHeight === h) return;
      w = el.clientWidth; h = el.clientHeight;
      setDicht(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Scrollt das Blatt trotzdem, zeigt eine Schattenkante unten an, dass es weitergeht (bis ganz unten gescrollt ist).
  const scrollKante = useCallback(() => {
    const el = blatt.current;
    if (!el) return;
    const weiter = el.scrollHeight > el.clientHeight + 2 && el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    if (weiter) el.dataset.scrollt = "1"; else delete el.dataset.scrollt;
  }, []);
  useEffect(scrollKante);
  useEffect(() => {
    const el = blatt.current;
    if (!el) return;
    el.addEventListener("scroll", scrollKante, { passive: true });
    const ro = new ResizeObserver(scrollKante);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", scrollKante); ro.disconnect(); };
  }, [ansicht, scrollKante]);

  // Nach dem Aufruf per Tastatur (Enter auf einer Kachel) soll der Fokus im Blatt stehen, nicht auf body.
  useEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body) blatt.current?.focus({ preventScroll: true });
  }, []);

  // Strg+Enter startet den Ablauf von überall auf der Seite, außer in Dialogen/Menüs und in fremden Eingabefeldern.
  const tasteRef = useRef<(e: KeyboardEvent) => void>(() => {});
  tasteRef.current = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
    const t = e.target as HTMLElement | null;
    if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu'], [data-slot='popover-content']")) return;
    if (t?.closest("input, textarea, select, [contenteditable='true']") && !frame.current?.contains(t)) return;
    if ((imUeberblick || offen) && app.steps.length) { e.preventDefault(); void starten("uebersicht", uebersichtAktion); return; }
    let erster: Extract<Block, { type: "button" }> | undefined;
    // Erst ein Button auf der aktuellen Seite, sonst der erste der App.
    walk(p?.children ?? [], (b) => { if (!erster && b.type === "button") erster = b; });
    walk(app.blocks, (b) => { if (!erster && b.type === "button") erster = b; });
    if (erster) { e.preventDefault(); void starten(erster.id, erster.props.aktion); }
    else if (app.steps.length) { e.preventDefault(); void starten("uebersicht", uebersichtAktion); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => tasteRef.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const mitPflicht = useMemo(() => { let ja = false; walk(p?.children ?? [], (b) => { if (isFieldType(b.type) && "pflicht" in b.props && b.props.pflicht) ja = true; }); return ja; }, [p]);

  const fuellen = useMemo(() => {
    if (!p) return false;
    let n = 0;
    walk(p.children ?? [], (b) => { if (b.type === "textarea") n++; });
    return n === 1;
  }, [p]);

  // Ungesicherte Eingaben bzw. laufender Ablauf: vor dem Verlassen fragen
  const hatEingaben = Object.values(werte).some((v) => v !== "" && v !== false) || Object.keys(files).length > 0;
  const ungesichert = !!laeuft || (hatEingaben && (!stand || stand !== JSON.stringify(werte) + Object.keys(files).join("|")));
  useEffect(() => () => ctl.current?.abort(), []);

  const linearTitel = (i: number) => (i === uebersichtIdx && mitUebersicht ? "Ergebnisse" : seitenTitel(eingabeSeiten[i], seiten.indexOf(eingabeSeiten[i])));
  const kIdx = offen ? kacheln.indexOf(offen) : -1;
  const geaendert = !!stand && stand !== JSON.stringify(werte) + Object.keys(files).join("|");
  const naechste = akt + 1 < anzahl ? (akt + 1 === uebersichtIdx && mitUebersicht && nochNichtGelaufen ? "Ergebnisse erstellen" : `Weiter: ${linearTitel(akt + 1)}`) : undefined;

  return (
    <RunContext.Provider value={ctx}>
      <div className="app-frame" style={themeStyle(app.theme)} ref={frame} data-dicht={dicht} data-fuellen={fuellen && !offen && !imUeberblick ? "1" : undefined}
        onKeyDown={(e) => {
          if (offen) blaetterTaste(e, kIdx, kacheln.length, (i) => oeffnen(kacheln[i].id));
          else blaetterTaste(e, akt, anzahl, wechseln);
        }}>
        <Blatt id={ansicht} innerRef={blatt} className="app-inner innen-scroll" aria-label={offen ? offen.titel : imUeberblick ? "Ergebnisse" : linearTitel(akt)}>
          {offen ? (
            <>
              <div className="e-zurueck"><button type="button" className="pg-btn" onClick={() => oeffnen(null)}><ChevronLeft aria-hidden="true" size={16} />Alle Ergebnisse</button></div>
              {offen.seite ? renderList(offen.seite.children ?? [], `${offen.seite.id}:c`)
                : <OutputView app={app} titel={offen.titel} stepId={offen.stepIds[0]} stil="card" mode="run" />}
            </>
          ) : imUeberblick ? (
            <Uebersicht app={app} kacheln={kacheln} outs={outs} laeuft={!!laeuft} geaendert={geaendert}
              onStart={() => void starten("uebersicht", uebersichtAktion)} onOeffnen={oeffnen} />
          ) : p && <>
            <VorbelegungStand schritte={vorbelegungsSchritte(p)} outs={outs} laeuft={!!laeuft} onStart={(st) => void starten(`vorbelegen:${st.id}`, st.id, true)} />
            {renderList(p.children ?? [], `${p.id}:c`)}{mitPflicht && <p className="o-pflicht o-help"><em aria-hidden="true">*</em> Pflichtfeld</p>}</>}
        </Blatt>
        {offen ? (
          <Pager className="app-pager" label="Ergebnis" mehrzahl="Ergebnisse" seite={kIdx} anzahl={kacheln.length} titel={(i) => kacheln[i].titel}
            weiter={kacheln[kIdx + 1] ? `Weiter: ${kacheln[kIdx + 1].titel}` : undefined} onWechsel={(i) => oeffnen(kacheln[i].id)}
            ende="Alle Ergebnisse" onEnde={() => oeffnen(null)} />
        ) : (
          <Pager className="app-pager" seite={akt} anzahl={anzahl} titel={linearTitel} weiter={naechste} weiterKurz={naechste === "Ergebnisse erstellen" ? "Erstellen" : undefined} onWechsel={wechseln} onWeiter={() => weiterKlick(akt + 1)} />
        )}
      </div>
      {!eingebettet && <VerlassenSchutz ungesichert={ungesichert} laeuft={!!laeuft} blatt={blatt} onVerlassen={() => ctl.current?.abort()} />}
    </RunContext.Provider>
  );
});
