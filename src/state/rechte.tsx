import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { App } from "@/lib/schema";
import { darfAppBearbeiten, darfAppNutzen, identitaetLaden, nutzerVermerken, rechteStore, rechteVon, type Identitaet, type Recht, type RechteStand } from "@/lib/rechte";

type RechteCtx = {
  /** angemeldete Person; null ohne Anmeldung (dann keine Einschränkungen) */
  ich: Identitaet | null;
  stand: RechteStand;
  geladen: boolean;
  speicherName: string;
  darf: (r: Recht) => boolean;
  istAdmin: boolean;
  darfApp: (app: Pick<App, "rechte" | "erstelltVon">, art: "bearbeiten" | "nutzen") => boolean;
  /** Stand ändern (nur Verwaltung) und speichern */
  speichern: (s: RechteStand) => Promise<void>;
  /** Anmeldung hat sich geändert: Person und Rechte neu laden */
  neuLaden: () => Promise<void>;
};
const Ctx = createContext<RechteCtx | null>(null);

export function RechteProvider({ children }: { children: ReactNode }) {
  const [ich, setIch] = useState<Identitaet | null>(null);
  const [stand, setStand] = useState<RechteStand>({ nutzer: [] });
  const [geladen, setGeladen] = useState(false);

  const neuLaden = useCallback(async () => {
    const person = await identitaetLaden();
    let s: RechteStand = { nutzer: [] };
    try { s = await rechteStore.laden(); } catch (e) { console.warn("Rechte nicht geladen:", e); }
    // Angemeldete Person in die Liste aufnehmen, damit die Verwaltung sie sieht
    if (person) {
      const neu = nutzerVermerken(s, person);
      if (neu) { s = neu; rechteStore.speichern(neu).catch((e) => console.warn("Anmeldung nicht vermerkt:", e)); }
    }
    setIch(person); setStand(s); setGeladen(true);
  }, []);
  useEffect(() => { void neuLaden(); }, [neuLaden]);

  const rechte = useMemo(() => rechteVon(ich, stand), [ich, stand]);
  const speichern = useCallback(async (s: RechteStand) => { await rechteStore.speichern(s); setStand(s); }, []);
  const value = useMemo<RechteCtx>(() => ({
    ich, stand, geladen, speicherName: rechteStore.name,
    darf: (r) => rechte.has(r), istAdmin: rechte.has("admin"),
    darfApp: (app, art) => (art === "bearbeiten" ? darfAppBearbeiten(app, ich, rechte) : darfAppNutzen(app, ich, rechte)),
    speichern, neuLaden,
  }), [ich, stand, geladen, rechte, speichern, neuLaden]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRechte(): RechteCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRechte außerhalb von RechteProvider");
  return c;
}
