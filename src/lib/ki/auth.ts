/** Anmeldung über die zentrale Azure-Anwendung (MSAL, Single Sign-on). */
import {
  createStandardPublicClientApplication, InteractionRequiredAuthError,
  type AccountInfo, type IPublicClientApplication,
} from "@azure/msal-browser";
import { copilotVerbindung, redirectUri } from "./config";

let pca: { schluessel: string; app: Promise<IPublicClientApplication> } | null = null;

function app(): Promise<IPublicClientApplication> {
  const v = copilotVerbindung();
  if (!v) throw new Error("Die zentrale KI-Anbindung ist nicht konfiguriert.");
  // Neu anlegen, wenn im KI-Menü eine andere Client- oder Tenant-ID eingetragen wurde
  const schluessel = `${v.clientId}|${v.tenantId}`;
  if (pca?.schluessel !== schluessel) pca = {
    schluessel,
    app: createStandardPublicClientApplication({
      auth: {
        clientId: v.clientId,
        authority: `https://login.microsoftonline.com/${v.tenantId}`,
        // Neben der App, auch wenn sie in einem Unterordner liegt (z. B. GitHub Pages unter /ki-portal/)
        redirectUri: redirectUri(),
      },
      cache: { cacheLocation: "sessionStorage" },
    }),
  };
  return pca.app;
}

export async function aktuellesKonto(): Promise<AccountInfo | null> {
  if (!copilotVerbindung()) return null;
  const a = await app();
  return a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
}

/** Übersetzt die häufigsten Anmeldefehler (AADSTS-Codes) in Hinweise, was in der App-Registrierung fehlt. */
function anmeldefehler(e: unknown): Error {
  const t = e instanceof Error ? e.message : String(e);
  const code = /AADSTS\d+/.exec(t)?.[0];
  const hinweis: Record<string, string> = {
    AADSTS50011: `Die Weiterleitungsadresse ist in der App-Registrierung nicht eingetragen. Unter „Authentifizierung“ → „Single-page application“ diese Adresse ergänzen: ${redirectUri()}`,
    AADSTS9002326: "Die Weiterleitungsadresse ist in der App-Registrierung als „Web“ eingetragen. Sie muss unter „Single-page application“ stehen.",
    AADSTS700054: "Die App-Registrierung erlaubt keine Anmeldung aus dem Browser. Unter „Authentifizierung“ die Plattform „Single-page application“ hinzufügen.",
    AADSTS700016: "Die Client-ID ist in diesem Tenant nicht bekannt. Client- und Tenant-ID prüfen.",
    AADSTS90002: "Den Tenant gibt es nicht. Tenant-ID prüfen.",
    AADSTS65001: "Für die Graph-Berechtigungen fehlt die Zustimmung. Die IT muss sie in der App-Registrierung unter „API-Berechtigungen“ erteilen (Administratorzustimmung).",
    AADSTS90094: "Für die Graph-Berechtigungen ist eine Administratorzustimmung nötig. Die IT muss sie in der App-Registrierung erteilen.",
    AADSTS650057: "Eine der angeforderten Graph-Berechtigungen ist in der App-Registrierung nicht eingetragen. Unter „API-Berechtigungen“ ergänzen und zustimmen lassen.",
    AADSTS53003: "Der bedingte Zugriff des Unternehmens blockiert die Anmeldung von diesem Gerät oder Ort.",
  };
  if (code && hinweis[code]) return new Error(`${hinweis[code]} (${code})`);
  if (/popup_window_error|empty_window_error/.test(t)) return new Error("Das Anmeldefenster wurde vom Browser blockiert. Pop-ups für diese Seite erlauben und erneut versuchen.");
  if (/user_cancelled/.test(t)) return new Error("Die Anmeldung wurde abgebrochen.");
  if (/timed_out|monitor_window_timeout/.test(t)) return new Error(`Die Anmeldung kam nicht zurück. Ist ${redirectUri()} in der App-Registrierung unter „Single-page application“ eingetragen?`);
  return new Error(`Anmeldung fehlgeschlagen: ${t.slice(0, 300)}`);
}

/** Token für Microsoft Graph: erst still, dann per Single Sign-on, zuletzt mit Anmeldefenster. */
export async function graphToken(scopes?: string[]): Promise<string> {
  const a = await app();
  scopes ??= copilotVerbindung()!.scopes;
  try {
    let konto = a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
    if (!konto) {
      try {
        const r = await a.ssoSilent({ scopes });
        a.setActiveAccount(r.account);
        return r.accessToken;
      } catch {
        const r = await a.loginPopup({ scopes });
        a.setActiveAccount(r.account);
        return r.accessToken;
      }
    }
    try {
      return (await a.acquireTokenSilent({ scopes, account: konto })).accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        const r = await a.acquireTokenPopup({ scopes, account: konto });
        a.setActiveAccount(r.account);
        konto = r.account;
        return r.accessToken;
      }
      throw e;
    }
  } catch (e) {
    throw anmeldefehler(e);
  }
}

/** Meldet in diesem Browser ab (nur lokal; das Microsoft-Konto bleibt angemeldet). */
export async function abmelden() {
  if (!pca) return;
  const a = await pca.app;
  await a.clearCache();
  a.setActiveAccount(null);
}
