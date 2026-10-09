/** Anmeldung über die zentrale Azure-Anwendung (MSAL, Single Sign-on). */
import {
  createStandardPublicClientApplication, InteractionRequiredAuthError,
  type AccountInfo, type IPublicClientApplication,
} from "@azure/msal-browser";
import { KI_CONFIG, copilotKonfiguriert } from "./config";

let pca: Promise<IPublicClientApplication> | null = null;

function app(): Promise<IPublicClientApplication> {
  if (!copilotKonfiguriert()) throw new Error("Die zentrale KI-Anbindung ist nicht konfiguriert.");
  pca ??= createStandardPublicClientApplication({
    auth: {
      clientId: KI_CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${KI_CONFIG.tenantId}`,
      redirectUri: `${window.location.origin}/auth-redirect.html`,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  return pca;
}

export async function aktuellesKonto(): Promise<AccountInfo | null> {
  if (!copilotKonfiguriert()) return null;
  const a = await app();
  return a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
}

/** Token für Microsoft Graph: erst still, dann per Single Sign-on, zuletzt mit Anmeldefenster. */
export async function graphToken(scopes = KI_CONFIG.scopes): Promise<string> {
  const a = await app();
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
}
