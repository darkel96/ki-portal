/**
 * Testmodus: Läuft der Hub als Artifact auf claude.ai, beantwortet Claude die Anfragen
 * anstelle von Copilot (über die Laufzeit-Funktion „sample“ des Viewers).
 * Im Betrieb (eigene Domain) gibt es window.claude nicht; dann greift dieser Weg nie.
 */
type SampleFn = (input: string, opts?: { signal?: AbortSignal; modelTier?: "quick" | "default" | "complex"; cache?: boolean }) => Promise<{ text: string; truncated?: boolean }>;
type ClaudeRuntime = { use: (name: string) => Promise<unknown> };

const runtime = (): ClaudeRuntime | undefined => (window as unknown as { claude?: ClaudeRuntime }).claude;

export const imClaudeViewer = () => typeof runtime()?.use === "function";

let sample: Promise<SampleFn | null> | null = null;
export function claudeSample(): Promise<SampleFn | null> {
  sample ??= imClaudeViewer() ? Promise.resolve(runtime()!.use("sample")).then((s) => (s as SampleFn) ?? null).catch(() => null) : Promise.resolve(null);
  return sample;
}

let downloads: Promise<{ save: (r: { filename: string; data: Blob | string }) => Promise<unknown> } | null> | null = null;
export function claudeDownloads() {
  downloads ??= imClaudeViewer() ? Promise.resolve(runtime()!.use("downloads")).then((d) => (d as never) ?? null).catch(() => null) : Promise.resolve(null);
  return downloads;
}

const FEHLER: Record<string, string> = {
  not_granted: "Die Nutzung von Claude wurde für diese Seite nicht erlaubt.",
  rate_limited: "Gerade sind zu viele Anfragen unterwegs. Versuch es in einer Minute noch einmal.",
  session_expired: "Deine Anmeldung bei Claude ist abgelaufen. Melde dich neu an.",
  refused: "Die KI hat diese Anfrage abgelehnt. Formuliere die Eingaben anders.",
  prompt_too_large: "Die Anfrage ist zu lang. Kürze die Eingaben.",
};

export async function claudeFragen(text: string, opts: { signal?: AbortSignal; modell?: "quick" | "default" | "complex" } = {}): Promise<string> {
  const s = await claudeSample();
  if (!s) throw new Error("Claude ist in dieser Ansicht nicht verfügbar.");
  try {
    const r = await s(text, { signal: opts.signal, modelTier: opts.modell ?? "default", cache: false });
    return r.text;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code === "cancelled") throw new DOMException("abgebrochen", "AbortError");
    throw new Error(FEHLER[code] ?? "Die Verbindung zur KI ist abgebrochen. Starte erneut.");
  }
}
