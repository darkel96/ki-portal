import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Copy, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { App, Block } from "@/lib/schema";
import { fill } from "@/lib/model";
import { GespraechVerfallen, KiSimulation, kiSenden } from "@/lib/ki";
import { anfrageVorbereiten, kontext } from "@/lib/runner";
import { markdown } from "@/lib/markdown";
import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";

type Nachricht = { von: "mensch" | "experte"; text: string; simulation?: string; fehler?: boolean };

const MAX_VERLAUF = 12;   // Beiträge, die die KI als Verlauf mitbekommt

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
  const [laeuft, setLaeuft] = useState(false);
  const [stand, setStand] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const gespraech = useRef<string | null>(null);   // weitergeführtes Copilot-Gespräch
  const liste = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: "smooth" }); }, [verlauf, laeuft]);
  useEffect(() => () => ctl.current?.abort(), []);

  const senden = async () => {
    const f = frage.trim();
    if (!f || !step || laeuft || !run) return;
    const bisher = verlauf;
    setVerlauf([...bisher, { von: "mensch", text: f }, { von: "experte", text: "" }]);
    setFrage("");
    setLaeuft(true);
    const c = new AbortController();
    ctl.current = c;
    const setzeAntwort = (patch: Partial<Nachricht>) => setVerlauf((v) => v.map((n, i) => (i === v.length - 1 ? { ...n, ...patch } : n)));
    // Volle Anfrage: Rolle, Wissen, Auszüge, Verlauf als Text (nur die letzten Beiträge) und die Frage
    const voll = async () => {
      const verlaufText = bisher.slice(-MAX_VERLAUF).filter((n) => n.text.trim()).map((n) => `${n.von === "mensch" ? "Person" : "Experte"}: ${n.text.trim()}`).join("\n\n");
      const ctx = { ...kontext(app, run.werte, run.files), frage: f, verlauf: verlaufText || "(noch keiner)" };
      // Der Prompt des Schritts darf {{frage}} und {{verlauf}} nutzen; fehlen sie, hängt der Chat beides an
      const hatFrage = /\{\{\s*frage\s*\}\}/i.test(step.prompt);
      const prompt = hatFrage ? step.prompt : `${step.prompt.trim()}\n\nBisheriger Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}`;
      const chatStep = { ...step, prompt: fill(prompt, ctx), format: "markdown" as const };
      return anfrageVorbereiten(app, chatStep, ctx, run.files, c.signal, (m) => setStand(m));
    };
    // Folgefrage im weitergeführten Gespräch: nur die Frage und passende Auszüge, keine Rolle und kein Verlauf
    const kurz = async () => {
      const ctx = { ...kontext(app, run.werte, run.files), frage: f, verlauf: "" };
      const chatStep = { ...step, prompt: `Frage: ${f}`, format: "markdown" as const };
      const req = await anfrageVorbereiten(app, chatStep, ctx, run.files, c.signal, (m) => setStand(m));
      return { ...req, system: "" };
    };
    const senden = (req: Awaited<ReturnType<typeof voll>>) => {
      setStand("");
      return kiSenden(req, c.signal, (t) => setzeAntwort({ text: t }), { gespraech: gespraech.current ?? undefined, onGespraech: (id) => { gespraech.current = id; } });
    };
    try {
      let text: string;
      try {
        text = await senden(gespraech.current ? await kurz() : await voll());
      } catch (e) {
        // Copilot kennt das Gespräch nicht mehr: einmal mit vollem Kontext in einem neuen Gespräch wiederholen
        if (!(e instanceof GespraechVerfallen)) throw e;
        gespraech.current = null;
        text = await senden(await voll());
      }
      setzeAntwort({ text });
    } catch (e) {
      if (e instanceof KiSimulation) setzeAntwort({ text: "", simulation: "nachricht" in e.req ? e.req.nachricht : "" });
      else if (c.signal.aborted) setzeAntwort({ text: (verlauf.at(-1)?.text ?? "") || "(gestoppt)" });
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
  const kopieren = () => navigator.clipboard.writeText(verlauf.map((n) => `${n.von === "mensch" ? "Ich" : b.props.titel}: ${n.text}`).join("\n\n"))
    .then(() => toast.success("Verlauf kopiert."), () => toast.error("Kopieren nicht möglich."));

  if (mode === "edit") {
    return (
      <div className="o-chat o-chat-edit" aria-label={b.props.titel}>
        <div className="o-chat-kopf"><span className="o-out-t">{b.props.titel}</span></div>
        <p className="o-muted">{step ? `Chat mit „${step.name}“ als Experte. ${b.props.begruessung}` : "Noch kein KI-Schritt als Experte gewählt."}</p>
      </div>
    );
  }
  return (
    <div className="o-chat" aria-label={b.props.titel}>
      <div className="o-chat-kopf">
        <span className="o-out-t">{b.props.titel}</span>
        <span className="flex-1" />
        {verlauf.length > 0 && <button type="button" className="o-chat-knopf" onClick={kopieren} title="Verlauf kopieren"><Copy size={14} aria-hidden="true" />Kopieren</button>}
        {verlauf.length > 0 && !laeuft && <button type="button" className="o-chat-knopf" onClick={() => { setVerlauf([]); gespraech.current = null; }} title="Neu beginnen"><Trash2 size={14} aria-hidden="true" />Neu beginnen</button>}
      </div>
      <div className="o-chat-verlauf" ref={liste} role="log" aria-live="polite" aria-label="Gesprächsverlauf">
        <div className="o-chat-n von-experte"><div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(b.props.begruessung) }} /></div>
        {verlauf.map((n, i) => (
          <div key={i} className={`o-chat-n von-${n.von}${n.fehler ? " fehler" : ""}`}>
            {n.simulation !== undefined
              ? <><p className="o-muted">Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p><pre className="code o-sim">{n.simulation}</pre></>
              : n.von === "experte"
                ? (n.text ? <div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(n.text) }} /> : <p className="o-muted">{stand || "Denkt nach …"}</p>)
                : <p>{n.text}</p>}
          </div>
        ))}
      </div>
      <form className="o-chat-eingabe" onSubmit={(e) => { e.preventDefault(); void senden(); }}>
        <textarea ref={eingabe} rows={2} value={frage} placeholder={b.props.platzhalter} aria-label="Frage" disabled={!step} onChange={(e) => setFrage(e.target.value)} onKeyDown={taste} />
        {laeuft
          ? <button type="button" className="o-btn outline" onClick={() => ctl.current?.abort()} style={{ "--btn": "var(--signal)", "--btn-ink": "var(--signal-ink)" } as CSSProperties}><Square size={14} aria-hidden="true" />Stoppen</button>
          : <button type="submit" className="o-btn" disabled={!frage.trim() || !step} style={{ "--btn": "var(--app-accent)", "--btn-ink": "var(--app-accent-ink)" } as CSSProperties}><Send size={14} aria-hidden="true" />Senden</button>}
      </form>
      {!step && <p className="o-err">Dieser Chat ist mit keinem KI-Schritt verbunden.</p>}
    </div>
  );
}
