import type { CSSProperties } from "react";
import type { Theme } from "@/lib/schema";
import { inkFor } from "@/lib/model";

const FONTS: Record<Theme["font"], string> = { sans: "var(--k-font-body)", serif: '"Source Serif 4", Georgia, serif', display: "var(--k-font-display)", mono: "var(--k-font-mono)" };
const HEADS: Record<Theme["font"], string> = { sans: "var(--k-font-display)", serif: '"Source Serif 4", Georgia, serif', display: "var(--k-font-display)", mono: "var(--k-font-mono)" };
const RADIUS: Record<Theme["radius"], string> = { s: "0px", m: "4px", l: "14px" };
const WIDTH: Record<Theme["width"], string> = { s: "760px", m: "1600px", l: "100%" };

export function themeStyle(t: Theme): CSSProperties {
  const ink = inkFor(t.bg);
  return {
    "--app-accent": t.accent || "var(--brand)",
    "--app-accent-ink": inkFor(t.accent) ?? "var(--brand-ink)",
    "--app-font": FONTS[t.font],
    "--app-head": HEADS[t.font],
    "--app-radius": RADIUS[t.radius],
    "--app-max": WIDTH[t.width],
    "--app-bg": t.bg && ink ? t.bg : "var(--surface)",
    "--app-ink": t.bg && ink ? ink : "var(--ink)",
  } as CSSProperties;
}

export const TONES = { info: ["Info", "var(--app-accent)"], warn: ["Achtung", "var(--k-light-orange)"], ok: ["Tipp", "#3b7a2a"] } as const;
