/**
 * Zentrale Konfiguration des KI-Hubs. Gilt für alle Applikationen; Apps enthalten keine Verbindungsdaten.
 * Werte kommen aus Umgebungsvariablen (.env.local bzw. Build-Umgebung), siehe .env.example.
 */
const env = import.meta.env;

export const KI_CONFIG = {
  clientId: String(env.VITE_ENTRA_CLIENT_ID ?? "").trim(),
  tenantId: String(env.VITE_ENTRA_TENANT_ID ?? "").trim(),
  /** Delegierte Graph-Berechtigungen, durch Leerzeichen getrennt. */
  scopes: String(env.VITE_GRAPH_SCOPES ?? "").split(/\s+/).filter(Boolean),
  /** Speicherort der Applikationen: "local" (Browser) oder "sharepoint". */
  store: String(env.VITE_APP_STORE ?? "local") === "sharepoint" ? "sharepoint" : "local",
  /** Graph-ID der SharePoint-Website und Ordner für die App-Dateien (nur bei store = sharepoint). */
  spSiteId: String(env.VITE_SP_SITE_ID ?? "").trim(),
  spOrdner: String(env.VITE_SP_ORDNER ?? "KI-Hub/apps").trim(),
  /** Wartezeit auf eine Copilot-Antwort (wie in der bestehenden Copilot-Verbindung: 3 Minuten). */
  timeoutMs: 180_000,
};

/** Copilot ist nur aktiv, wenn die zentrale Azure-Anwendung vollständig konfiguriert ist. */
export const copilotKonfiguriert = () => !!(KI_CONFIG.clientId && KI_CONFIG.tenantId && KI_CONFIG.scopes.length);

export const KI_ZENTRAL = {
  ziel: "Microsoft 365 Copilot über Microsoft Graph",
  anmeldung: "Zentrale Azure-Anwendung (Microsoft Entra ID), Single Sign-on über MSAL",
};
