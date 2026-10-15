import { useState } from "react";
import { Check, X } from "lucide-react";

export type FuehrungsSchritt = { titel: string; erledigt: boolean; los: () => void };
const LS = "kihub-fuehrung-aus";

/**
 * Geführter Start für neue Applikationen: vier Schritte bis zur fertigen App, der nächste offene ist hervorgehoben.
 * Ausblendbar (merkt sich der Browser); bei gespeicherten Apps gar nicht sichtbar.
 */
export function Fuehrung({ schritte }: { schritte: FuehrungsSchritt[] }) {
  const [aus, setAus] = useState(() => { try { return localStorage.getItem(LS) === "1"; } catch { return false; } });
  if (aus) return null;
  const naechster = schritte.findIndex((s) => !s.erledigt);
  return (
    <nav className="fuehrung" aria-label="So entsteht deine Applikation">
      <span className="fuehrung-titel">So geht’s</span>
      <ol>
        {schritte.map((s, i) => (
          <li key={s.titel} data-erledigt={s.erledigt || undefined} aria-current={i === naechster ? "step" : undefined}>
            <button type="button" onClick={s.los}>
              <span className="fuehrung-nr" aria-hidden="true">{s.erledigt ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
              <span className="fuehrung-text">{s.titel}</span>
              {s.erledigt && <span className="sr-only"> (erledigt)</span>}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="fuehrung-x" aria-label="Hilfe ausblenden" title="Ausblenden"
        onClick={() => { setAus(true); try { localStorage.setItem(LS, "1"); } catch { /* egal */ } }}><X size={14} /></button>
    </nav>
  );
}
