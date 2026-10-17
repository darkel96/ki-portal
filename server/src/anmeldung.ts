/**
 * Anmeldung am Dienst und Weitergabe an Microsoft Graph.
 *
 * Der Hub im Browser holt sich bei Microsoft ein Token für den Dienst (Berechtigung HUB_API_SCOPE) und schickt es
 * als „Bearer“ mit. Der Dienst prüft Unterschrift, Herausgeber, Empfänger und Ablauf. Soll er im Namen der Person
 * arbeiten (Lauf starten, Aufträge ausführen), tauscht er das Token per On-Behalf-Of gegen ein Graph-Token samt
 * Auffrischungs-Token; beides liegt verschlüsselt unter HUB_DATEN/nutzer/<id>/zugang.json und wird so lange
 * aufgefrischt, wie Aufträge der Person laufen. „Abmelden vom Dienst“ löscht die Datei.
 *
 * Testmodus: „Bearer test:<name>“ gilt als angemeldet, Graph-Aufrufe gehen an die Attrappe.
 */
import { createCipheriv, createDecipheriv, createPublicKey, randomBytes, verify as kryptoPruefen } from "node:crypto";
import { UMGEBUNG } from "./umgebung";
import { DateiSpeicher, sicherName } from "./speicher";

export type Nutzer = { id: string; name: string; email: string };
export class NichtAngemeldet extends Error { status = 401; }
export class KeineAnmeldungGespeichert extends Error { status = 409; constructor() { super("Für diese Person liegt keine Anmeldung im Dienst vor. Bitte im Hub einmal einen Lauf starten oder die Aufträge neu speichern."); } }

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const login = () => `https://login.microsoftonline.com/${UMGEBUNG.tenantId}`;

/* ---------- Token des Hubs prüfen ---------- */
type Jwk = { kid: string; kty: string; n: string; e: string; x5c?: string[] };
let jwks: { zeit: number; keys: Jwk[] } | null = null;
async function schluesselFuer(kid: string): Promise<Jwk | null> {
  const laden = async () => {
    const r = await fetch(`${login()}/discovery/v2.0/keys`);
    if (!r.ok) throw new Error(`Schlüssel von Microsoft nicht abrufbar (${r.status}).`);
    jwks = { zeit: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
  };
  if (!jwks || Date.now() - jwks.zeit > 6 * 3600_000) await laden();
  let k = jwks!.keys.find((x) => x.kid === kid);
  if (!k && Date.now() - jwks!.zeit > 60_000) { await laden(); k = jwks!.keys.find((x) => x.kid === kid); }
  return k ?? null;
}

type Anspruch = { oid?: string; sub?: string; name?: string; preferred_username?: string; upn?: string; aud?: string; iss?: string; exp?: number; nbf?: number; tid?: string; scp?: string };

async function jwtPruefen(token: string): Promise<Anspruch> {
  const teile = token.split(".");
  if (teile.length !== 3) throw new NichtAngemeldet("Kein gültiges Token.");
  const kopf = JSON.parse(b64url(teile[0]).toString("utf8")) as { alg?: string; kid?: string };
  if (kopf.alg !== "RS256" || !kopf.kid) throw new NichtAngemeldet("Unbekanntes Token-Verfahren.");
  const jwk = await schluesselFuer(kopf.kid);
  if (!jwk) throw new NichtAngemeldet("Der Schlüssel des Tokens ist Microsoft nicht bekannt.");
  const ok = kryptoPruefen("RSA-SHA256", Buffer.from(`${teile[0]}.${teile[1]}`), createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" }), b64url(teile[2]));
  if (!ok) throw new NichtAngemeldet("Die Unterschrift des Tokens stimmt nicht.");
  const a = JSON.parse(b64url(teile[1]).toString("utf8")) as Anspruch;
  const jetzt = Math.floor(Date.now() / 1000);
  if (!a.exp || a.exp < jetzt - 60) throw new NichtAngemeldet("Das Token ist abgelaufen.");
  if (a.nbf && a.nbf > jetzt + 60) throw new NichtAngemeldet("Das Token gilt noch nicht.");
  if (a.tid !== UMGEBUNG.tenantId && !(a.iss ?? "").includes(UMGEBUNG.tenantId)) throw new NichtAngemeldet("Das Token stammt aus einem anderen Tenant.");
  const empfaenger = new Set([UMGEBUNG.clientId, `api://${UMGEBUNG.clientId}`, UMGEBUNG.apiScope.split("/").slice(0, 3).join("/")]);
  if (!a.aud || !empfaenger.has(a.aud)) throw new NichtAngemeldet("Das Token ist nicht für den Hub-Dienst ausgestellt.");
  return a;
}

/** Angemeldete Person aus dem Authorization-Header; wirft NichtAngemeldet */
export async function anmeldungPruefen(auth: string | undefined): Promise<{ nutzer: Nutzer; token: string }> {
  const token = (auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new NichtAngemeldet("Bitte anmelden.");
  if (UMGEBUNG.testmodus) {
    if (!token.startsWith("test:")) throw new NichtAngemeldet("Im Testmodus gilt „Bearer test:<name>“.");
    const name = sicherName(token.slice(5)) || "lokal";
    return { nutzer: { id: `test-${name}`, name, email: `${name}@test.local` }, token };
  }
  const a = await jwtPruefen(token);
  const id = a.oid ?? a.sub;
  if (!id) throw new NichtAngemeldet("Das Token nennt keine Person.");
  return { nutzer: { id, name: a.name ?? a.preferred_username ?? id, email: a.preferred_username ?? a.upn ?? "" }, token };
}

/* ---------- Verschlüsselte Ablage der Graph-Anmeldung ---------- */
let schluessel: Buffer | null = null;
async function hauptSchluessel(speicher: DateiSpeicher): Promise<Buffer> {
  if (schluessel) return schluessel;
  if (/^[0-9a-f]{64}$/i.test(UMGEBUNG.schluessel)) return (schluessel = Buffer.from(UMGEBUNG.schluessel, "hex"));
  const rel = "schluessel.json";
  const da = await speicher.lesen<{ hex: string }>(rel);
  if (da?.hex) return (schluessel = Buffer.from(da.hex, "hex"));
  const neu = randomBytes(32);
  await speicher.schreiben(rel, { hex: neu.toString("hex"), hinweis: "Automatisch erzeugt. Besser: HUB_SCHLUESSEL setzen und diese Datei sichern." });
  console.warn("[Hub-Dienst] HUB_SCHLUESSEL fehlt: Schlüssel für gespeicherte Anmeldungen wurde unter HUB_DATEN/schluessel.json angelegt.");
  return (schluessel = neu);
}
const verschluesseln = (k: Buffer, text: string) => {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv);
  const d = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${d.toString("base64")}`;
};
const entschluesseln = (k: Buffer, wert: string) => {
  const [iv, tag, d] = wert.split(".").map((x) => Buffer.from(x, "base64"));
  const c = createDecipheriv("aes-256-gcm", k, iv);
  c.setAuthTag(tag);
  return Buffer.concat([c.update(d), c.final()]).toString("utf8");
};

type Zugang = { zugang: string; ablauf: number; auffrischung: string; email: string; name: string; seit: string };
const zugangPfad = (id: string) => `nutzer/${sicherName(id)}/zugang.json`;

type TokenAntwort = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
async function tokenAnfrage(form: Record<string, string>): Promise<TokenAntwort> {
  const r = await fetch(`${login()}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const j = (await r.json().catch(() => ({}))) as TokenAntwort;
  if (!r.ok || !j.access_token) throw new Error(`Microsoft-Anmeldung abgelehnt: ${j.error ?? r.status} ${j.error_description ?? ""}`.trim());
  return j;
}

/** Zugang der Person im Dienst hinterlegen: Hub-Token gegen Graph-Token tauschen (On-Behalf-Of) und verschlüsselt ablegen */
export async function zugangUebernehmen(speicher: DateiSpeicher, nutzer: Nutzer, hubToken: string): Promise<void> {
  if (UMGEBUNG.testmodus) {
    await speicher.schreiben(zugangPfad(nutzer.id), { zugang: "", ablauf: 0, auffrischung: "", email: nutzer.email, name: nutzer.name, seit: new Date().toISOString() } satisfies Zugang);
    return;
  }
  const j = await tokenAnfrage({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", requested_token_use: "on_behalf_of",
    client_id: UMGEBUNG.clientId, client_secret: UMGEBUNG.clientSecret, assertion: hubToken,
    scope: [...UMGEBUNG.graphScopes, "offline_access"].join(" "),
  });
  const k = await hauptSchluessel(speicher);
  await speicher.schreiben(zugangPfad(nutzer.id), {
    zugang: verschluesseln(k, j.access_token!), ablauf: Date.now() + (j.expires_in ?? 3600) * 1000,
    auffrischung: j.refresh_token ? verschluesseln(k, j.refresh_token) : "", email: nutzer.email, name: nutzer.name, seit: new Date().toISOString(),
  } satisfies Zugang);
}

export async function zugangLoeschen(speicher: DateiSpeicher, nutzerId: string): Promise<void> {
  await speicher.loeschen(zugangPfad(nutzerId));
}

export async function zugangVorhanden(speicher: DateiSpeicher, nutzerId: string): Promise<{ seit: string; email: string } | null> {
  const z = await speicher.lesen<Zugang>(zugangPfad(nutzerId));
  return z ? { seit: z.seit, email: z.email } : null;
}

const auffrischungLaeuft = new Map<string, Promise<string>>();
/** Graph-Token der Person: aus der Ablage, bei Bedarf aufgefrischt; wirft KeineAnmeldungGespeichert */
export async function graphTokenFuer(speicher: DateiSpeicher, nutzerId: string): Promise<string> {
  if (UMGEBUNG.testmodus) return "test-token";
  const rel = zugangPfad(nutzerId);
  const z = await speicher.lesen<Zugang>(rel);
  if (!z) throw new KeineAnmeldungGespeichert();
  const k = await hauptSchluessel(speicher);
  if (z.zugang && z.ablauf - Date.now() > 90_000) return entschluesseln(k, z.zugang);
  if (!z.auffrischung) throw new KeineAnmeldungGespeichert();
  let lauf = auffrischungLaeuft.get(nutzerId);
  if (!lauf) {
    lauf = (async () => {
      try {
        const j = await tokenAnfrage({ grant_type: "refresh_token", client_id: UMGEBUNG.clientId, client_secret: UMGEBUNG.clientSecret, refresh_token: entschluesseln(k, z.auffrischung), scope: [...UMGEBUNG.graphScopes, "offline_access"].join(" ") });
        await speicher.schreiben(rel, { ...z, zugang: verschluesseln(k, j.access_token!), ablauf: Date.now() + (j.expires_in ?? 3600) * 1000, auffrischung: j.refresh_token ? verschluesseln(k, j.refresh_token) : z.auffrischung } satisfies Zugang);
        return j.access_token!;
      } catch (e) {
        // Auffrischung abgelehnt (Kennwort geändert, Zustimmung entzogen): Ablage ist wertlos
        if (e instanceof Error && /invalid_grant|interaction_required/i.test(e.message)) await speicher.loeschen(rel);
        throw e;
      } finally { auffrischungLaeuft.delete(nutzerId); }
    })();
    auffrischungLaeuft.set(nutzerId, lauf);
  }
  return lauf;
}

/** E-Mail-Adresse der Person aus der Ablage (für den Versand an „mich“) */
export async function emailVon(speicher: DateiSpeicher, nutzerId: string): Promise<string> {
  return (await speicher.lesen<Zugang>(zugangPfad(nutzerId)))?.email ?? "";
}
