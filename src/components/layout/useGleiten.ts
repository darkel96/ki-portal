import { useLayoutEffect, useRef } from "react";

const KURVE = "cubic-bezier(.2,.7,.2,1)";

/**
 * Kacheln gleiten beim Filtern an ihren neuen Platz (wie im KSCA-Portal „Charlestown“):
 * Gebliebene gleiten per transform von der alten Stelle, neue blenden ein, wegfallende blenden als Abbild aus.
 * Kinder mit data-gleiten="<id>" nehmen teil. Wechselt das Raster selbst (anderes Blatt), wird nicht animiert.
 * Bewegt wird nur, wenn sich der Anlass ändert (Bereichswechsel), nicht bei jedem neuen Stand (Tippen in der Suche).
 * Zeiten wie in Charlestown (/opt/ki-portal/index.html, gleiten()).
 */
export function useGleiten(ref: React.RefObject<HTMLElement | null>, ausloeser: unknown, anlass: unknown) {
  const vorher = useRef<{ feld: HTMLElement | null; anlass: unknown; stand: Map<string, { rect: DOMRect; abbild: HTMLElement }> }>({ feld: null, anlass: undefined, stand: new Map() });
  useLayoutEffect(() => {
    const feld = ref.current;
    if (!feld) return;
    // Abbilder eines noch laufenden Wechsels zuerst wegräumen
    feld.querySelectorAll(":scope > [data-geist]").forEach((g) => g.remove());
    const kinder = [...feld.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.gleiten);
    const jetzt = new Map(kinder.map((el) => [el.dataset.gleiten!, { rect: el.getBoundingClientRect(), abbild: el.cloneNode(true) as HTMLElement }]));
    const alt = vorher.current.feld === feld ? vorher.current.stand : new Map();
    const gewechselt = vorher.current.feld === feld && vorher.current.anlass !== anlass;
    vorher.current = { feld, anlass, stand: jetzt };
    if (!gewechselt || !alt.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const el of kinder) {
      const a = alt.get(el.dataset.gleiten!)?.rect, n = jetzt.get(el.dataset.gleiten!)!.rect;
      if (!a) el.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 140, easing: "ease-out", fill: "backwards" });
      else if (a.left !== n.left || a.top !== n.top) el.animate([{ transform: `translate(${a.left - n.left}px, ${a.top - n.top}px)` }, { transform: "none" }], { duration: 380, easing: KURVE });
    }
    const box = feld.getBoundingClientRect();
    for (const [id, { rect, abbild }] of alt) {
      if (jetzt.has(id)) continue;
      Object.assign(abbild.style, { position: "absolute", left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none" });
      abbild.removeAttribute("data-gleiten");
      abbild.setAttribute("data-geist", "");
      abbild.setAttribute("aria-hidden", "true");
      abbild.inert = true;
      feld.appendChild(abbild);
      abbild.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.97)" }], { duration: 180, easing: "ease-in" }).onfinish = () => abbild.remove();
    }
  }, [ref, ausloeser, anlass]);
}
