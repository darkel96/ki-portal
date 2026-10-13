import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { Copy, FileText, Mic, Paperclip, Send, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { App, Block } from "@/lib/schema";
import { fill } from "@/lib/model";
import { GespraechVerfallen, KiSimulation, kiSenden } from "@/lib/ki";
import { anfrageVorbereiten, kontext } from "@/lib/runner";
import { markdown } from "@/lib/markdown";
import { FILE_ACCEPT, UnsupportedFormatError, loadImage, readFileInfo } from "@/lib/files";
import { diktatKorrigieren, fachbegriffe } from "@/lib/diktat";
import { linkQuellen } from "@/lib/links";
import { NACHSCHLAGEN, NACHSCHLAGEN_REGEL, nachschlagenAus } from "@/lib/nachschlagen";

import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";

/** Anhang zu einer Frage: Dokument (als Text gelesen) oder Bild (Daten-URL) */
type Anhang = { id: string; name: string; art: "dokument" | "bild"; text?: string; daten?: string };
type Nachricht = { von: "mensch" | "experte"; text: string; simulation?: string; fehler?: boolean; anhaenge?: Anhang[] };

const MAX_VERLAUF = 12;   // Beiträge, die die KI als Verlauf mitbekommt
const MAX_ANHANG_TEXT = 30_000;   // Zeichen je Dokument in der Anfrage
const MAX_BILDER = 4;   // Bilder, die eine volle Anfrage höchstens mitnimmt (die jüngsten)
const MAX_NACHSCHLAGEN = 2;   // weitere Suchdurchläufe je Frage, wenn die Auszüge auf andere Dokumente verweisen

const CHAT_ACCEPT = `${FILE_ACCEPT},image/*`;

/** Anhänge als Text für die Anfrage: Dokumente mit Inhalt, Bilder als Hinweis (sie liegen der Anfrage bei) */
function anhangText(a: Anhang[]): string {
  return a.map((x) => x.art === "bild"
    ? `Anhang „${x.name}“ (Bild der fragenden Person, liegt dieser Anfrage bei)`
    : `Anhang „${x.name}“ (Dokument der fragenden Person):\n${(x.text ?? "").slice(0, MAX_ANHANG_TEXT)}`).join("\n\n");
}

/** Browser-Spracherkennung (Chrome, Edge), falls vorhanden */
type Erkennung = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
function erkennungAnlegen(): Erkennung | null {
  const w = window as unknown as { SpeechRecognition?: new () => Erkennung; webkitSpeechRecognition?: new () => Erkennung };
  const K = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return K ? new K() : null;
}
/** Löst beim Abbruch sofort aus, auch wenn der laufende Vorgang (Anmeldefenster, Upload) das Signal nicht kennt */
function abbrechbar<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("abgebrochen", "AbortError"));
  return new Promise<T>((ok, nein) => {
    const stop = () => nein(new DOMException("abgebrochen", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
    p.then(ok, nein).finally(() => signal.removeEventListener("abort", stop));
  });
}
const diktatMoeglich = () => { const w = window as unknown as Record<string, unknown>; return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition); };

/**
 * Interaktiver Chat mit einem KI-Schritt als Fachexperte. Die erste Frage geht mit Rolle, Wissen und Quellen-Auszügen
 * an die KI; die Antwort wächst sichtbar mit. Bei Copilot wird dasselbe Gespräch weitergeführt: Folgefragen sind dann
 * kurz (nur Frage und frische Auszüge), weil Copilot den Verlauf schon kennt. Ohne weitergeführtes Gespräch (eigener
 * Schlüssel, Simulation, verfallenes Gespräch) bekommt jede Anfrage den Verlauf als Text mit. Der Verlauf bleibt im
 * Fenster, bis die Person ihn löscht oder die App verlässt.
 */
export function ChatView({ app, b, mode }: { app: App; b: Extract<Block, { type: "chat" }>; mode: Mode }) {
  const run = useRun();
  const step = app.steps.find((s) => s.id === b.props.quelle);
  const [verlauf, setVerlauf] = useState<Nachricht[]>([]);
  const [frage, setFrage] = useState("");
  const [anhaenge, setAnhaenge] = useState<Anhang[]>([]);   // für die nächste Frage
  const [liest, setLiest] = useState(0);   // Anhänge, die gerade gelesen werden
  const [laeuft, setLaeuft] = useState(false);
  const [stand, setStand] = useState("");
  const [hoert, setHoert] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const gespraech = useRef<string | null>(null);   // weitergeführtes Copilot-Gespräch
  const gesendet = useRef<Anhang[]>([]);   // alle Anhänge des Gesprächs (für eine volle Anfrage ohne Gespräch)
  const erkennung = useRef<Erkennung | null>(null);
  const diktiert = useRef(false);   // die nächste Frage kam (auch) aus dem Diktat
  const begriffe = useMemo(() => fachbegriffe(app), [app]);
  const liste = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const dateiwahl = useRef<HTMLInputElement>(null);

  useEffect(() => { liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: "smooth" }); }, [verlauf, laeuft]);
  useEffect(() => () => { ctl.current?.abort(); erkennung.current?.abort(); }, []);

  /** Dateien anhängen: Dokumente als Text, Bilder verkleinert als Daten-URL */
  const anhaengen = async (dateien: File[]) => {
    if (!dateien.length) return;
    setLiest((n) => n + dateien.length);
    for (const f of dateien) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        const a: Anhang = f.type.startsWith("image/")
          ? { id, name: f.name || "Bild", art: "bild", daten: await loadImage(f) }
          : { id, name: f.name, art: "dokument", text: (await readFileInfo(f)).text };
        if (a.art === "dokument" && !a.text?.trim()) toast.warning(`„${f.name}“ enthält keinen lesbaren Text.`);
        setAnhaenge((v) => [...v, a]);
      } catch (e) {
        toast.error(e instanceof UnsupportedFormatError ? `„${f.name}“ kann der Hub nicht lesen. Möglich sind Word, Excel, PDF, Text und Bilder.` : `„${f.name}“ konnte nicht gelesen werden.`);
      } finally { setLiest((n) => n - 1); }
    }
    eingabe.current?.focus();
  };
  const dateienGewaehlt = (e: ChangeEvent<HTMLInputElement>) => { void anhaengen(Array.from(e.target.files ?? [])); e.target.value = ""; };
  const eingefuegt = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const dateien = Array.from(e.clipboardData.items).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => !!f);
    if (dateien.length) { e.preventDefault(); void anhaengen(dateien.map((f, i) => (f.name && f.name !== "image.png") ? f : new File([f], `Zwischenablage-${i + 1}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))); }
  };
  const abgelegt = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (mode !== "edit" && !laeuft) void anhaengen(Array.from(e.dataTransfer.files)); };

  /** Diktieren über die Spracherkennung des Browsers; der erkannte Text wächst im Eingabefeld mit */
  const diktieren = () => {
    if (hoert) { erkennung.current?.stop(); return; }
    const r = erkennungAnlegen();
    if (!r) { toast.error("Dieser Browser bietet keine Spracheingabe. Chrome oder Edge nutzen."); return; }
    const basis = frage.trim() ? `${frage.trim()} ` : "";
    r.lang = "de-DE"; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      diktiert.current = true;
      setFrage(basis + diktatKorrigieren(text, begriffe));
    };
    r.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") toast.error(e.error === "not-allowed" ? "Das Mikrofon ist für diese Seite gesperrt." : `Spracheingabe: ${e.error}`); };
    r.onend = () => { setHoert(false); erkennung.current = null; eingabe.current?.focus(); };
    erkennung.current = r;
    setHoert(true);
    r.start();
  };

  const senden = async () => {
    if (hoert) erkennung.current?.stop();
    const f = frage.trim() || (anhaenge.length ? "Sieh dir bitte die Anhänge an." : "");
    if (!f || !step || laeuft || liest || !run) return;
    const neu = anhaenge;
    const bisher = verlauf;
    // Diktierte Fragen: Die KI soll Erkennungsfehler bei Fachbegriffen sinngemäß verstehen
    const frageText = diktiert.current ? `${f}\n(Die Frage wurde diktiert; Erkennungsfehler bei Namen und Fachbegriffen bitte sinngemäß verstehen.)` : f;
    diktiert.current = false;
    setVerlauf([...bisher, { von: "mensch", text: f, anhaenge: neu }, { von: "experte", text: "" }]);
    setFrage("");
    setAnhaenge([]);
    setLaeuft(true);
    const c = new AbortController();
    ctl.current = c;
    let bisherText = "";   // schon gestreamter Teil der Antwort (bleibt beim Stoppen stehen)
    const setzeAntwort = (patch: Partial<Nachricht>) => setVerlauf((v) => v.map((n, i) => (i === v.length - 1 ? { ...n, ...patch } : n)));
    // Suchtext für die Wissensquellen: die Frage, davor die letzten beiden Fragen der Person als Zusammenhang („was beinhaltet er“)
    const suche = [...bisher.filter((n) => n.von === "mensch").slice(-2).map((n) => n.text), f].join(" | ");
    const mitRegel = (rolle: string) => `${rolle.trim()}\n\n${NACHSCHLAGEN_REGEL}`;
    const mitAnhang = (prompt: string, a: Anhang[]) => (a.length ? `${prompt.trim()}\n\n${anhangText(a)}` : prompt);
    const bilderVon = (a: Anhang[]) => a.filter((x) => x.art === "bild" && x.daten).slice(-MAX_BILDER).map((x) => ({ name: x.name, daten: x.daten! }));
    // Volle Anfrage: Rolle, Wissen, Auszüge, Verlauf als Text (nur die letzten Beiträge), alle Anhänge des Gesprächs und die Frage
    const voll = async () => {
      const verlaufText = bisher.slice(-MAX_VERLAUF).filter((n) => n.text.trim()).map((n) => `${n.von === "mensch" ? "Person" : "Experte"}: ${n.text.trim()}`).join("\n\n");
      const ctx = { ...kontext(app, run.werte, run.files), frage: frageText, verlauf: verlaufText || "(noch keiner)" };
      // Der Prompt des Schritts darf {{frage}} und {{verlauf}} nutzen; fehlen sie, hängt der Chat beides an
      const hatFrage = /\{\{\s*frage\s*\}\}/i.test(step.prompt);
      const prompt = hatFrage ? step.prompt : `${step.prompt.trim()}\n\nBisheriger Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}`;
      const alle = [...gesendet.current, ...neu];
      // Links aus allen Fragen des Gesprächs bleiben als Quellen dabei
      const links = linkQuellen([...bisher.filter((n) => n.von === "mensch").map((n) => n.text), f].join("\n"));
      const chatStep = { ...step, rolle: mitRegel(step.rolle), prompt: mitAnhang(fill(prompt, ctx), alle), format: "markdown" as const, quellen: [...step.quellen, ...links] };
      const req = await anfrageVorbereiten(app, chatStep, ctx, run.files, c.signal, (m) => setStand(m), suche);
      return { ...req, bilder: bilderVon(alle) };
    };
    // Nachschlagen: Auszüge zu den Begriffen holen und die Frage damit noch einmal stellen (im Gespräch kurz, sonst mit Rolle)
    const nachschlagen = async (begriffe: string, letzter: boolean) => {
      setStand(`Schlägt nach: ${begriffe}\u00a0…`);
      const ctx = { ...kontext(app, run.werte, run.files), frage: frageText, verlauf: "" };
      const prompt = `Nachgeschlagen zu „${begriffe}“, die Auszüge stehen unten. Beantworte damit jetzt die Frage${letzter ? "; es wird nichts mehr nachgeschlagen, antworte endgültig, auch wenn etwas fehlt" : ""}.\n\nFrage: ${frageText}`;
      const chatStep = { ...step, rolle: mitRegel(step.rolle), prompt, format: "markdown" as const, quellen: [...step.quellen, ...linkQuellen(f)] };
      const req = await anfrageVorbereiten(app, chatStep, ctx, run.files, c.signal, (m) => setStand(m), begriffe);
      return { ...req, system: gespraech.current ? "" : req.system, bilder: [] as { name: string; daten: string }[] };
    };
    // Folgefrage im weitergeführten Gespräch: nur die Frage, neue Anhänge und passende Auszüge, keine Rolle und kein Verlauf
    const kurz = async () => {
      const ctx = { ...kontext(app, run.werte, run.files), frage: frageText, verlauf: "" };
      const chatStep = { ...step, rolle: mitRegel(step.rolle), prompt: mitAnhang(`Frage: ${frageText}`, neu), format: "markdown" as const, quellen: [...step.quellen, ...linkQuellen(f)] };
      const req = await anfrageVorbereiten(app, chatStep, ctx, run.files, c.signal, (m) => setStand(m), suche);
      return { ...req, system: "", bilder: bilderVon(neu) };
    };
    const senden = (req: Awaited<ReturnType<typeof voll>>) => {
      setStand(req.bilder?.length ? "Bilder werden übergeben\u00a0…" : "");
      // Eine „NACHSCHLAGEN:“-Zeile ist keine Antwort und wird nicht angezeigt
      return kiSenden(req, c.signal, (t) => { if (!c.signal.aborted && !NACHSCHLAGEN.test(t.trim().slice(0, 40))) { bisherText = t; setzeAntwort({ text: t }); } }, { gespraech: gespraech.current ?? undefined, onGespraech: (id) => { gespraech.current = id; } });
    };
    try {
      let text: string;
      try {
        text = await abbrechbar(senden(gespraech.current ? await abbrechbar(kurz(), c.signal) : await abbrechbar(voll(), c.signal)), c.signal);
      } catch (e) {
        // Copilot kennt das Gespräch nicht mehr: einmal mit vollem Kontext in einem neuen Gespräch wiederholen
        if (!(e instanceof GespraechVerfallen)) throw e;
        gespraech.current = null;
        text = await abbrechbar(senden(await abbrechbar(voll(), c.signal)), c.signal);
      }
      // Verweisen die Auszüge auf andere Dokumente: dort nachschlagen und erneut fragen (höchstens MAX_NACHSCHLAGEN-mal)
      for (let runde = 1; runde <= MAX_NACHSCHLAGEN; runde++) {
        const begriffe = nachschlagenAus(text);
        if (!begriffe) break;
        text = await abbrechbar(senden(await abbrechbar(nachschlagen(begriffe, runde === MAX_NACHSCHLAGEN), c.signal)), c.signal);
      }
      if (nachschlagenAus(text)) text = "Dazu habe ich in den hinterlegten Unterlagen nichts gefunden.";
      gesendet.current = [...gesendet.current, ...neu];
      setzeAntwort({ text });
    } catch (e) {
      if (e instanceof KiSimulation) setzeAntwort({ text: "", simulation: "nachricht" in e.req ? e.req.nachricht : "" });
      else if (c.signal.aborted) setzeAntwort({ text: bisherText ? `${bisherText}\n\n(gestoppt)` : "(gestoppt)" });
      else setzeAntwort({ text: e instanceof Error ? e.message : String(e), fehler: true });
    } finally {
      setStand("");
      setLaeuft(false);
      ctl.current = null;
      eingabe.current?.focus();
    }
  };

  const taste = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void senden(); }
  };
  const inZwischenablage = (text: string, meldung: string) => navigator.clipboard.writeText(text)
    .then(() => toast.success(meldung), () => toast.error("Kopieren nicht möglich."));
  const kopieren = () => inZwischenablage(verlauf.map((n) => `${n.von === "mensch" ? "Ich" : b.props.titel}: ${n.text}`).join("\n\n"), "Verlauf kopiert.");

  if (mode === "edit") {
    return (
      <div className="o-chat o-chat-edit" aria-label={b.props.titel}>
        <div className="o-chat-kopf"><span className="o-out-t">{b.props.titel}</span></div>
        <p className="o-muted">{step ? `Chat mit „${step.name}“ als Experte. ${b.props.begruessung}` : "Noch kein KI-Schritt als Experte gewählt."}</p>
      </div>
    );
  }
  return (
    <div className="o-chat" aria-label={b.props.titel} onDragOver={(e) => e.preventDefault()} onDrop={abgelegt}>
      <div className="o-chat-kopf">
        <span className="o-out-t">{b.props.titel}</span>
        <span className="flex-1" />
        {verlauf.length > 0 && <button type="button" className="o-chat-knopf" onClick={kopieren} title="Ganzen Verlauf kopieren"><Copy size={14} aria-hidden="true" />Alles kopieren</button>}
        {verlauf.length > 0 && !laeuft && <button type="button" className="o-chat-knopf" onClick={() => { setVerlauf([]); gespraech.current = null; gesendet.current = []; }} title="Neu beginnen"><Trash2 size={14} aria-hidden="true" />Neu beginnen</button>}
      </div>
      <div className="o-chat-verlauf" ref={liste} role="log" aria-live="polite" aria-label="Gesprächsverlauf">
        <div className="o-chat-n von-experte"><div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(b.props.begruessung) }} /></div>
        {verlauf.map((n, i) => (
          <div key={i} className={`o-chat-n von-${n.von}${n.fehler ? " fehler" : ""}`}>
            {n.text.trim() && n.simulation === undefined && (!laeuft || i < verlauf.length - 1) &&
              <button type="button" className="o-chat-kopie" aria-label={n.von === "mensch" ? "Frage kopieren" : "Antwort kopieren"} title="Nachricht kopieren" onClick={() => inZwischenablage(n.text, n.von === "mensch" ? "Frage kopiert." : "Antwort kopiert.")}><Copy size={13} aria-hidden="true" /></button>}
            {n.simulation !== undefined
              ? <><p className="o-muted">Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p><pre className="code o-sim">{n.simulation}</pre></>
              : n.von === "experte"
                ? (n.text ? <div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(n.text) }} /> : <p className="o-muted">{stand || "Denkt nach …"}</p>)
                : <>
                    <p>{n.text}</p>
                    {!!n.anhaenge?.length && <ul className="o-chat-anhaenge" aria-label="Anhänge">
                      {n.anhaenge.map((a) => <li key={a.id}>{a.art === "bild" && a.daten ? <img src={a.daten} alt={a.name} /> : <FileText size={13} aria-hidden="true" />}<span>{a.name}</span></li>)}
                    </ul>}
                  </>}
          </div>
        ))}
      </div>
      {(anhaenge.length > 0 || liest > 0) && <ul className="o-chat-anhaenge wartend" aria-label="Anhänge zur nächsten Frage">
        {anhaenge.map((a) => <li key={a.id}>
          {a.art === "bild" && a.daten ? <img src={a.daten} alt={a.name} /> : <FileText size={13} aria-hidden="true" />}<span>{a.name}</span>
          <button type="button" aria-label={`${a.name} entfernen`} title="Entfernen" onClick={() => setAnhaenge((v) => v.filter((x) => x.id !== a.id))}><X size={12} aria-hidden="true" /></button>
        </li>)}
        {liest > 0 && <li className="o-muted">Wird gelesen&nbsp;…</li>}
      </ul>}
      <form className="o-chat-eingabe" onSubmit={(e) => { e.preventDefault(); void senden(); }}>
        <textarea ref={eingabe} rows={2} value={frage} placeholder={hoert ? "Sprich jetzt …" : b.props.platzhalter} aria-label="Frage" disabled={!step} onChange={(e) => setFrage(e.target.value)} onKeyDown={taste} onPaste={eingefuegt} />
        <input ref={dateiwahl} type="file" multiple accept={CHAT_ACCEPT} hidden aria-label="Dateien anhängen" onChange={dateienGewaehlt} />
        <button type="button" className="o-chat-rund" aria-label="Datei oder Bild anhängen" title="Datei oder Bild anhängen (auch Einfügen aus der Zwischenablage oder Ablegen im Chat)" disabled={!step || laeuft} onClick={() => dateiwahl.current?.click()}><Paperclip size={16} aria-hidden="true" /></button>
        {diktatMoeglich() && <button type="button" className={`o-chat-rund${hoert ? " aktiv" : ""}`} aria-label={hoert ? "Diktat beenden" : "Diktieren"} aria-pressed={hoert} title={hoert ? "Diktat beenden" : "Frage diktieren"} disabled={!step || laeuft} onClick={diktieren}><Mic size={16} aria-hidden="true" /></button>}
        {laeuft
          ? <button type="button" className="o-btn outline" onClick={() => ctl.current?.abort()} style={{ "--btn": "var(--signal)", "--btn-ink": "var(--signal-ink)" } as CSSProperties}><Square size={14} aria-hidden="true" />Stoppen</button>
          : <button type="submit" className="o-btn" disabled={(!frage.trim() && !anhaenge.length) || !step || liest > 0} style={{ "--btn": "var(--app-accent)", "--btn-ink": "var(--app-accent-ink)" } as CSSProperties}><Send size={14} aria-hidden="true" />Senden</button>}
      </form>
      {!step && <p className="o-err">Dieser Chat ist mit keinem KI-Schritt verbunden.</p>}
    </div>
  );
}
