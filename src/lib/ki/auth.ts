/** Anmeldung über die zentrale Azure-Anwendung (MSAL, Single Sign-on). */
import type { AccountInfo, AuthenticationResult, IPublicClientApplication } from "@azure/msal-browser";

type Msal = typeof import("@azure/msal-browser");
let msal: Msal | null = null;
/** MSAL (rund 250 KB) erst laden, wenn eine Copilot-Verbindung eingerichtet ist und gebraucht wird. */
const msalLaden = async (): Promise<Msal> => (msal ??= await import("@azure/msal-browser"));
import { copilotVerbindung, redirectUri } from "./config";

let pca: { schluessel: string; app: Promise<IPublicClientApplication> } | null = null;

function app(): Promise<IPublicClientApplication> {
  const v = copilotVerbindung();
  if (!v) throw new Error("Die zentrale KI-Anbindung ist nicht konfiguriert.");
  // Neu anlegen, wenn im KI-Menü eine andere Client- oder Tenant-ID eingetragen wurde
  const schluessel = `${v.clientId}|${v.tenantId}`;
  if (pca?.schluessel !== schluessel) pca = {
    schluessel,
    app: msalLaden().then((m) => m.createStandardPublicClientApplication({
      auth: {
        clientId: v.clientId,
        authority: `https://login.microsoftonline.com/${v.tenantId}`,
        // Neben der App, auch wenn sie in einem Unterordner liegt (z. B. GitHub Pages unter /ki-portal/)
        redirectUri: redirectUri(),
      },
      // Angemeldet bleiben über Tabs und Neustarts hinweg; MSAL verschlüsselt den Zwischenspeicher
      // mit einem Schlüssel, der mit der Browsersitzung endet.
      cache: { cacheLocation: "localStorage" },
    })),
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
  if (/interaction_in_progress/.test(t)) return new Error("Es läuft noch eine Anmeldung. Offenes Anmeldefenster abschließen oder schließen und erneut versuchen.");
  if (/user_cancelled/.test(t)) return new Error("Die Anmeldung wurde abgebrochen.");
  if (/timed_out|monitor_window_timeout/.test(t)) return new Error(`Die Anmeldung kam nicht zurück. Ist ${redirectUri()} in der App-Registrierung unter „Single-page application“ eingetragen?`);
  return new Error(`Anmeldung fehlgeschlagen: ${t.slice(0, 300)}`);
}

/**
 * Höchstens ein Anmeldefenster gleichzeitig: Weitere Aufrufe (z. B. mehrere Agenten) warten auf dasselbe.
 * overrideInteractionInProgress räumt einen hängengebliebenen Versuch ab (z. B. nach einem blockierten
 * Fenster), sonst meldet MSAL bis zum Schließen des Tabs „interaction_in_progress“.
 */
let laufendesFenster: Promise<string> | null = null;
function popup(a: IPublicClientApplication, oeffnen: () => Promise<AuthenticationResult>): Promise<string> {
  laufendesFenster ??= oeffnen()
    .then((r) => { a.setActiveAccount(r.account); return r.accessToken; })
    .finally(() => { laufendesFenster = null; });
  return laufendesFenster;
}

/** Token für Microsoft Graph: still aus dem Zwischenspeicher, sonst mit Anmeldefenster. */
export async function graphToken(scopes?: string[]): Promise<string> {
  const a = await app();
  scopes ??= copilotVerbindung()!.scopes;
  try {
    const konto = a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
    if (!konto) {
      // Gleich das Anmeldefenster öffnen, solange es noch als Folge des Klicks gilt. Ein vorgeschaltetes
      // ssoSilent wartet ohne Drittanbieter-Cookies bis zu 10 s; danach blockiert der Browser das Fenster.
      // Ist die Person bei Microsoft schon angemeldet, schließt sich das Fenster von selbst.
      return await popup(a, () => a.loginPopup({ scopes, overrideInteractionInProgress: true }));
    }
    try {
      return (await a.acquireTokenSilent({ scopes, account: konto })).accessToken;
    } catch (e) {
      if (msal && e instanceof msal.InteractionRequiredAuthError) {
        return await popup(a, () => a.acquireTokenPopup({ scopes, account: konto, overrideInteractionInProgress: true }));
      }
      throw e;
    }
  } catch (e) {
    throw anmeldefehler(e);
  }
}

/**
 * Kennung der angemeldeten Person für Speicher, die nicht über Personen hinweg geteilt werden dürfen (Wissen,
 * Copilot-Vorrat). null ohne Anmeldung: dann wird nichts zwischengespeichert. Im Hub-Dienst liefert die Server-Fassung
 * die Person des laufenden Aufrufs (server/src/alias/auth.ts).
 */
export async function nutzerKennung(): Promise<string | null> {
  try {
    const a = await app();
    const k = a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
    return k?.homeAccountId || k?.localAccountId || null;
  } catch { return null; }
}

/**
 * Token ohne jedes Fenster, für das Vorwärmen beim Seitenstart: aus dem Zwischenspeicher bzw. per
 * Refresh-Token, sonst per Single Sign-on über die bestehende Microsoft-Sitzung des Browsers.
 * Gibt null zurück, wenn das nicht reicht; dann meldet sich die Person beim ersten KI-Aufruf an.
 */
export async function graphTokenStill(zusatz: string[] = []): Promise<string | null> {
  const v = copilotVerbindung();
  if (!v) return null;
  const a = await app();
  const konto = a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
  const scopes = [...v.scopes, ...zusatz];
  try {
    const r = konto
      ? await a.acquireTokenSilent({ scopes, account: konto })
      : await a.ssoSilent({ scopes });
    a.setActiveAccount(r.account);
    return r.accessToken;
  } catch {
    return null;
  }
}

/**
 * Beim Seitenstart: erst eine zurückkommende Weiterleitungs-Anmeldung übernehmen, dann still anmelden
 * (Zwischenspeicher, sonst Single Sign-on über die Microsoft-Sitzung des Browsers). Kein Fenster, keine Weiterleitung.
 * fehler: verständliche Meldung, wenn die Weiterleitung mit einem Fehler zurückkam (z. B. fehlende Zustimmung).
 */
export async function anmeldungStart(): Promise<{ konto: AccountInfo | null; fehler: string | null }> {
  const v = copilotVerbindung();
  if (!v) return { konto: null, fehler: null };
  const a = await app();
  let fehler: string | null = null;
  try {
    const r = await a.handleRedirectPromise();
    if (r) a.setActiveAccount(r.account);
  } catch (e) {
    fehler = anmeldefehler(e).message;
  }
  let konto = a.getActiveAccount() ?? a.getAllAccounts()[0] ?? null;
  if (!konto && !fehler) {
    try {
      // Höchstens 3 s warten: Ohne Microsoft-Sitzung (oder ohne Drittanbieter-Cookies) läuft das versteckte
      // Anmeldefenster sonst bis zum Zeitlimit der Bibliothek; die Weiterleitung ist dann der schnellere Weg.
      const r = await Promise.race([
        a.ssoSilent({ scopes: v.scopes }),
        new Promise<never>((_, nein) => setTimeout(() => nein(new Error("sso_timeout")), 3000)),
      ]);
      a.setActiveAccount(r.account);
      konto = r.account;
    } catch { /* keine Browsersitzung bei Microsoft: Weiterleitung nötig */ }
  }
  return { konto, fehler };
}

/**
 * Anmeldung per Weiterleitung zu Microsoft: kein Pop-up (also auch auf dem Handy und ohne Pop-up-Freigabe),
 * mit bestehender Windows-/Microsoft-Sitzung meist ohne jede Eingabe. Kommt auf dieselbe Seite zurück.
 */
export async function anmeldenWeiterleitung(): Promise<void> {
  const v = copilotVerbindung();
  if (!v) throw new Error("Die zentrale KI-Anbindung ist nicht konfiguriert.");
  const a = await app();
  try {
    await a.loginRedirect({ scopes: v.scopes, redirectStartPage: window.location.href });
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

export type Berechtigungen = {
  /** Delegierte Graph-Berechtigungen, die das ausgestellte Token tatsächlich enthält (Anspruch „scp“) */
  vorhanden: string[];
  /** Angeforderte Berechtigungen, die im Token fehlen (keine Zustimmung oder nicht eingetragen) */
  fehlend: string[];
  /** Lesezugriff auf SharePoint per Graph: gefundene Websites oder eine Fehlermeldung */
  sharepoint: { ok: boolean; text: string };
};

/**
 * Prüft, was die Anmeldung wirklich darf: liest die Berechtigungen aus dem Token und versucht einen Lesezugriff
 * auf SharePoint (Sites.Read.All). Braucht ein Konto; ohne gültiges Token öffnet sich die Anmeldung.
 */
export async function berechtigungenPruefen(): Promise<Berechtigungen> {
  const v = copilotVerbindung();
  if (!v) throw new Error("Die zentrale KI-Anbindung ist nicht konfiguriert.");
  const token = await graphToken();
  // Nutzdaten des Tokens (Base64url) lesen; der Anspruch „scp“ nennt die erteilten delegierten Berechtigungen
  let scp = "";
  try {
    const teil = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    scp = String((JSON.parse(atob(teil)) as { scp?: string }).scp ?? "");
  } catch { /* kein lesbares JWT (z. B. verschlüsselt): dann zählt nur der Zugriffstest */ }
  const vorhanden = scp.split(/\s+/).filter(Boolean).sort();
  const gewollt = v.scopes.map((s) => s.replace("https://graph.microsoft.com/", ""));
  const fehlend = scp ? gewollt.filter((s) => !vorhanden.includes(s)) : [];
  let sharepoint: Berechtigungen["sharepoint"];
  try {
    const r = await fetch("https://graph.microsoft.com/v1.0/sites?search=*&$select=displayName,webUrl", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const code = await r.json().then((j: { error?: { code?: string } }) => j.error?.code ?? "", () => "");
      sharepoint = { ok: false, text: `SharePoint nicht lesbar (HTTP ${r.status}${code ? ` ${code}` : ""}).` };
    } else {
      const sites = ((await r.json()) as { value?: { displayName?: string }[] }).value ?? [];
      const namen = sites.map((s) => s.displayName).filter(Boolean).slice(0, 5).join(", ");
      sharepoint = { ok: true, text: sites.length ? `SharePoint lesbar: ${sites.length} Websites, z. B. ${namen}.` : "SharePoint erreichbar, aber keine Website sichtbar." };
    }
  } catch (e) {
    sharepoint = { ok: false, text: `Keine Verbindung zu Microsoft Graph (${e instanceof Error ? e.message : String(e)}).` };
  }
  return { vorhanden, fehlend, sharepoint };
}
