/**
 * Ablage und Auswertung der Lernschicht im Browser: mit Hub-Dienst dort (gemeinsam für alle, Auswertung auch nach
 * Zeitplan), sonst in diesem Browser (localStorage je App). Rückmeldungen sind anonym: kein Name, keine Nutzer-ID.
 */
import type { App, Step } from "./schema";
import { kiFragen } from "./ki";
import { dienstAktiv, lernStandHolen, lernenAuswerten, rueckmeldungSenden, vorschlagEinreichenDienst, vorschlagSetzen } from "./dienst";
import { auswertungDurchfuehren, auswertungEinarbeiten, auswertungsPrompt, leererStand, rueckmeldungAnlegen, MAX_RUECKMELDUNGEN, type LernStand, type Rueckmeldung, type Vorschlag } from "./lernen";

const LS = (appId: string) => `kihub-lernen:${appId}`;

function lokalLesen(appId: string): LernStand {
  try {
    const roh = JSON.parse(localStorage.getItem(LS(appId)) || "null") as Partial<LernStand> | null;
    return roh ? { ...leererStand(), ...roh } : leererStand();
  } catch { return leererStand(); }
}
function lokalSchreiben(appId: string, st: LernStand) {
  try { localStorage.setItem(LS(appId), JSON.stringify({ ...st, rueckmeldungen: st.rueckmeldungen.slice(-MAX_RUECKMELDUNGEN) })); } catch { /* voll oder gesperrt */ }
}

export async function lernStand(appId: string): Promise<LernStand> {
  if (await dienstAktiv()) { try { return await lernStandHolen(appId); } catch { /* Dienst gerade nicht erreichbar: Browser-Stand */ } }
  return lokalLesen(appId);
}

/** Rückmeldung ablegen (Daumen, Kommentar oder „ohne Fundstelle“) */
export async function rueckmeldungSpeichern(appId: string, r: Omit<Rueckmeldung, "id" | "zeit">): Promise<void> {
  const eintrag = rueckmeldungAnlegen(r);
  if (await dienstAktiv()) { await rueckmeldungSenden(appId, eintrag); return; }
  const st = lokalLesen(appId);
  lokalSchreiben(appId, { ...st, rueckmeldungen: [...st.rueckmeldungen, eintrag] });
}

export async function vorschlagStand(appId: string, id: string, stand: Vorschlag["stand"]): Promise<LernStand> {
  if (await dienstAktiv()) return vorschlagSetzen(appId, id, stand);
  const st = lokalLesen(appId);
  const neu = { ...st, vorschlaege: st.vorschlaege.map((v) => (v.id === id ? { ...v, stand } : v)) };
  lokalSchreiben(appId, neu);
  return neu;
}

/** Vorschlag einreichen (aus dem Chat: „Als häufige Frage vorschlagen“); freigegeben wird im Baukasten */
export async function vorschlagEinreichen(appId: string, v: Vorschlag): Promise<void> {
  if (await dienstAktiv()) { await vorschlagEinreichenDienst(appId, v); return; }
  const st = lokalLesen(appId);
  lokalSchreiben(appId, { ...st, vorschlaege: [...st.vorschlaege, v].slice(-150) });
}

/** Rückmeldungen auswerten lassen: im Dienst (der merkt sich den Schritt und wertet künftig nach Zeitplan aus), sonst hier */
export async function auswerten(app: App, step: Step, signal?: AbortSignal): Promise<LernStand> {
  const appId = app.id ?? "";
  if (await dienstAktiv()) return lernenAuswerten(appId, { stepId: step.id, step, appName: app.name });
  const st = lokalLesen(appId);
  const r = st.rueckmeldungen.filter((x) => x.stepId === step.id);
  const neu = auswertungEinarbeiten(st, step.id, await auswertungDurchfuehren(auswertungsPrompt(app, step, r), step.id, (t) => kiFragen(t, signal)));
  lokalSchreiben(appId, neu);
  return neu;
}
