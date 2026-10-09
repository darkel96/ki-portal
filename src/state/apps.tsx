import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { App, HubApp } from "@/lib/schema";
import { appStore } from "@/lib/store";
import { SEED_APPS } from "@/lib/seeds";

type AppsCtx = {
  apps: HubApp[];
  geladen: boolean;
  fehler: string | null;
  find: (id: string | undefined) => HubApp | undefined;
  save: (app: App) => Promise<App>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<AppsCtx | null>(null);

export function AppsProvider({ children }: { children: ReactNode }) {
  const [eigene, setEigene] = useState<App[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

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
    return [...own, ...SEED_APPS];
  }, [eigene]);

  const save = useCallback(async (app: App) => {
    const def: App = {
      ...app,
      id: app.id ?? `app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      version: (app.version || 0) + 1,
      geaendert: new Date().toISOString(),
      typ: "baukasten",
    };
    delete (def as Partial<HubApp>)._src;
    await appStore.save(def);
    setEigene((prev) => [...prev.filter((a) => a.id !== def.id), def]);
    return def;
  }, []);

  const remove = useCallback(async (id: string) => {
    await appStore.remove(id);
    setEigene((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const find = useCallback((id: string | undefined) => apps.find((a) => a.id === id), [apps]);

  return <Ctx.Provider value={{ apps, geladen, fehler, find, save, remove, reload }}>{children}</Ctx.Provider>;
}

export function useApps(): AppsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApps außerhalb von AppsProvider");
  return c;
}
