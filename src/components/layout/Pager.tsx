import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Blättern statt Scrollen: Zurück, Seitenpunkte, Weiter.
 * Die Farben kommen aus currentColor bzw. --pg-accent, damit der Pager auch in gestalteten Apps passt.
 */
export function Pager({ seite, anzahl, titel, onWechsel, label = "Seite", weiter, className = "" }: {
  seite: number;
  anzahl: number;
  titel?: (i: number) => string;
  onWechsel: (i: number) => void;
  label?: string;
  /** Eigener Text für „Weiter“, z. B. der Titel der nächsten Seite */
  weiter?: string;
  className?: string;
}) {
  if (anzahl <= 1) return null;
  const name = (i: number) => titel?.(i) || `${label} ${i + 1}`;
  return (
    <nav className={`pager ${className}`} aria-label={`${label}n blättern`}>
      <button type="button" className="pg-btn" onClick={() => onWechsel(seite - 1)} disabled={seite === 0}>
        <ChevronLeft aria-hidden="true" size={16} /> Zurück
      </button>
      <div className="pager-mitte">
        {anzahl <= 12 && (
          <div className="dots">
            {Array.from({ length: anzahl }, (_, i) => (
              <button key={i} type="button" aria-label={`${label} ${i + 1}: ${name(i)}`} aria-current={i === seite ? "true" : undefined} onClick={() => onWechsel(i)} />
            ))}
          </div>
        )}
        <span className="pager-text" aria-live="polite">
          {titel ? <><b>{name(seite)}</b><span>{seite + 1} von {anzahl}</span></> : <span>{label} {seite + 1} von {anzahl}</span>}
        </span>
      </div>
      <button type="button" className="pg-btn primaer" onClick={() => onWechsel(seite + 1)} disabled={seite === anzahl - 1}>
        {weiter && seite < anzahl - 1
          ? <><span className="pg-weiter pg-lang">{weiter}</span><span className="pg-kurz">Weiter</span></>
          : <span className="pg-weiter">Weiter</span>} <ChevronRight aria-hidden="true" size={16} />
      </button>
    </nav>
  );
}

/** Seitenwechsel als reine Überblendung (nur opacity, ease-out, 200 ms). */
export function Blatt({ id, children, className, innerRef, "aria-label": label }: { id: string | number; children: ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement>; "aria-label"?: string }) {
  return (
    <motion.div key={id} ref={innerRef} className={className} tabIndex={-1} role={label ? "region" : undefined} aria-label={label}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}

/** Blättern mit Bild↓/Bild↑, solange kein Eingabefeld den Fokus hat. */
export function blaetterTaste(e: React.KeyboardEvent | KeyboardEvent, seite: number, anzahl: number, wechsel: (i: number) => void) {
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
  if (e.key === "PageDown" && seite < anzahl - 1) { e.preventDefault(); wechsel(seite + 1); }
  else if (e.key === "PageUp" && seite > 0) { e.preventDefault(); wechsel(seite - 1); }
}
