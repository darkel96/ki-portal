import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppSchema, type App, type HubApp } from "@/lib/schema";
import { appStore } from "@/lib/store";
import { SEED_APPS } from "@/lib/seeds";
import { useRechte } from "@/state/rechte";

type AppsCtx = {
  apps: HubApp[];
  geladen: boolean;
  fehler: string | null;
  find: (id: string | undefined) => HubApp | undefined;
  save: (app: App) => Promise<App>;
  /** In den Papierkorb (30 Tage wiederherstellbar) */
  remove: (id: string) => Promise<void>;
  wiederherstellen: (id: string) => Promise<App | null>;
  reload: () => Promise<void>;
};

const Ctx = createContext<AppsCtx | null>(null);

export function AppsProvider({ children }: { children: ReactNode }) {
  const [eigene, setEigene] = useState<App[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const { ich, stand } = useRechte();

  const reload = useCallback(async () => {
    try {
      setEigene(await appStore.list());
      setFehler(null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Die Applikationen konnten nicht geladen werden.");
    } finally {
      setGeladen(true);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const apps = useMemo<HubApp[]>(() => {
    const own = [...eigene].sort((a, b) => b.geaendert.localeCompare(a.geaendert)).map((a) => ({ ...a, _src: "eigene" as const }));
    // Eine übernommene Vorlage (eigene App mit derselben ID) ersetzt das mitgelieferte Original; ausgeblendete Vorlagen fehlen
    const weg = new Set(stand.ausgeblendet), eigeneIds = new Set(own.map((a) => a.id));
    return [...own, ...SEED_APPS.filter((a) => !weg.has(a.id ?? "") && !eigeneIds.has(a.id))];
  }, [eigene, stand.ausgeblendet]);

  const save = useCallback(async (app: App) => {
    const def: App = {
      ...app,
      name: app.name.trim().slice(0, 60),
      id: app.id ?? `app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      version: (app.version || 0) + 1,
      geaendert: new Date().toISOString(),
      typ: "baukasten",
      // Wer eine App anlegt, darf sie immer bearbeiten
      erstelltVon: app.erstelltVon || ich?.email || "",
    };
    delete (def as Partial<HubApp>)._src;
    // Nur speichern, was sich auch wieder laden lässt.
    const chk = AppSchema.safeParse(def);
    if (!chk.success) { const f = chk.error.issues[0]; throw new Error(`Die Applikation kann so nicht gespeichert werden (${f.path.join(".") || "Angabe"}: ${f.message}). Prüf die Angabe im Baukasten.`); }
    await appStore.save(def);
    setEigene((prev) => [...prev.filter((a) => a.id !== def.id), def]);
    return def;
  }, [ich]);

  const remove = useCallback(async (id: string) => {
    await appStore.remove(id);
    setEigene((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const wiederherstellen = useCallback(async (id: string) => {
    const app = await appStore.wiederherstellen(id);
    if (app) setEigene((prev) => [...prev.filter((a) => a.id !== app.id), app]);
    return app;
  }, []);

  const find = useCallback((id: string | undefined) => apps.find((a) => a.id === id), [apps]);

  return <Ctx.Provider value={{ apps, geladen, fehler, find, save, remove, wiederherstellen, reload }}>{children}</Ctx.Provider>;
}

export function useApps(): AppsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApps außerhalb von AppsProvider");
  return c;
}
