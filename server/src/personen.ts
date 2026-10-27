/**
 * Wer sich am Hub angemeldet hat: Der Dienst vermerkt jede Person, die ihn mit ihrer Anmeldung aufruft, unter
 * HUB_DATEN/anmeldungen.json (Name, E-Mail, zuletzt). Die Verwaltung liest daraus die Personenliste, so sieht sie
 * auch Anmeldungen aus anderen Browsern, ohne dass jede Anmeldung ein Commit im Git-Speicher wird.
 */
import type { Nutzer } from "./anmeldung";
import type { DateiSpeicher } from "./speicher";

export type Anmeldung = { id: string; name: string; email: string; zuletzt: string };
const DATEI = "anmeldungen.json";

export class Personen {
  private liste: Map<string, Anmeldung> | null = null;
  private laden: Promise<Map<string, Anmeldung>> | null = null;
  private schreibt: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly speicher: DateiSpeicher) {}

  private async karte(): Promise<Map<string, Anmeldung>> {
    if (this.liste) return this.liste;
    this.laden ??= this.speicher.lesen<Anmeldung[]>(DATEI).then((v) => {
      this.liste = new Map((Array.isArray(v) ? v : []).filter((a) => a?.email).map((a) => [a.email.toLowerCase(), a]));
      return this.liste;
    });
    return this.laden;
  }

  /** Anmeldung vermerken; geschrieben wird gesammelt, höchstens alle paar Sekunden */
  async vermerken(n: Nutzer): Promise<void> {
    if (!n.email) return;
    const m = await this.karte();
    const alt = m.get(n.email.toLowerCase());
    const jetzt = new Date().toISOString();
    // Innerhalb einer Minute nichts Neues: kein Schreiben
    if (alt && alt.name === n.name && Date.parse(jetzt) - Date.parse(alt.zuletzt) < 60_000) return;
    m.set(n.email.toLowerCase(), { id: n.id, name: n.name, email: n.email, zuletzt: jetzt });
    this.schreibt ??= setTimeout(() => {
      this.schreibt = null;
      void this.speicher.schreiben(DATEI, [...m.values()]).catch((e) => console.warn("[Hub-Dienst] Anmeldungen nicht gespeichert:", e));
    }, 2000);
  }

  async alle(): Promise<Anmeldung[]> { return [...(await this.karte()).values()].sort((a, b) => b.zuletzt.localeCompare(a.zuletzt)); }
}
