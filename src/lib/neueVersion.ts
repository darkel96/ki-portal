/**
 * Nach einem Deployment fehlen einem noch offenen Tab die alten Programmteile (z. B. „BuilderPage-<hash>.js“):
 * Der Server hat nur noch die neuen. Ein Seitenwechsel, der so ein Teil nachlädt, scheitert dann. Der Hub erkennt
 * das und lädt sich einmal neu (höchstens alle 30 Sekunden, damit ein echtes Netzproblem keine Schleife auslöst).
 */
const MARKE = "kihub-neu-geladen";

export const istVersionsFehler = (e: unknown): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .* failed/i
    .test(e instanceof Error ? e.message : String(e ?? ""));

/** Lädt die Seite neu, wenn das nicht gerade erst passiert ist; gibt zurück, ob neu geladen wird */
export function neuLadenFuerNeueVersion(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(MARKE) || 0) < 30_000) return false;
    sessionStorage.setItem(MARKE, String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}

/** Für lazy(): Scheitert das Nachladen einer Seite an einer neuen Version, lädt der Hub neu, statt einen Fehler zu zeigen */
export function nachladen<T>(laden: () => Promise<T>): () => Promise<T> {
  return () => laden().catch((e) => {
    if (istVersionsFehler(e) && neuLadenFuerNeueVersion()) return new Promise<T>(() => {});
    throw e;
  });
}
