import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronDown, ChevronRight, Mail, MailOpen, Paperclip, RefreshCw, Search } from "lucide-react";
import type { Block } from "@/lib/schema";
import { nachrichtenLaden, nachrichtLaden, ordnerLaden, postfachEcht, type Nachricht, type NachrichtVoll, type Ordner } from "@/lib/ki/postfach";
import type { Mode } from "./BlockContent";

type Props = { b: Extract<Block, { type: "postfach" }>; mode: Mode };

const datum = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso), heute = new Date();
  const gleicherTag = d.toDateString() === heute.toDateString();
  return gleicherTag ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: d.getFullYear() === heute.getFullYear() ? undefined : "2-digit" });
};
const datumLang = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** Postfach wie in Outlook: links die Ordner, in der Mitte die Nachrichten des gewählten Ordners, rechts die geöffnete Nachricht */
export function PostfachView({ b, mode }: Props) {
  const [ordner, setOrdner] = useState<Ordner[]>([]);
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const [gewaehlt, setGewaehlt] = useState<Ordner | null>(null);
  const [liste, setListe] = useState<Nachricht[]>([]);
  const [weiter, setWeiter] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [eingabe, setEingabe] = useState("");
  const [nachricht, setNachricht] = useState<NachrichtVoll | null>(null);
  const [laedt, setLaedt] = useState<"ordner" | "liste" | "mehr" | "nachricht" | null>(null);
  const [fehler, setFehler] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const echt = postfachEcht();

  const ordnerHolen = async () => {
    setLaedt("ordner"); setFehler("");
    try {
      const o = await ordnerLaden();
      setOrdner(o);
      setGewaehlt((alt) => alt ?? o[0] ?? null);
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  useEffect(() => { if (mode === "run") void ordnerHolen(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nachrichten des gewählten Ordners (bei Ordnerwechsel und Suche neu)
  useEffect(() => {
    if (mode !== "run" || !gewaehlt) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLaedt("liste"); setFehler(""); setNachricht(null);
    nachrichtenLaden(gewaehlt.id, b.props.anzahl, { suche }, c.signal)
      .then((s) => { if (!c.signal.aborted) { setListe(s.liste); setWeiter(s.weiter); } })
      .catch((e) => { if (!c.signal.aborted) setFehler(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!c.signal.aborted) setLaedt(null); });
    return () => c.abort();
  }, [gewaehlt, suche, b.props.anzahl, mode]);

  const mehr = async () => {
    if (!gewaehlt || !weiter) return;
    setLaedt("mehr");
    try { const s = await nachrichtenLaden(gewaehlt.id, b.props.anzahl, { weiter }); setListe((l) => [...l, ...s.liste]); setWeiter(s.weiter); }
    catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  const oeffnen = async (n: Nachricht) => {
    setLaedt("nachricht"); setFehler("");
    try { setNachricht(await nachrichtLaden(n.id)); }
    catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  const html = useMemo(() => (nachricht?.html ? DOMPurify.sanitize(nachricht.html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button"], ADD_ATTR: ["target"] }) : ""), [nachricht]);

  const ordnerZeile = (o: Ordner, tiefe: number) => (
    <li key={o.id}>
      <button type="button" className={`o-post-ordner${gewaehlt?.id === o.id ? " ist-aktiv" : ""}`} style={{ paddingLeft: 10 + tiefe * 16 }} onClick={() => { setSuche(""); setEingabe(""); setGewaehlt(o); }} aria-current={gewaehlt?.id === o.id ? "true" : undefined}>
        {o.kinder?.length ? <span className="o-post-klapp" role="button" aria-label={offen.has(o.id) ? "Unterordner einklappen" : "Unterordner ausklappen"} onClick={(e) => { e.stopPropagation(); setOffen((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; }); }}>{offen.has(o.id) ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}</span> : <span className="o-post-klapp" />}
        <span className="o-post-ordnername">{o.name}</span>
        {o.ungelesen > 0 && <span className="o-post-zahl" aria-label={`${o.ungelesen} ungelesen`}>{o.ungelesen}</span>}
      </button>
      {!!o.kinder?.length && offen.has(o.id) && <ul>{o.kinder.map((k) => ordnerZeile(k, tiefe + 1))}</ul>}
    </li>
  );

  if (mode === "edit") {
    return (
      <div className="o-post o-post-edit" aria-label={b.props.titel}>
        <div className="o-post-kopf"><Mail size={16} aria-hidden="true" /><b>{b.props.titel}</b></div>
        <p className="o-muted">Zeigt beim Ausführen die Ordner und Nachrichten des Postfachs der angemeldeten Person (nur lesen). {b.props.anzahl} Nachrichten je Seite{b.props.vorschau ? ", mit Vorschau" : ""}.</p>
      </div>
    );
  }
  return (
    <div className="o-post" aria-label={b.props.titel}>
      <div className="o-post-kopf">
        <Mail size={16} aria-hidden="true" /><b>{b.props.titel}</b>
        {!echt && <span className="o-post-hinweis">Beispielpostfach (ohne Copilot-Anbindung)</span>}
        <span className="flex-1" />
        <button type="button" className="o-chat-knopf" onClick={() => { void ordnerHolen(); setSuche(eingabe); }} disabled={laedt !== null} title="Neu laden"><RefreshCw size={13} aria-hidden="true" />Aktualisieren</button>
      </div>
      {fehler && <p className="o-err" role="alert">{fehler}</p>}
      <div className="o-post-raster">
        <nav className="o-post-ordnerliste" aria-label="Ordner">
          {laedt === "ordner" && !ordner.length ? <p className="o-muted">Ordner werden geladen …</p> : <ul>{ordner.map((o) => ordnerZeile(o, 0))}</ul>}
        </nav>
        <section className="o-post-liste" aria-label={gewaehlt ? `Nachrichten in ${gewaehlt.name}` : "Nachrichten"}>
          <form className="o-post-suche" onSubmit={(e) => { e.preventDefault(); setSuche(eingabe.trim()); }}>
            <Search size={14} aria-hidden="true" />
            <input value={eingabe} onChange={(e) => setEingabe(e.target.value)} placeholder={gewaehlt ? `In „${gewaehlt.name}“ suchen` : "Suchen"} aria-label="Nachrichten durchsuchen" />
            {suche && <button type="button" className="o-chat-link" onClick={() => { setSuche(""); setEingabe(""); }}>Suche aufheben</button>}
          </form>
          {laedt === "liste" ? <p className="o-muted">Nachrichten werden geladen …</p>
            : !liste.length ? <p className="o-muted">{suche ? "Nichts gefunden." : "Keine Nachrichten in diesem Ordner."}</p>
            : <ul className="o-post-nachrichten">
              {liste.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`o-post-nachricht${n.gelesen ? "" : " ist-neu"}${nachricht?.id === n.id ? " ist-aktiv" : ""}`} onClick={() => void oeffnen(n)} aria-current={nachricht?.id === n.id ? "true" : undefined}>
                    <span className="o-post-symbol">{n.gelesen ? <MailOpen size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}</span>
                    <span className="o-post-text">
                      <span className="o-post-zeile"><span className="o-post-von">{n.von || n.vonAdresse}</span><span className="o-post-datum">{datum(n.empfangen)}</span></span>
                      <span className="o-post-zeile"><span className="o-post-betreff">{n.wichtig && <span className="o-post-wichtig" title="Hohe Wichtigkeit">!</span>}{n.betreff}</span>{n.anhang && <Paperclip size={12} aria-label="Anhang" />}</span>
                      {b.props.vorschau && n.vorschau && <span className="o-post-vorschau">{n.vorschau}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>}
          {weiter && <button type="button" className="o-chat-knopf" onClick={() => void mehr()} disabled={laedt !== null}>{laedt === "mehr" ? "Lädt …" : "Mehr laden"}</button>}
        </section>
        <article className="o-post-inhalt" aria-label="Geöffnete Nachricht">
          {laedt === "nachricht" ? <p className="o-muted">Nachricht wird geladen …</p>
            : !nachricht ? <p className="o-muted">Wähle eine Nachricht aus.</p>
            : <>
              <h3 className="o-post-titel">{nachricht.betreff}</h3>
              <p className="o-post-meta"><b>{nachricht.von}</b>{nachricht.vonAdresse && <span> &lt;{nachricht.vonAdresse}&gt;</span>}<br />
                {!!nachricht.an.length && <span>An: {nachricht.an.join(", ")}<br /></span>}
                {!!nachricht.cc.length && <span>Cc: {nachricht.cc.join(", ")}<br /></span>}
                <span>{datumLang(nachricht.empfangen)}</span>{nachricht.anhang && <span> · mit Anhang</span>}</p>
              {html ? <div className="o-post-body o-body" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="o-post-body o-post-klartext">{nachricht.text}</pre>}
            </>}
        </article>
      </div>
    </div>
  );
}
