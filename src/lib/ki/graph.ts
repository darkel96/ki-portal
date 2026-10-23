/** Gemeinsames für Microsoft-Graph-Aufrufe aus dem Browser: Erreichbarkeit und der Ersatz-Token der Tests. */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { kiModus } from "./index";

/** Nur in der Entwicklung: Tests legen hier ein Ersatz-Token ab und fangen Graph mit einer Attrappe ab. */
export const graphTestToken = (): string | null => { try { return import.meta.env.DEV ? localStorage.getItem("kihub-graph-test") : null; } catch { return null; } };

/** Ob Graph aus diesem Browser erreichbar ist (Copilot-Anmeldung oder Test-Token) */
export const graphErreichbar = () => kiModus() === "copilot" || !!graphTestToken();

/** Token für die genannten Berechtigungen (Test-Token hat Vorrang) */
export const graphTokenFuer = async (scopes: string[]): Promise<string> => graphTestToken() ?? graphToken(scopes);

/** GET mit Token; wirft bei Fehlern eine verständliche Meldung */
export async function graphGet<T>(pfad: string, scopes: string[], signal?: AbortSignal, prefer?: string): Promise<T> {
  const token = await graphTokenFuer(scopes);
  const r = await fetch(pfad.startsWith("http") ? pfad : `${KI_CONFIG.graph}${pfad}`, { signal, headers: { Authorization: `Bearer ${token}`, ...(prefer ? { Prefer: prefer } : {}) } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
    throw new Error(r.status === 403 ? `Kein Zugriff (Berechtigung ${scopes.map((s) => s.split("/").pop()).join(", ")} fehlt oder wurde nicht zugestimmt).` : r.status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden." : `Graph antwortet mit Fehler ${r.status}${code ? ` (${code})` : ""}.`);
  }
  return (await r.json()) as T;
}
