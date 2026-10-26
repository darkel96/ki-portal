import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { App, Block } from "@/lib/schema";
import { inkFor } from "@/lib/model";
import { FILE_ACCEPT } from "@/lib/files";
import { AMPEL_KURZ, AMPEL_LABEL, AMPEL_STANDARD, AMPEL_STANDARD_TEXT, ampelPaare, ampelText, ampelWert, type Ampel } from "@/lib/ampel";
import { TONES } from "./theme";
import { useRun } from "./runContext";
import { OutputView } from "./OutputView";
import { ChatView } from "./ChatView";
import { PostfachView } from "./PostfachView";
import { TabelleView } from "./TabelleView";

export type Mode = "edit" | "run";
export type RenderList = (blocks: Block[], listId: string) => ReactNode;

const alignStyle = (align?: string, color?: string): CSSProperties => ({ textAlign: (align as CSSProperties["textAlign"]) || "left", ...(color ? { color } : {}) });

/** Textfeld wächst mit dem Inhalt (CSS field-sizing; ohne Unterstützung per Höhe aus scrollHeight) */
const FELD_WAECHST = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");
function Mitwachsend(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || FELD_WAECHST) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

/** Partner im Paar aus Inhaltsfeld und Status-Feld (siehe ampelPaare) */
type Paar = { key: string; rolle: "status" | "inhalt" } | null;

function Field({ b, mode, paar }: { b: Extract<Block, { type: "input" | "textarea" | "select" | "radio" | "checkbox" | "number" | "date" | "file" }>; mode: Mode; paar?: Paar }) {
  const run = useRun();
  const dateiInput = useRef<HTMLInputElement>(null);
  const P = b.props;
  const id = `in-${P.key}`;
  const dis = mode === "edit";
  const err = run?.fehler.has(P.key);
  const req = P.pflicht ? <em aria-hidden="true">*</em> : null;
  const ki = run?.hinweise[P.key];
  const klaeren = !!ki?.klaeren;
  const v = run?.werte[P.key];
  // Ampel (globale Regel): Auswahlwerte nach Bedeutung, Text nach Markierungen; ein Inhaltsfeld übernimmt die Ampel seines Status-Felds
  const aktiv = mode !== "edit" && !!run;
  const eigene: Ampel | null = !aktiv ? null : b.type === "select" || b.type === "radio" ? ampelWert(v) : b.type === "textarea" || b.type === "input" ? ampelText(v, !!(P as { aus?: string }).aus) : null;
  const geerbt: Ampel | null = aktiv && paar?.rolle === "inhalt" ? ampelWert(run!.werte[paar.key]) : null;
  const ampel: Ampel | null = eigene ?? geerbt;
  const warnt = eigene === "rot" || eigene === "gelb";
  const geerbtWarnt = !eigene && (geerbt === "rot" || geerbt === "gelb");
  // Begründung steht genau einmal, unter dem Status-Feld: dessen eigener Satz, sonst der Satz der KI zum Inhaltsfeld, sonst ein Standardhinweis
  const partnerHinweis = aktiv && paar?.rolle === "status" ? run!.hinweise[paar.key]?.hinweis : undefined;
  const erklaerung = warnt ? (ki?.hinweis || partnerHinweis || (b.type === "select" || b.type === "radio" ? AMPEL_STANDARD[eigene] : AMPEL_STANDARD_TEXT[eigene])) : "";
  // Ein Inhaltsfeld, dessen Status warnt, gibt seinen Satz an das Status-Feld ab (sonst stünde er doppelt da)
  const statusHatEigenen = paar?.rolle === "inhalt" && !!run?.hinweise[paar.key]?.hinweis;
  // Hat die Person den Status auf „geklärt“ gesetzt, ist die alte Begründung erledigt
  const erledigt = eigene === "gruen" && (b.type === "select" || b.type === "radio");
  const eigenerHinweis = (geerbtWarnt && !statusHatEigenen) || erledigt ? undefined : ki?.hinweis;
  // „Zu klären“ (KI war beim Lesen unsicher) hat Vorrang; sonst ersetzt der Hinweis der KI den allgemeinen Hilfetext
  const help = erklaerung && !klaeren
    ? <span className="o-help o-ki-hinweis o-ampel-hinweis" id={`${id}-hilfe`}><b>{AMPEL_KURZ[eigene!]}</b>{erklaerung}</span>
    : eigenerHinweis || klaeren
    ? <span className={`o-help o-ki-hinweis ${klaeren ? "klaeren" : ""}`} id={`${id}-hilfe`}>{klaeren && <b className="o-klaeren-marke">Zu klären</b>}{eigenerHinweis ?? (klaeren ? "Nicht eindeutig gelesen. Bitte prüfen und von Hand setzen." : "")}</span>
    : P.hilfe ? <span className="o-help" id={`${id}-hilfe`}>{P.hilfe}</span> : null;
  const set = (val: string | boolean) => run?.setWert(P.key, val);
  const described = [help ? `${id}-hilfe` : "", err ? `${id}-fehler` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name: P.key, autoComplete: "off", disabled: dis, tabIndex: dis ? -1 : undefined, "aria-invalid": err || undefined, "aria-describedby": described, "aria-required": P.pflicht || undefined };
  let ctl: ReactNode;
  switch (b.type) {
    case "textarea": ctl = <Mitwachsend {...common} rows={b.props.rows} style={{ "--rows": b.props.rows } as CSSProperties} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "select": ctl = (
      <select {...common} value={String(v ?? "")} onChange={(e) => set(e.target.value)}>
        <option value="">Bitte wählen</option>
        {b.props.optionen.map((o) => <option key={o}>{o}</option>)}
      </select>); break;
    case "radio": return (
      <fieldset className={`o-field ${err ? "err" : ""} ${klaeren ? "klaeren" : ""}`} data-key={P.key} data-ampel={ampel ?? undefined} style={{ border: 0, padding: 0, margin: 0 }} role="radiogroup" aria-required={P.pflicht || undefined} aria-invalid={err || undefined} aria-describedby={described}>
        <legend className="o-lbl">{P.label}{req}</legend>
        <div className="o-opts">{b.props.optionen.map((o) => (
          <label key={o}><input type="radio" name={`r-${P.key}`} value={o} disabled={dis} checked={v === o} onChange={() => set(o)} /> {o}</label>
        ))}</div>
        {help}{err && <span className="o-err" id={`${id}-fehler`}>Bitte auswählen.</span>}
      </fieldset>);
    case "checkbox": return (
      <div className={`o-field ${err ? "err" : ""} ${klaeren ? "klaeren" : ""}`} data-key={P.key}>
        <label className="o-check"><input type="checkbox" {...common} checked={!!v} onChange={(e) => set(e.target.checked)} /> {P.label}{req}</label>
        {help}{err && <span className="o-err" id={`${id}-fehler`}>Bitte bestätigen.</span>}
      </div>);
    case "number": ctl = <input type="number" {...common} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "date": ctl = <input type="date" {...common} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "file": {
      // Natives Feld versteckt (Label/htmlFor und Tastatur bleiben), sichtbar: Knopf, Dateiname bzw. Status, Entfernen
      const info = run?.dateiInfo[P.key] ?? "";
      const gewaehlt = !!run?.files[P.key] || !!info;
      ctl = (
        <>
          <input ref={dateiInput} type="file" {...common} accept={FILE_ACCEPT} className="o-file-nativ" tabIndex={-1}
            onChange={(e) => run?.setDatei(P.key, e.target.files?.[0] ?? null)} />
          <div className="o-file">
            <button type="button" className="o-file-btn" disabled={dis} tabIndex={dis ? -1 : undefined} aria-describedby={described} aria-invalid={err || undefined}
              aria-label={`${P.label}: Datei auswählen`} onClick={() => dateiInput.current?.click()}>{gewaehlt ? "Andere Datei" : "Datei auswählen"}</button>
            <span className={run?.dateiFehler?.has(P.key) ? "o-err" : "o-help o-file-stand"} aria-live="polite">{info || "Keine Datei ausgewählt"}</span>
            {gewaehlt && <button type="button" className="o-file-weg" disabled={dis} aria-label={`${P.label}: Datei entfernen`} onClick={() => { if (dateiInput.current) dateiInput.current.value = ""; run?.setDatei(P.key, null); }}>Entfernen</button>}
          </div>
        </>); break;
    }
    default: ctl = <input type="text" {...common} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />;
  }
  return (
    <div className={`o-field ${err ? "err" : ""} ${klaeren ? "klaeren" : ""}`} data-key={P.key} data-ampel={ampel ?? undefined} data-ampel-geerbt={!eigene && geerbt ? "" : undefined} title={ampel ? AMPEL_LABEL[ampel] : undefined}>
      <label htmlFor={id}>{P.label}{req}</label>
      {ctl}{help}
      {err && <span className="o-err" id={`${id}-fehler`}>{b.type === "select" ? "Bitte auswählen." : b.type === "file" ? "Bitte eine Datei auswählen." : "Bitte ausfüllen."}</span>}
    </div>
  );
}

/** Paar aus Inhaltsfeld und Status-Feld zu diesem Feld */
function paarVon(app: App, key: string): Paar {
  const p = ampelPaare(app);
  const s = p.zuStatus.get(key);
  if (s) return { key: s, rolle: "inhalt" };
  const i = p.zuInhalt.get(key);
  return i ? { key: i, rolle: "status" } : null;
}

export function BlockContent({ b, app, mode, renderList }: { b: Block; app: App; mode: Mode; renderList: RenderList }) {
  const run = useRun();
  switch (b.type) {
    case "heading": {
      const ebene = mode === "edit" ? 0 : run?.ebenen[b.id] ?? b.props.level;
      const Tag = (ebene ? `h${ebene}` : "div") as "h1" | "h2" | "h3" | "h4" | "div";
      return <Tag className={`o-h o-h${b.props.level}`} style={alignStyle(b.props.align, b.props.color)}>{b.props.text}</Tag>;
    }
    case "text":
      return <p className={`o-p ${b.props.size}`} style={{ ...alignStyle(b.props.align, b.props.color), marginInline: b.props.align === "center" ? "auto" : b.props.align === "right" ? "0 0 0 auto" : undefined }}>{b.props.text}</p>;
    case "callout": {
      const [lab, tone] = TONES[b.props.tone];
      return <div className="o-call" style={{ "--tone": tone } as CSSProperties} role="note"><b>{lab}</b>{b.props.text}</div>;
    }
    case "divider": return <hr className="o-hr" />;
    case "spacer": return <div style={{ height: b.props.h }} aria-hidden="true" />;
    case "image":
      if (!b.props.src) return mode === "edit" ? <div className="o-img-ph">Bild oder Logo: rechts eine Datei auswählen</div> : null;
      return <div style={{ textAlign: b.props.align }}><img className={`o-img ${b.props.size}`} src={b.props.src} alt={b.props.alt} decoding="async" /></div>;
    case "section": {
      const ink = inkFor(b.props.bg);
      const st: CSSProperties = b.props.bg && ink ? ({ background: b.props.bg, color: ink, "--app-bg": b.props.bg, "--app-ink": ink } as CSSProperties) : { background: "var(--app-soft)" };
      return <div className={`o-sec p-${b.props.pad} ${b.props.border ? "bordered" : ""}`} style={st}>{renderList(b.children ?? [], `${b.id}:c`)}</div>;
    }
    case "seite":
      return <div className="o-stack">{renderList(b.children ?? [], `${b.id}:c`)}</div>;
    case "columns":
      return <div className="o-cols" style={{ "--n": b.cols?.length ?? 2 } as CSSProperties}>{(b.cols ?? []).map((c, i) => <div className="o-stack" key={i}>{renderList(c, `${b.id}:${i}`)}</div>)}</div>;
    case "button": {
      // KI-Buttons folgen der Akzentfarbe der App (Standard: Körber-Blau), solange keine eigene Farbe gewählt ist.
      const c = b.props.color || "var(--app-accent)";
      const ink = b.props.color ? inkFor(b.props.color) : "var(--app-accent-ink)";
      const laeuft = run?.laeuft === b.id;
      return (
        <div className="o-btn-row" style={{ justifyContent: b.props.align === "center" ? "center" : b.props.align === "right" ? "flex-end" : "flex-start" }}>
          <button type="button" className={`o-btn ${b.props.stil === "outline" ? "outline" : ""}`} style={{ "--btn": c, "--btn-ink": ink } as CSSProperties}
            disabled={mode === "edit" || (!!run?.laeuft && !laeuft) || (laeuft && !!run?.stoppt)} tabIndex={mode === "edit" ? -1 : undefined}
            onClick={() => run?.starten(b.id, b.props.aktion)}
            title={mode === "run" && run?.laeuft && !laeuft ? "Ein anderer Ablauf läuft gerade. Warte, bis er fertig ist, oder stopp ihn." : undefined}>
            {laeuft ? (run?.stoppt ? "Wird gestoppt\u00a0…" : "Stoppen") : b.props.text}
          </button>
        </div>
      );
    }
    case "output":
      return <OutputView app={app} titel={b.props.titel} stepId={b.props.quelle} stil={b.props.stil} mode={mode} pfad={b.props.pfad} />;
    case "chat":
      return <ChatView app={app} b={b} mode={mode} />;
    case "postfach":
      return <PostfachView b={b} mode={mode} />;
    case "tabelle":
      return <TabelleView b={b} mode={mode} />;
    default:
      return <Field b={b} mode={mode} paar={paarVon(app, b.props.key)} />;
  }
}
