import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Blättern statt Scrollen: Zurück, Seitenpunkte, Weiter.
 * Die Farben kommen aus currentColor bzw. --pg-accent, damit der Pager auch in gestalteten Apps passt.
 */
export function Pager({ seite, anzahl, titel, onWechsel, onWeiter, label = "Seite", mehrzahl = `${label}n`, weiter, weiterKurz, ende, onEnde, weiterGesperrt, onGesperrt, erreichbar, className = "" }: {
  seite: number;
  anzahl: number;
  titel?: (i: number) => string;
  onWechsel: (i: number) => void;
  /** Eigene Aktion für die Weiter-Schaltfläche (z. B. Ergebnisse erstellen); Punkte und Tasten blättern nur */
  onWeiter?: () => void;
  label?: string;
  /** Mehrzahl für die Beschriftung der Navigation („Ergebnisse blättern“) */
  mehrzahl?: string;
  /** Eigener Text für „Weiter“, z. B. der Titel der nächsten Seite */
  weiter?: string;
  /** Kurzfassung davon für schmale Bildschirme (sonst „Weiter“) */
  weiterKurz?: string;
  /** Auf der letzten Seite statt eines ausgegrauten „Weiter“: eigene Aktion, z. B. „Alle Ergebnisse“ */
  ende?: string;
  onEnde?: () => void;
  /** „Weiter“ ausgegraut, solange z. B. die KI die Felder der nächsten Seite noch ausfüllt */
  weiterGesperrt?: string;
  /** Klick auf das gesperrte „Weiter“: z. B. zu den fehlenden Pflichtfeldern führen. Ohne Angabe ist der Knopf ganz deaktiviert. */
  onGesperrt?: () => void;
  /** Punkt anklickbar? Ohne Angabe alle; gesperrte Punkte sind ausgegraut */
  erreichbar?: (i: number) => boolean;
  className?: string;
}) {
  if (anzahl <= 1) return null;
  const name = (i: number) => titel?.(i) || `${label} ${i + 1}`;
  return (
    <nav className={`pager ${className}`} aria-label={`${mehrzahl} blättern`}>
      {seite > 0
        ? <button type="button" className="pg-btn" onClick={() => onWechsel(seite - 1)}><ChevronLeft aria-hidden="true" size={16} /> Zurück</button>
        : <span className="pg-platz" aria-hidden="true" />}
      <div className="pager-mitte">
        {anzahl <= 12 && (
          <div className="dots">
            {Array.from({ length: anzahl }, (_, i) => (
              <button key={i} type="button" aria-label={titel ? `${label} ${i + 1}: ${name(i)}` : name(i)} aria-current={i === seite ? "step" : undefined}
                disabled={erreichbar ? !erreichbar(i) : undefined} title={erreichbar && !erreichbar(i) ? "Erst die Seiten davor ausfüllen" : undefined} onClick={() => onWechsel(i)} />
            ))}
          </div>
        )}
        <span className="pager-text" aria-live="polite">
          {titel ? <><b>{name(seite)}</b><span>{seite + 1} von {anzahl}</span></> : <span>{label} {seite + 1} von {anzahl}</span>}
        </span>
      </div>
      {seite < anzahl - 1 ? (
        <button type="button" className="pg-btn primaer" disabled={!!weiterGesperrt && !onGesperrt} title={weiterGesperrt || undefined} aria-disabled={!!weiterGesperrt || undefined}
          onClick={() => (weiterGesperrt ? onGesperrt?.() : onWeiter ? onWeiter() : onWechsel(seite + 1))}>
          {weiter
            ? <><span className="pg-weiter pg-lang">{weiter}</span><span className="pg-kurz">{weiterKurz ?? "Weiter"}</span></>
            : <span className="pg-weiter">Weiter</span>} <ChevronRight aria-hidden="true" size={16} />
        </button>
      ) : ende && onEnde ? (
        // Letzte Seite: kein ausgegrautes „Weiter“, sondern der Weg zurück zur Übersicht
        <button type="button" className="pg-btn" onClick={onEnde}><LayoutGrid aria-hidden="true" size={16} /> <span className="pg-weiter">{ende}</span></button>
      ) : <span className="pg-platz" aria-hidden="true" />}
    </nav>
  );
}

/** Seitenwechsel als reine Überblendung (nur opacity, ease-out, 200 ms). */
export function Blatt({ id, children, className, innerRef, "aria-label": label }: { id: string | number; children: ReactNode; className?: string; innerRef?: React.Ref<HTMLDivElement>; "aria-label"?: string }) {
  const ruhig = useReducedMotion();
  return (
    <motion.div key={id} ref={innerRef} className={className} tabIndex={-1} role={label ? "region" : undefined} aria-label={label}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: ruhig ? 0 : 0.2, ease: "easeOut" }}>
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
