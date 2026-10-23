/** Einstellungen des Hub-Dienstes aus der Umgebung (siehe server/.env.example) */
import { COPILOT_SCOPES } from "@/lib/ki/config";

const env = process.env;
const ja = (v: string | undefined) => /^(1|true|ja)$/i.test(v ?? "");
const clientId = String(env.HUB_CLIENT_ID ?? "").trim();

export const UMGEBUNG = {
  version: String(env.HUB_VERSION ?? "entwicklung"),
  port: Number(env.HUB_PORT) || 8787,
  /** Verzeichnis für Läufe, Aufträge und Anmeldungen */
  daten: env.HUB_DATEN || "./daten",
  /** Testmodus: keine Microsoft-Anmeldung, Copilot-Attrappe, Testnutzer über „Bearer test:<name>“ */
  testmodus: ja(env.HUB_TESTMODUS),
  /** Verzeichnis mit dem gebauten Hub (dist); leer = der Dienst liefert nur die API */
  statisch: env.HUB_STATISCH || "",
  tenantId: String(env.HUB_TENANT_ID ?? "").trim(),
  clientId,
  clientSecret: String(env.HUB_CLIENT_SECRET ?? "").trim(),
  /** Berechtigung, die der Hub im Browser für den Dienst anfordert (unter „Expose an API“ der App-Registrierung) */
  apiScope: env.HUB_API_SCOPE || (clientId ? `api://${clientId}/Laeufe.Ausfuehren` : ""),
  /** Graph-Berechtigungen, die der Dienst im Namen der Person braucht (Copilot plus Zustellung per E-Mail und Teams) */
  graphScopes: String(env.HUB_GRAPH_SCOPES ?? "").split(/\s+/).filter(Boolean).length
    ? String(env.HUB_GRAPH_SCOPES).split(/\s+/).filter(Boolean)
    : [...COPILOT_SCOPES, "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Chat.ReadWrite", "https://graph.microsoft.com/ChatMessage.Send",
      "https://graph.microsoft.com/Calendars.Read", "https://graph.microsoft.com/Team.ReadBasic.All", "https://graph.microsoft.com/Channel.ReadBasic.All"],
  /** Erlaubte Ursprünge (CORS), mit Komma; leer = nur derselbe Ursprung (Hub wird vom Dienst ausgeliefert) */
  urspruenge: String(env.HUB_URSPRUNG ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Verzögerung der Attrappe je Antwort (Testmodus) */
  attrappeMs: Number(env.HUB_ATTRAPPE_MS) || 1500,
  /** Gleichzeitige Läufe im Dienst */
  parallel: Number(env.HUB_PARALLEL) || 3,
  /** Läufe so viele Tage aufbewahren */
  aufbewahrungTage: Number(env.HUB_AUFBEWAHRUNG_TAGE) || 30,
  /** Schlüssel (64 Hex-Zeichen) für gespeicherte Anmeldungen; fehlt er, legt der Dienst einen unter HUB_DATEN an */
  schluessel: String(env.HUB_SCHLUESSEL ?? "").trim(),
};

export function umgebungPruefen(): string[] {
  const fehler: string[] = [];
  if (!UMGEBUNG.testmodus) {
    if (!UMGEBUNG.tenantId) fehler.push("HUB_TENANT_ID fehlt.");
    if (!UMGEBUNG.clientId) fehler.push("HUB_CLIENT_ID fehlt.");
    if (!UMGEBUNG.clientSecret) fehler.push("HUB_CLIENT_SECRET fehlt (Client-Geheimnis oder Zertifikat der App-Registrierung).");
  }
  return fehler;
}
