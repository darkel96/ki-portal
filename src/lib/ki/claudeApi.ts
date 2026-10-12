/**
 * Testmodus mit eigenem API-Schlüssel: Für die öffentliche Testseite (GitHub Pages) trägt jede Person
 * ihren eigenen Anthropic-API-Schlüssel ein. Er bleibt im Browser dieser Person und geht nur an api.anthropic.com.
 * Im Betrieb läuft alles über die zentrale Azure-Anwendung (Copilot); dort wird dieser Weg nicht genutzt.
 */
import type Anthropic from "@anthropic-ai/sdk";

type Sdk = typeof import("@anthropic-ai/sdk");
let sdk: Sdk | null = null;
/** Das SDK (rund 300 KB) erst laden, wenn wirklich jemand mit eigenem Schlüssel arbeitet. */
const sdkLaden = async (): Promise<Sdk> => (sdk ??= await import("@anthropic-ai/sdk"));

const SCHLUESSEL = "kihub-anthropic-key";
const MODELL = "claude-opus-5-5";
/** „Modell“ eines KI-Schritts → Denktiefe (dasselbe Modell, unterschiedlich gründlich) */
const AUFWAND = { quick: "low", default: "medium", complex: "high" } as const;

/** Schlüssel lesen: dauerhaft (localStorage) oder nur für diese Sitzung (sessionStorage). */
export function apiSchluessel(): string {
  try { return sessionStorage.getItem(SCHLUESSEL) || localStorage.getItem(SCHLUESSEL) || ""; } catch { return ""; }
}
export function apiSchluesselSetzen(wert: string, merken: boolean) {
  try {
    localStorage.removeItem(SCHLUESSEL);
    sessionStorage.removeItem(SCHLUESSEL);
    if (wert.trim()) (merken ? localStorage : sessionStorage).setItem(SCHLUESSEL, wert.trim());
  } catch { /* Speicher gesperrt */ }
  client = null;
}
export const apiSchluesselGemerkt = () => { try { return !!localStorage.getItem(SCHLUESSEL); } catch { return false; } };

let client: Anthropic | null = null;
async function anthropic(): Promise<Anthropic> {
  const { default: Anthropic } = await sdkLaden();
  // Bewusst im Browser: Der Schlüssel gehört der Person, die ihn eingetragen hat, und verlässt ihren Browser nur Richtung Anthropic.
  client ??= new Anthropic({ apiKey: apiSchluessel(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  return client;
}

export async function claudeApiFragen(text: string, opts: { signal?: AbortSignal; modell?: "quick" | "default" | "complex"; onTeil?: (text: string) => void } = {}): Promise<string> {
  if (!apiSchluessel()) throw new Error("Kein API-Schlüssel eingetragen.");
  const A = (await sdkLaden()).default;
  try {
    const stream = (await anthropic()).beta.messages.stream({
      model: MODELL,
      max_tokens: 64000,
      output_config: { effort: AUFWAND[opts.modell ?? "default"] },
      // Lehnt das Modell aus Sicherheitsgründen ab, übernimmt serverseitig ein passendes anderes Modell.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: text }],
    }, { signal: opts.signal });
    if (opts.onTeil) { let bisher = ""; stream.on("text", (stueck) => { bisher += stueck; opts.onTeil!(bisher); }); }
    const antwort = await stream.finalMessage();
    if (antwort.stop_reason === "refusal") throw new Error("Die KI hat diese Anfrage abgelehnt. Formuliere die Eingaben anders.");
    const ergebnis = antwort.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!ergebnis) throw new Error("Die KI hat keine Antwort geliefert. Versuch es noch einmal.");
    return antwort.stop_reason === "max_tokens" ? `${ergebnis}\n\n_(Die Antwort wurde wegen ihrer Länge abgeschnitten.)_` : ergebnis;
  } catch (e) {
    if (e instanceof A.APIUserAbortError || opts.signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
    if (e instanceof A.AuthenticationError) throw new Error("Der API-Schlüssel ist ungültig. Prüfe ihn im KI-Menü oben rechts.");
    if (e instanceof A.PermissionDeniedError) throw new Error("Dieser API-Schlüssel darf das Modell nicht nutzen.");
    if (e instanceof A.RateLimitError) throw new Error("Gerade sind zu viele Anfragen unterwegs oder das Guthaben ist aufgebraucht. Versuch es gleich noch einmal.");
    if (e instanceof A.BadRequestError) {
      // Nur die Klartext-Meldung aus dem Antworttext zeigen, nicht das rohe JSON.
      const text = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      // Leeres Guthaben kommt als 400 ohne eigenen Fehlertyp; deshalb hier am Meldungstext erkannt.
      if (/credit balance/i.test(text)) throw new Error("Das Guthaben deines Anthropic-Kontos reicht nicht. Lade unter console.anthropic.com → Plans & Billing Guthaben auf und starte dann erneut. (Ein claude.ai-Abo zählt dafür nicht.)");
      throw new Error(`Die Anfrage wurde abgelehnt: ${text}`);
    }
    if (e instanceof A.APIConnectionError) throw new Error("Keine Verbindung zu Anthropic. Prüfe die Internetverbindung.");
    if (e instanceof A.APIError) throw new Error(`Fehler bei Anthropic (${e.status ?? "?"}). Versuch es noch einmal.`);
    throw e;
  }
}
