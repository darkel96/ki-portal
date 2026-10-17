/**
 * Server-Fassung von src/lib/ki/config.ts (wird beim Bauen des Dienstes an dessen Stelle gesetzt).
 * Verbindungsdaten kommen aus der Umgebung; im Testmodus zeigt die Graph-Adresse auf die eingebaute Attrappe.
 */
export const COPILOT_SCOPES = [
  "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All",
  "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All",
].map((s) => `https://graph.microsoft.com/${s}`);

const env = process.env;
const testmodus = /^(1|true|ja)$/i.test(env.HUB_TESTMODUS ?? "");
const port = Number(env.HUB_PORT) || 8787;

export const KI_CONFIG = {
  /** Microsoft Graph; im Testmodus die Attrappe des Dienstes */
  graph: env.HUB_GRAPH_URL || (testmodus ? `http://127.0.0.1:${port}/attrappe` : "https://graph.microsoft.com"),
  clientId: String(env.HUB_CLIENT_ID ?? "").trim(),
  tenantId: String(env.HUB_TENANT_ID ?? "").trim(),
  scopes: String(env.HUB_GRAPH_SCOPES ?? "").split(/\s+/).filter(Boolean),
  spOrdnerUrl: "",
  timeoutMs: 180_000,
  timeoutMsAmStueck: 480_000,
};

export interface CopilotVerbindung { clientId: string; tenantId: string; scopes: string[]; quelle: "build" | "browser" }

export function testVerbindungSetzen(_v: { clientId: string; tenantId: string } | null) { /* im Dienst nicht vorgesehen */ }

/** Der Dienst spricht immer Copilot (bzw. die Attrappe); die Anmeldung übernimmt er von der Person. */
export function copilotVerbindung(): CopilotVerbindung | null {
  return { clientId: KI_CONFIG.clientId || "dienst", tenantId: KI_CONFIG.tenantId || "dienst", scopes: KI_CONFIG.scopes.length ? KI_CONFIG.scopes : COPILOT_SCOPES, quelle: "build" };
}
export const copilotKonfiguriert = () => true;
export const redirectUri = () => "";
export const KI_ZENTRAL = {
  ziel: "Microsoft 365 Copilot über Microsoft Graph",
  anmeldung: "Zentrale Azure-Anwendung (Microsoft Entra ID), On-Behalf-Of über den Hub-Dienst",
};
