/**
 * Wissensquelle „Netzlaufwerk“ (über den Hub-Dienst): Den Ordner liest der Dienst, der die Freigabe eingebunden hat.
 * Im Browser fragt der Hub den Dienst; läuft der Ablauf im Dienst selbst, setzt der Dienst hier seine Suche ein.
 */
import type { Quelle } from "../schema";
import type { WissenAuszug } from "../request";

export type LaufwerkSuche = (q: Quelle, frage: string, breiter?: string) => Promise<WissenAuszug>;
let imDienst: LaufwerkSuche | null = null;
/** Nur im Hub-Dienst: Suche direkt im eingebundenen Laufwerk (mit der Person des laufenden Ablaufs) */
export function laufwerkImDienstSetzen(f: LaufwerkSuche) { imDienst = f; }

export async function laufwerkAuszug(q: Quelle, frage: string, breiter?: string): Promise<WissenAuszug> {
  const titel = q.titel || q.url || "Netzlaufwerk";
  try {
    if (imDienst) return { ...(await imDienst(q, frage, breiter)), quelleTyp: "laufwerk" };
    const d = await import("../dienst");
    if (!(await d.dienstAktiv())) return { titel, url: "", text: "", quelleTyp: "laufwerk", fehler: "Das Netzlaufwerk liest der Hub-Dienst, und der ist gerade nicht erreichbar." };
    return { ...(await d.laufwerkSuchen({ pfad: q.url, frage, breiter, titel })), quelleTyp: "laufwerk" };
  } catch (e) {
    return { titel, url: "", text: "", quelleTyp: "laufwerk", fehler: e instanceof Error ? e.message : String(e) };
  }
}
