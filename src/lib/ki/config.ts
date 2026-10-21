/**
 * Zentrale Konfiguration des KI-Hubs. Gilt für alle Applikationen; Apps enthalten keine Verbindungsdaten.
 * Werte kommen aus Umgebungsvariablen (.env.local bzw. Build-Umgebung), siehe .env.example.
 * Zum Testen (z. B. auf der Testseite am Firmenrechner) lassen sich Client- und Tenant-ID auch im KI-Menü
 * eintragen; sie bleiben dann nur in diesem Browser. Werte aus der Build-Umgebung haben Vorrang.
 */
const env = import.meta.env;

/**
 * Delegierte Graph-Berechtigungen, die die Copilot-Chat-API verlangt (alle zusammen, sonst Fehler 403).
 * Stand Microsoft Learn „copilotroot post conversations“ (Beta); vor Inbetriebnahme abgleichen.
 */
export const COPILOT_SCOPES = [
  "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All",
  "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All",
].map((s) => `https://graph.microsoft.com/${s}`);

export const KI_CONFIG = {
  /** Microsoft Graph; der Hub-Dienst kann im Testmodus eine Attrappe davorsetzen */
  graph: "https://graph.microsoft.com",
  clientId: String(env.VITE_ENTRA_CLIENT_ID ?? "").trim(),
  tenantId: String(env.VITE_ENTRA_TENANT_ID ?? "").trim(),
  /** Delegierte Graph-Berechtigungen, durch Leerzeichen getrennt; ohne Angabe die der Copilot-Chat-API. */
  scopes: String(env.VITE_GRAPH_SCOPES ?? "").split(/\s+/).filter(Boolean),
  /** Gemeinsamer Speicher: Adresse eines SharePoint-Ordners wie im Browser; leer = Browser oder hub-config.json (siehe speicher.ts) */
  spOrdnerUrl: String(env.VITE_SP_ORDNER_URL ?? "").trim(),
  /** Ruhe-Limit: so lange darf Copilot nichts liefern (beim Streaming zählt jedes neue Stück als Lebenszeichen). */
  timeoutMs: 180_000,
  /**
   * Kommt so lange gar kein erstes Zeichen, hängt Copilot (die Beta-Schnittstelle bleibt gelegentlich stumm): einmal
   * in einem frischen Gespräch neu fragen. 90 s, weil eine langsame, aber funktionierende Antwort schon 62 s brauchte.
   */
  ersteZeichenMs: 90_000,
  /** Antwort ohne Streaming (am Stück): Gesamtzeit für lange Ergebnisse */
  timeoutMsAmStueck: 480_000,
};

const TEST_SCHLUESSEL = "kihub-copilot-test";

export interface CopilotVerbindung { clientId: string; tenantId: string; scopes: string[]; quelle: "build" | "browser" }

/** Im KI-Menü eingetragene Testverbindung (nur dieser Browser). */
function testVerbindung(): { clientId: string; tenantId: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TEST_SCHLUESSEL) ?? "null") as { clientId?: string; tenantId?: string } | null;
    return v?.clientId && v?.tenantId ? { clientId: v.clientId, tenantId: v.tenantId } : null;
  } catch { return null; }
}

export function testVerbindungSetzen(v: { clientId: string; tenantId: string } | null) {
  try {
    if (v) localStorage.setItem(TEST_SCHLUESSEL, JSON.stringify({ clientId: v.clientId.trim(), tenantId: v.tenantId.trim() }));
    else localStorage.removeItem(TEST_SCHLUESSEL);
  } catch { /* Speicher gesperrt */ }
}

/** Aktive Copilot-Verbindung: aus der Build-Umgebung, sonst aus dem KI-Menü, sonst keine. */
export function copilotVerbindung(): CopilotVerbindung | null {
  const scopes = KI_CONFIG.scopes.length ? KI_CONFIG.scopes : COPILOT_SCOPES;
  if (KI_CONFIG.clientId && KI_CONFIG.tenantId) return { clientId: KI_CONFIG.clientId, tenantId: KI_CONFIG.tenantId, scopes, quelle: "build" };
  const t = testVerbindung();
  return t ? { ...t, scopes, quelle: "browser" } : null;
}

/** Copilot ist nur aktiv, wenn Client- und Tenant-ID der Azure-Anwendung bekannt sind. */
export const copilotKonfiguriert = () => !!copilotVerbindung();

/** Adresse der Anmelde-Weiterleitung; muss in der App-Registrierung als „Single-page application“ eingetragen sein. */
export const redirectUri = () => new URL("auth-redirect.html", new URL(import.meta.env.BASE_URL, window.location.href)).href;

export const KI_ZENTRAL = {
  ziel: "Microsoft 365 Copilot über Microsoft Graph",
  anmeldung: "Zentrale Azure-Anwendung (Microsoft Entra ID), Single Sign-on über MSAL",
};
