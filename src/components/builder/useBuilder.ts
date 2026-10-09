import { useCallback, useRef, useState } from "react";
import type { App } from "@/lib/schema";
import { locate } from "@/lib/model";

const MAX = 80;

export type Builder = ReturnType<typeof useBuilder>;

/** Zustand des Baukastens mit Verlauf. Tippen im selben Feld wird zu einem Verlaufsschritt zusammengefasst. */
export function useBuilder(initial: App) {
  const [app, setApp] = useState<App>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const undo = useRef<App[]>([]);
  const redo = useRef<App[]>([]);
  const typing = useRef<{ key: string; at: number } | null>(null);
  const [, force] = useState(0);

  const change = useCallback((mut: (draft: App) => void, coalesce?: string) => {
    setApp((prev) => {
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
      return next;
    });
    setDirty(true);
    force((n) => n + 1);
  }, []);

  const replace = useCallback((next: App) => {
    setApp((prev) => { undo.current.push(prev); redo.current = []; return next; });
    typing.current = null;
    setDirty(true);
    force((n) => n + 1);
  }, []);

  const move = useCallback((from: React.MutableRefObject<App[]>, to: React.MutableRefObject<App[]>) => {
    const target = from.current.pop();
    if (!target) return;
    setApp((cur) => { to.current.push(cur); return target; });
    setSel((s) => (s && locate(target.blocks, s) ? s : null));
    typing.current = null;
    setDirty(true);
    force((n) => n + 1);
  }, []);

  return {
    app, sel, setSel, dirty, setDirty, change, replace,
    undo: () => move(undo, redo), redo: () => move(redo, undo),
    canUndo: undo.current.length > 0, canRedo: redo.current.length > 0,
  };
}
