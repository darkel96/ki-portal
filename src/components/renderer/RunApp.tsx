import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { isFieldType, type App, type Block } from "@/lib/schema";
import { fieldsOf, seiteMit, seitenTitel, seitenVon, stepsFor, walk } from "@/lib/model";
import { Blatt, Pager, blaetterTaste } from "@/components/layout/Pager";
import { readFileInfo, UnsupportedFormatError } from "@/lib/files";
import { STATUS_LABEL, ablaufStarten, fehlendePflichtfelder, fehlendeVorstufe, type OutState, type Werte } from "@/lib/runner";
import type { FileInfo } from "@/lib/request";
import { BlockContent, type RenderList } from "./BlockContent";
import { OutputView } from "./OutputView";
import { RunContext, type RunCtx } from "./runContext";
import { themeStyle } from "./theme";

export type RunAppHandle = {
  beispieleEinsetzen: () => void;
  /** Aktuelle Eingaben (für Voreinstellungen) */
  stand: () => { werte: Werte; dateien: Record<string, FileInfo> };
  /** Eingaben einer Voreinstellung übernehmen */
  setzen: (werte: Werte, dateien: Record<string, FileInfo>) => void;
};

const KURZ = new Set(["input", "select", "radio", "checkbox", "number", "date", "file"]);
const artVon = (b: Block) => (b.type === "textarea" ? "lang" : KURZ.has(b.type) ? "kurz" : null);
/** Aufeinanderfolgende Eingaben gleicher Art nebeneinander setzen, damit die Seitenbreite genutzt wird. */
function inReihen(blocks: Block[], render: (b: Block) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length;) {
    const art = artVon(blocks[i]);
    let j = i + 1;
    if (art) while (j < blocks.length && artVon(blocks[j]) === art) j++;
    if (j - i > 1) out.push(<div key={`r-${blocks[i].id}`} className="o-reihe" data-art={art ?? ""}>{blocks.slice(i, j).map(render)}</div>);
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
function vorschau(k: Kachel, outs: Record<string, OutState>): string {
  for (const id of k.stepIds) {
    const o = outs[id];
    if (!o) continue;
    if (o.status === "laeuft") return "Wird erstellt …";
    if (o.status === "simuliert") return "Simulation: Die Anfrage ist vorbereitet, es gibt keine KI-Antwort.";
    if ((o.status === "uebersprungen" || o.status === "fehler") && o.meldung) return o.meldung;
    if (o.paket) return `${o.paket.dateien.length} ${o.paket.dateien.length === 1 ? "Datei" : "Dateien"}${o.paket.hinweis ? `: ${o.paket.hinweis}` : ""}`;
    if (o.text) return o.text.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/[#*_`>|]+/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
  }
  return "Wird erstellt, sobald der Ablauf startet.";
}

function Uebersicht({ kacheln, outs, laeuft, geaendert, onStart, onOeffnen }: {
  kacheln: Kachel[]; outs: Record<string, OutState>; laeuft: boolean; geaendert: boolean;
  onStart: () => void; onOeffnen: (id: string) => void;
}) {
  const stati = kacheln.map((k) => kachelStatus(k, outs));
  const fertig = stati.filter((s) => FERTIG.has(s)).length;
  const gestartet = stati.some((s) => s !== "wartet");
  return (
    <div className="e-uebersicht">
      <div className="e-kopf">
        <h2 className="o-h o-h2">Ergebnisse</h2>
        <span className="e-stand" aria-live="polite">{laeuft ? `${fertig} von ${kacheln.length} fertig, der Ablauf läuft …` : gestartet ? `${fertig} von ${kacheln.length} fertig` : "Noch nicht erstellt"}</span>
        <span className="flex-1" />
        {geaendert && !laeuft && gestartet && <span className="e-hinweis">Die Eingaben wurden seitdem geändert.</span>}
        <button type="button" className={`o-btn ${gestartet && !laeuft ? "outline" : ""}`} style={{ "--btn": "var(--signal)", "--btn-ink": "var(--signal-ink)" } as CSSProperties} onClick={onStart}>
          {laeuft ? "Stoppen" : gestartet ? "Neu erstellen" : "Ergebnisse erstellen"}
        </button>
      </div>
      <ul className="e-kacheln">
        {kacheln.map((k, i) => (
          <li key={k.id}>
            <button type="button" className="e-kachel" data-s={stati[i]} onClick={() => onOeffnen(k.id)}>
              <span className="e-kachel-kopf"><span className="e-titel">{k.titel}</span><span className="status-pill" data-s={stati[i]}>{STATUS_LABEL[stati[i]]}</span></span>
              <span className="e-text">{vorschau(k, outs)}</span>
              <span className="e-oeffnen">Öffnen</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Applikation im Modus „run“: Eingaben aktiv, KI-Buttons starten den Ablauf. */
export const RunApp = forwardRef<RunAppHandle, {
  app: App;
  /** Wird nach jedem Ablauf mit den Ergebnissen der gelaufenen Schritte aufgerufen (z. B. für den Verlauf in Mein Hub) */
  onLaufFertig?: (outs: Record<string, OutState>) => void;
}>(function RunApp({ app, onLaufFertig }, ref) {
  const [werte, setWerte] = useState<Werte>({});
  const [files, setFiles] = useState<Record<string, FileInfo>>({});
  const [dateiInfo, setDateiInfo] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<Set<string>>(new Set());
  const [outs, setOuts] = useState<Record<string, OutState>>({});
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const ergebnisse = useRef<Record<string, string>>({});
  const ctl = useRef<AbortController | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const blatt = useRef<HTMLDivElement>(null);
  /** Stand der Eingaben beim letzten Start (für den Hinweis „Eingaben geändert“) */
  const [stand, setStand] = useState("");

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
    const ohneElement = app.steps.filter((s) => !mitElement.has(s.id)).map((s) => ({ id: `schritt:${s.id}`, titel: s.name, stepIds: [s.id] }));
    return [...ausSeiten, ...ohneElement].filter((k) => k.stepIds.length);
  }, [app, seiten]);
  const mitUebersicht = kacheln.length > 0;
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
    const ziel = k ? frame.current?.querySelector<HTMLElement>(`[data-key="${k}"] input, [data-key="${k}"] textarea, [data-key="${k}"] select`) : null;
    (ziel ?? blatt.current)?.focus({ preventScroll: true });
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
    if (!f) { setFiles(({ [key]: _, ...rest }) => rest); setDateiInfo((d) => ({ ...d, [key]: "" })); return; }
    setDateiInfo((d) => ({ ...d, [key]: `${f.name} wird gelesen …` }));
    try {
      const info = await readFileInfo(f);
      setFiles((x) => ({ ...x, [key]: info }));
      setDateiInfo((d) => ({ ...d, [key]: info.text.trim() ? `${f.name} gelesen (${info.text.length.toLocaleString("de-DE")} Zeichen${info.text.length >= 60000 ? ", gekürzt" : ""})` : `${f.name} enthält keinen lesbaren Text, zum Beispiel ein eingescanntes PDF.` }));
    } catch (e) {
      setFiles(({ [key]: _, ...rest }) => rest);
      setDateiInfo((d) => ({ ...d, [key]: e instanceof UnsupportedFormatError ? "Dieses Format kann nicht gelesen werden. Speichere die Datei als .docx, .xlsx, .pdf, .csv oder .txt." : "Die Datei konnte nicht gelesen werden." }));
    }
  }, []);

  /** Lineare Position (Eingabeseite) der Seite, die einen passenden Baustein enthält; -1 = keine Eingabeseite */
  const eingabeIdxMit = useCallback((pred: (b: Block) => boolean) => {
    const s = seiteMit(app, pred);
    return s >= 0 ? eingabeSeiten.indexOf(seiten[s]) : -1;
  }, [app, eingabeSeiten, seiten]);

  const starten = useCallback(async (buttonId: string, aktion: string) => {
    if (ctl.current) { ctl.current.abort(); return; }
    const steps = stepsFor(app, aktion);
    if (!steps.length) return;
    const fehlend = fehlendePflichtfelder(app, steps, werte, files);
    setFehler(new Set(fehlend));
    if (fehlend.length) {
      const i = eingabeIdxMit((b) => "key" in b.props && b.props.key === fehlend[0]);
      if (i >= 0 && (i !== akt || detail || imUeberblick)) wechseln(i, fehlend[0]);
      else frame.current?.querySelector<HTMLElement>(`[data-key="${fehlend[0]}"] input, [data-key="${fehlend[0]}"] textarea, [data-key="${fehlend[0]}"] select`)?.focus();
      const namen = fieldsOf(app).filter((f) => fehlend.includes(f.props.key)).map((f) => f.props.label);
      toast.error(`Bitte ausfüllen: ${namen.join(", ")}.`);
      return;
    }
    const vor = fehlendeVorstufe(app, steps, ergebnisse.current);
    if (vor) {
      setOuts((o) => ({ ...o, [vor.step.id]: { status: "fehler", meldung: `„${vor.step.name}“ braucht das Ergebnis von „${vor.fehlt.name}“. Starte zuerst „${vor.fehlt.name}“.` } }));
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setLaeuft(buttonId);
    setStand(JSON.stringify(werte) + Object.keys(files).join("|"));
    // Wohin? Steht das Ergebnis des ersten Schritts auf einer Eingabeseite, dorthin; sonst in die Ergebnisübersicht.
    const inline = eingabeIdxMit((b) => b.type === "output" && b.props.quelle === steps[0].id);
    if (inline >= 0) { if (inline !== akt || detail) wechseln(inline); }
    else if (mitUebersicht && !imUeberblick) wechseln(uebersichtIdx);
    const gelaufen: Record<string, OutState> = {};
    try {
      ergebnisse.current = await ablaufStarten({
        app, aktion, werte, files, ergebnisse: ergebnisse.current, signal: c.signal,
        setOut: (id, s) => {
          gelaufen[id] = typeof s === "function" ? s(gelaufen[id]) : s;
          setOuts((o) => ({ ...o, [id]: typeof s === "function" ? s(o[id]) : s }));
        },
      });
    } finally {
      ctl.current = null;
      setLaeuft(null);
      if (Object.keys(gelaufen).length) onLaufFertig?.(gelaufen);
    }
  }, [onLaufFertig, app, werte, files, akt, detail, imUeberblick, mitUebersicht, uebersichtIdx, wechseln, eingabeIdxMit]);

  const nochNichtGelaufen = app.steps.every((s) => !outs[s.id]);
  /** Blättern; wer von den Eingaben in die Übersicht wechselt, startet den Ablauf automatisch (einmal, sobald alle Pflichtfelder gefüllt sind). */
  const blaettern = (i: number) => {
    if (mitUebersicht && i === uebersichtIdx && nochNichtGelaufen && !laeuft && app.steps.length) { void starten("uebersicht", "alle"); return; }
    wechseln(i);
  };

  const ebenen = useMemo(() => {
    const out: Record<string, number> = {};
    let letzte = 0;
    walk(app.blocks, (b) => { if (b.type === "heading") { const e = Math.max(1, Math.min(b.props.level, letzte + 1)); out[b.id] = e; letzte = e; } });
    return out;
  }, [app.blocks]);

  const ctx: RunCtx = { werte, setWert: (k, v) => { setWerte((w) => ({ ...w, [k]: v })); setFehler((f) => { if (!f.has(k)) return f; const n = new Set(f); n.delete(k); return n; }); }, files, dateiInfo, setDatei: (k, f) => void setDatei(k, f), fehler, outs, laeuft, ebenen, starten: (b, a) => void starten(b, a) };

  const renderList: RenderList = (blocks: Block[]) => inReihen(blocks, (b) => <BlockContent key={b.id} b={b} app={app} mode="run" renderList={renderList} />);

  // Passt eine Seite nicht auf den Bildschirm, wird sie stufenweise verdichtet (kleinere Abstände, flachere Textfelder).
  const [dicht, setDicht] = useState(0);
  useLayoutEffect(() => { setDicht(0); }, [ansicht]);
  useLayoutEffect(() => {
    const el = blatt.current;
    if (el && dicht < 2 && el.scrollHeight > el.clientHeight + 2) setDicht(dicht + 1);
  });
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

  const linearTitel = (i: number) => (i === uebersichtIdx && mitUebersicht ? "Ergebnisse" : seitenTitel(eingabeSeiten[i], seiten.indexOf(eingabeSeiten[i])));
  const kIdx = offen ? kacheln.indexOf(offen) : -1;
  const geaendert = !!stand && stand !== JSON.stringify(werte) + Object.keys(files).join("|");
  const naechste = akt + 1 < anzahl ? (akt + 1 === uebersichtIdx && mitUebersicht && nochNichtGelaufen ? "Ergebnisse erstellen" : `Weiter: ${linearTitel(akt + 1)}`) : undefined;

  return (
    <RunContext.Provider value={ctx}>
      <div className="app-frame" style={themeStyle(app.theme)} ref={frame} data-dicht={dicht}
        onKeyDown={(e) => {
          if (offen) blaetterTaste(e, kIdx, kacheln.length, (i) => oeffnen(kacheln[i].id));
          else blaetterTaste(e, akt, anzahl, blaettern);
          if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
          let erster: Extract<Block, { type: "button" }> | undefined;
          // Erst ein Button auf der aktuellen Seite, sonst der erste der App.
          walk(p?.children ?? [], (b) => { if (!erster && b.type === "button") erster = b; });
          walk(app.blocks, (b) => { if (!erster && b.type === "button") erster = b; });
          if (erster) { e.preventDefault(); void starten(erster.id, erster.props.aktion); }
          else if (app.steps.length) { e.preventDefault(); void starten("uebersicht", "alle"); }
        }}>
        <Blatt id={ansicht} innerRef={blatt} className="app-inner innen-scroll" aria-label={offen ? offen.titel : imUeberblick ? "Ergebnisse" : linearTitel(akt)}>
          {offen ? (
            <>
              <div className="e-zurueck"><button type="button" className="pg-btn" onClick={() => oeffnen(null)}><ChevronLeft aria-hidden="true" size={16} />Alle Ergebnisse</button></div>
              {offen.seite ? renderList(offen.seite.children ?? [], `${offen.seite.id}:c`)
                : <OutputView app={app} titel={offen.titel} stepId={offen.stepIds[0]} stil="card" mode="run" />}
            </>
          ) : imUeberblick ? (
            <Uebersicht kacheln={kacheln} outs={outs} laeuft={!!laeuft} geaendert={geaendert}
              onStart={() => void starten("uebersicht", "alle")} onOeffnen={oeffnen} />
          ) : p && renderList(p.children ?? [], `${p.id}:c`)}
        </Blatt>
        {offen ? (
          <Pager className="app-pager" label="Ergebnis" seite={kIdx} anzahl={kacheln.length} titel={(i) => kacheln[i].titel}
            weiter={kacheln[kIdx + 1] ? `Weiter: ${kacheln[kIdx + 1].titel}` : undefined} onWechsel={(i) => oeffnen(kacheln[i].id)} />
        ) : (
          <Pager className="app-pager" seite={akt} anzahl={anzahl} titel={linearTitel} weiter={naechste} onWechsel={blaettern} />
        )}
      </div>
    </RunContext.Provider>
  );
});
