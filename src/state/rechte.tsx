import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { App } from "@/lib/schema";
import { darfAppBearbeiten, darfAppNutzen, identitaetLaden, personenListe, rechteStore, rechteVon, type Identitaet, type Nutzer, type Recht, type RechteStand } from "@/lib/rechte";
import { speicherName } from "@/lib/speicher";

type RechteCtx = {
  /** angemeldete Person; null ohne Anmeldung (dann keine Einschränkungen) */
  ich: Identitaet | null;
  stand: RechteStand;
  /** Personen mit Rechten und alle, die sich angemeldet haben (für Verwaltung und Personenwahl) */
  personen: Nutzer[];
  geladen: boolean;
  speicherName: string;
  darf: (r: Recht) => boolean;
  istAdmin: boolean;
  darfApp: (app: Pick<App, "rechte" | "erstelltVon">, art: "bearbeiten" | "nutzen") => boolean;
  /** Stand ändern (nur Verwaltung) und speichern */
  speichern: (s: RechteStand) => Promise<void>;
  /** Anmeldung oder Speicher hat sich geändert: Person, Rechte und Personenliste neu laden */
  neuLaden: () => Promise<void>;
};
const Ctx = createContext<RechteCtx | null>(null);

export function RechteProvider({ children }: { children: ReactNode }) {
  const [ich, setIch] = useState<Identitaet | null>(null);
  const [stand, setStand] = useState<RechteStand>({ nutzer: [] });
  const [personen, setPersonen] = useState<Nutzer[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [name, setName] = useState("Dieser Browser");

  const neuLaden = useCallback(async () => {
    const person = await identitaetLaden();
    let s: RechteStand = { nutzer: [] };
    try { s = await rechteStore.laden(); } catch (e) { console.warn("Rechte nicht geladen:", e); }
    // Anmeldung vermerken (eigene Datei je Person), damit die Verwaltung sie sieht; Fehler ohne Folgen
    if (person) await rechteStore.vermerken(person).catch((e) => console.warn("Anmeldung nicht vermerkt:", e));
    // Personenliste nur für die, die sie brauchen (Verwaltung, Baukasten)
    const r = rechteVon(person, s);
    let anm: Awaited<ReturnType<typeof rechteStore.anmeldungen>> = [];
    if (r.has("admin") || r.has("bauen")) anm = await rechteStore.anmeldungen().catch(() => []);
    setIch(person); setStand(s); setPersonen(personenListe(s, anm)); setName(await speicherName()); setGeladen(true);
  }, []);
  useEffect(() => { void neuLaden(); }, [neuLaden]);

  const rechte = useMemo(() => rechteVon(ich, stand), [ich, stand]);
  const speichern = useCallback(async (s: RechteStand) => {
    await rechteStore.speichern(s);
    setStand(s);
    setPersonen((alt) => personenListe(s, alt.map(({ id, name: n, email, zuletzt }) => ({ id, name: n, email, zuletzt }))));
  }, []);
  const value = useMemo<RechteCtx>(() => ({
    ich, stand, personen, geladen, speicherName: name,
    darf: (r) => rechte.has(r), istAdmin: rechte.has("admin"),
    darfApp: (app, art) => (art === "bearbeiten" ? darfAppBearbeiten(app, ich, rechte) : darfAppNutzen(app, ich, rechte)),
    speichern, neuLaden,
  }), [ich, stand, personen, geladen, name, rechte, speichern, neuLaden]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRechte(): RechteCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRechte außerhalb von RechteProvider");
  return c;
}
