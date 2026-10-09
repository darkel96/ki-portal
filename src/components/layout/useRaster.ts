import { useEffect, useState } from "react";

/**
 * Wie viele Kacheln passen ohne Scrollen in eine Fläche?
 * Liefert Spalten, Zeilen und die Zeilenhöhe; die Fläche wird bei jeder Größenänderung neu gemessen.
 */
export function useRaster(ref: React.RefObject<HTMLDivElement | null>, opt: { breite?: number; hoehe?: number; breiteSchmal?: number; hoeheSchmal?: number } = {}) {
  const { breite = 250, hoehe: minHoehe = 250, breiteSchmal = 280, hoeheSchmal = 108 } = opt;
  const [r, setR] = useState({ spalten: 3, zeilen: 2, hoehe: 210 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const messen = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const schmal = w < 520;
      const spalten = Math.max(1, Math.floor((w + 1) / (schmal ? breiteSchmal : breite)));
      const minH = schmal ? hoeheSchmal : minHoehe;
      const zeilen = Math.max(1, Math.floor(h / minH));
      const hoehe = Math.max(minH, Math.floor((h - 1) / zeilen));
      setR((alt) => (alt.spalten === spalten && alt.zeilen === zeilen && alt.hoehe === hoehe ? alt : { spalten, zeilen, hoehe }));
    };
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    messen();
    return () => ro.disconnect();
  }, [ref, breite, minHoehe, breiteSchmal, hoeheSchmal]);
  return r;
}
