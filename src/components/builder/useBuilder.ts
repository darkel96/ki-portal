import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { App } from "@/lib/schema";
import { locate } from "@/lib/model";

const MAX = 80;

export type Builder = ReturnType<typeof useBuilder>;

/**
 * Zustand des Baukastens mit Verlauf. Tippen im selben Feld wird zu einem Verlaufsschritt zusammengefasst.
 * startDirty: Entwurf (aus „Neue Applikation“ oder als Kopie), der noch nie gespeichert wurde.
 */
export function useBuilder(initial: App, startDirty = false) {
  const [app, setAppState] = useState<App>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(startDirty);
  /** Immer der neueste Stand, auch in alten Closures (z. B. nach einer langen KI-Anfrage). */
  const appRef = useRef<App>(initial);
  const undo = useRef<App[]>([]);
  const redo = useRef<App[]>([]);
  const typing = useRef<{ key: string; at: number } | null>(null);
  const [, force] = useState(0);

  // Nebenwirkungen (Verlauf, Tipp-Merker) außerhalb des State-Updaters: StrictMode ruft Updater doppelt auf.
  const setzen = useCallback((next: App) => {
    appRef.current = next;
    setAppState(next);
    setDirty(true);
    force((n) => n + 1);
  }, []);

  const change = useCallback((mut: (draft: App) => void, coalesce?: string) => {
    const prev = appRef.current;
    const now = Date.now();
    const same = coalesce && typing.current && typing.current.key === coalesce && now - typing.current.at < 1500;
    if (!same) {
      undo.current.push(prev);
      if (undo.current.length > MAX) undo.current.shift();
      redo.current = [];
    }
    typing.current = coalesce ? { key: coalesce, at: now } : null;
    const next = structuredClone(prev);
    mut(next);
    setzen(next);
  }, [setzen]);

  const replace = useCallback((next: App) => {
    undo.current.push(appRef.current);
    if (undo.current.length > MAX) undo.current.shift();
    redo.current = [];
    typing.current = null;
    setzen(next);
  }, [setzen]);

  const move = useCallback((from: React.MutableRefObject<App[]>, to: React.MutableRefObject<App[]>) => {
    const target = from.current.pop();
    if (!target) return;
    to.current.push(appRef.current);
    typing.current = null;
    setSel((s) => (s && locate(target.blocks, s) ? s : null));
    setzen(target);
  }, [setzen]);

  const aktuell = useCallback(() => appRef.current, []);

  return {
    app, sel, setSel, dirty, setDirty, change, replace, aktuell,
    undo: () => move(undo, redo), redo: () => move(redo, undo),
    canUndo: undo.current.length > 0, canRedo: redo.current.length > 0,
  };
}

/** Nach dem Löschen: „Rückgängig“ stellt den Stand von vorher wieder her, auch wenn inzwischen weitergearbeitet wurde. */
export function geloeschtToast(b: Builder, vorher: App, text: string, danach?: () => void) {
  toast(text, { action: { label: "Rückgängig", onClick: () => { b.replace(vorher); danach?.(); } } });
}
