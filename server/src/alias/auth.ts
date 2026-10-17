/**
 * Server-Fassung von src/lib/ki/auth.ts: Statt MSAL im Browser liefert der Dienst das Graph-Token der Person,
 * in deren Namen ein Lauf ausgeführt wird. Welche Person das ist, steht im Aufruf-Kontext (AsyncLocalStorage),
 * den die Lauf-Ausführung setzt.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type TokenQuelle = { token: (scopes?: string[]) => Promise<string> };
export const tokenKontext = new AsyncLocalStorage<TokenQuelle>();

export async function graphToken(scopes?: string[]): Promise<string> {
  const q = tokenKontext.getStore();
  if (!q) throw new Error("Kein Nutzerkontext: Der Lauf wurde außerhalb einer Anmeldung gestartet.");
  return q.token(scopes);
}

export async function graphTokenStill(_zusatz: string[] = []): Promise<string | null> {
  try { return await graphToken(); } catch { return null; }
}

export async function aktuellesKonto(): Promise<null> { return null; }
export async function anmeldungStart(): Promise<{ konto: null; fehler: string | null }> { return { konto: null, fehler: null }; }
export async function anmeldenWeiterleitung(): Promise<void> { /* im Dienst nicht vorgesehen */ }
export async function abmelden(): Promise<void> { /* im Dienst nicht vorgesehen */ }
export type Berechtigungen = Record<string, unknown>;
export async function berechtigungenPruefen(): Promise<Berechtigungen> { throw new Error("Im Dienst nicht vorgesehen."); }
