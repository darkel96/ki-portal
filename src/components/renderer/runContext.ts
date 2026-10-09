import { createContext, useContext } from "react";
import type { OutState, Werte } from "@/lib/runner";
import type { FileInfo } from "@/lib/request";

export type RunCtx = {
  werte: Werte;
  setWert: (key: string, v: string | boolean) => void;
  files: Record<string, FileInfo>;
  dateiInfo: Record<string, string>;
  setDatei: (key: string, f: File | null) => void;
  fehler: Set<string>;
  outs: Record<string, OutState>;
  /** ID des Buttons, dessen Ablauf gerade läuft */
  laeuft: string | null;
  starten: (buttonId: string, aktion: string) => void;
  /** Semantische Überschriften-Ebene je Baustein (keine übersprungenen Ebenen, erste Überschrift = h1) */
  ebenen: Record<string, number>;
};

export const RunContext = createContext<RunCtx | null>(null);
export const useRun = () => useContext(RunContext);
