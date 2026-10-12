import { useEffect, useState } from "react";

/**
 * Wie viele Kacheln passen ohne Scrollen in eine Fläche?
 * Liefert Spalten, Zeilen, Zeilenhöhe und Abstand; die Fläche wird bei jeder Größenänderung neu gemessen.
 * Mit abstand > 0 stehen die Kacheln als einzelne Karten mit Lücke dazwischen.
 */
export function useRaster(ref: React.RefObject<HTMLDivElement | null>, opt: { breite?: number; hoehe?: number; breiteSchmal?: number; hoeheSchmal?: number; maxHoehe?: number; abstand?: number; abstandSchmal?: number } = {}) {
  const { breite = 250, hoehe: minHoehe = 250, breiteSchmal = 280, hoeheSchmal = 108, maxHoehe = Infinity, abstand: abstandBreit = 0, abstandSchmal = 0 } = opt;
  const [r, setR] = useState({ spalten: 3, zeilen: 2, hoehe: 210, abstand: abstandBreit });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const messen = () => {
      // Innenabstand der Fläche (Platz für Schatten der Karten) abziehen
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const schmal = w < 520;
      const abstand = schmal ? abstandSchmal : abstandBreit;
      const spalten = Math.max(1, Math.floor((w + 1 + abstand) / ((schmal ? breiteSchmal : breite) + abstand)));
      const minH = schmal ? hoeheSchmal : minHoehe;
      const zeilen = Math.max(1, Math.floor((h + abstand) / (minH + abstand)));
      // Karten füllen die Höhe, werden aber nicht beliebig hoch (sonst viel Leerraum in der Karte)
      const hoehe = Math.max(minH, Math.min(schmal ? Infinity : maxHoehe, Math.floor((h - 1 - abstand * (zeilen - 1)) / zeilen)));
      setR((alt) => (alt.spalten === spalten && alt.zeilen === zeilen && alt.hoehe === hoehe && alt.abstand === abstand ? alt : { spalten, zeilen, hoehe, abstand }));
    };
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    messen();
    return () => ro.disconnect();
  }, [ref, breite, minHoehe, breiteSchmal, hoeheSchmal, maxHoehe, abstandBreit, abstandSchmal]);
  return r;
}
