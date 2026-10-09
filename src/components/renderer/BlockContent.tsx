import type { CSSProperties, ReactNode } from "react";
import type { App, Block } from "@/lib/schema";
import { inkFor } from "@/lib/model";
import { FILE_ACCEPT } from "@/lib/files";
import { TONES } from "./theme";
import { useRun } from "./runContext";
import { OutputView } from "./OutputView";

export type Mode = "edit" | "run";
export type RenderList = (blocks: Block[], listId: string) => ReactNode;

const alignStyle = (align?: string, color?: string): CSSProperties => ({ textAlign: (align as CSSProperties["textAlign"]) || "left", ...(color ? { color } : {}) });

function Field({ b, mode }: { b: Extract<Block, { type: "input" | "textarea" | "select" | "radio" | "checkbox" | "number" | "date" | "file" }>; mode: Mode }) {
  const run = useRun();
  const P = b.props;
  const id = `in-${P.key}`;
  const dis = mode === "edit";
  const err = run?.fehler.has(P.key);
  const req = P.pflicht ? <em aria-hidden="true">*</em> : null;
  const help = P.hilfe ? <span className="o-help" id={`${id}-hilfe`}>{P.hilfe}</span> : null;
  const v = run?.werte[P.key];
  const set = (val: string | boolean) => run?.setWert(P.key, val);
  const described = [P.hilfe ? `${id}-hilfe` : "", err ? `${id}-fehler` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name: P.key, autoComplete: "off", disabled: dis, tabIndex: dis ? -1 : undefined, "aria-invalid": err || undefined, "aria-describedby": described, "aria-required": P.pflicht || undefined };
  let ctl: ReactNode;
  switch (b.type) {
    case "textarea": ctl = <textarea {...common} rows={b.props.rows} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "select": ctl = (
      <select {...common} value={String(v ?? "")} onChange={(e) => set(e.target.value)}>
        <option value="">Bitte wählen</option>
        {b.props.optionen.map((o) => <option key={o}>{o}</option>)}
      </select>); break;
    case "radio": return (
      <fieldset className={`o-field ${err ? "err" : ""}`} data-key={P.key} style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={described}>
        <legend className="o-lbl">{P.label}{req}</legend>
        <div className="o-opts">{b.props.optionen.map((o) => (
          <label key={o}><input type="radio" name={`r-${P.key}`} value={o} disabled={dis} checked={v === o} onChange={() => set(o)} /> {o}</label>
        ))}</div>
        {help}{err && <span className="o-err" id={`${id}-fehler`}>Bitte auswählen.</span>}
      </fieldset>);
    case "checkbox": return (
      <div className={`o-field ${err ? "err" : ""}`} data-key={P.key}>
        <label className="o-check"><input type="checkbox" {...common} checked={!!v} onChange={(e) => set(e.target.checked)} /> {P.label}{req}</label>
        {help}{err && <span className="o-err" id={`${id}-fehler`}>Bitte bestätigen.</span>}
      </div>);
    case "number": ctl = <input type="number" {...common} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "date": ctl = <input type="date" {...common} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />; break;
    case "file": ctl = (
      <>
        <input type="file" {...common} accept={FILE_ACCEPT} className="o-file" onChange={(e) => run?.setDatei(P.key, e.target.files?.[0] ?? null)} />
        {run?.dateiInfo[P.key] && <span className="o-help" aria-live="polite">{run.dateiInfo[P.key]}</span>}
      </>); break;
    default: ctl = <input type="text" {...common} placeholder={P.placeholder} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />;
  }
  return (
    <div className={`o-field ${err ? "err" : ""}`} data-key={P.key}>
      <label htmlFor={id}>{P.label}{req}</label>
      {ctl}{help}
      {err && <span className="o-err" id={`${id}-fehler`}>Bitte ausfüllen.</span>}
    </div>
  );
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
      // KI-Buttons tragen das KI-Gelb, solange keine eigene Farbe gewählt ist.
      const c = b.props.color || "var(--signal)";
      const ink = b.props.color ? inkFor(b.props.color) : "var(--signal-ink)";
      const laeuft = run?.laeuft === b.id;
      return (
        <div className="o-btn-row" style={{ justifyContent: b.props.align === "center" ? "center" : b.props.align === "right" ? "flex-end" : "flex-start" }}>
          <button type="button" className={`o-btn ${b.props.stil === "outline" ? "outline" : ""}`} style={{ "--btn": c, "--btn-ink": ink } as CSSProperties}
            disabled={mode === "edit" || (!!run?.laeuft && !laeuft)} tabIndex={mode === "edit" ? -1 : undefined}
            onClick={() => run?.starten(b.id, b.props.aktion)} aria-keyshortcuts={mode === "run" ? "Control+Enter" : undefined} title={mode === "run" ? "Strg+Enter startet den ersten KI-Button" : undefined}>
            {laeuft ? "Stoppen" : b.props.text}
          </button>
        </div>
      );
    }
    case "output":
      return <OutputView app={app} titel={b.props.titel} stepId={b.props.quelle} stil={b.props.stil} mode={mode} />;
    default:
      return <Field b={b} mode={mode} />;
  }
}
