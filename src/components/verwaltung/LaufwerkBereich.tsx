import { useEffect, useState } from "react";
import { ChevronRight, Folder, HardDrive, RefreshCw, Trash } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Arbeitet } from "@/components/layout/Arbeitet";
import { dienstAktiv, laufwerkEinlesen, laufwerkFreigabenSetzen, laufwerkInfo, laufwerkOrdner, type LaufwerkFreigabe, type LaufwerkInfo } from "@/lib/dienst";

const datum = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "noch nie");

/**
 * Verwaltung: Netzlaufwerk des Hub-Dienstes. Nur freigegebene Ordner liest der Dienst ein und nutzt sie als Wissen;
 * je Freigabe lässt sich festlegen, wer sie nutzen darf (leer = alle Angemeldeten).
 */
export function LaufwerkBereich() {
  const [info, setInfo] = useState<LaufwerkInfo | null | "ohne">(null);
  const [freigaben, setFreigaben] = useState<LaufwerkFreigabe[]>([]);
  const [pfad, setPfad] = useState("");
  const [ordner, setOrdner] = useState<{ name: string; pfad: string }[] | null>(null);
  const [laeuft, setLaeuft] = useState("");

  const laden = async () => {
    if (!(await dienstAktiv())) { setInfo("ohne"); return; }
    try { const i = await laufwerkInfo(); setInfo(i); setFreigaben(i.freigaben); } catch (e) { setInfo("ohne"); toast.error(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void laden(); }, []);
  useEffect(() => {
    if (!info || info === "ohne" || !info.aktiv || !info.admin) return;
    let aus = false;
    setOrdner(null);
    laufwerkOrdner(pfad).then((o) => { if (!aus) setOrdner(o); }, (e) => { if (!aus) { setOrdner([]); toast.error(e instanceof Error ? e.message : String(e)); } });
    return () => { aus = true; };
  }, [pfad, info]);

  if (info === null) return null;
  const titel = <h2 id="laufwerk-titel"><HardDrive size={18} aria-hidden="true" style={{ display: "inline", verticalAlign: "-3px", marginRight: 6 }} />Netzlaufwerk</h2>;
  if (info === "ohne") return <section className="rv-laufwerk" aria-labelledby="laufwerk-titel">{titel}<p className="hint" style={{ margin: 0 }}>Das Netzlaufwerk liest der Hub-Dienst. Er ist hier nicht erreichbar.</p></section>;
  if (!info.aktiv) return <section className="rv-laufwerk" aria-labelledby="laufwerk-titel">{titel}<p className="hint" style={{ margin: 0 }}>Im Hub-Dienst ist kein Netzlaufwerk eingebunden. Auf dem Server einmal <code>bash scripts/laufwerk-einrichten.sh</code> ausführen (bindet die Freigabe schreibgeschützt ein).</p></section>;
  if (!info.admin) return null;

  const geaendert = JSON.stringify(freigaben) !== JSON.stringify(info.freigaben);
  const teile = pfad ? pfad.split("/") : [];
  const speichern = async () => {
    setLaeuft("speichern");
    try { const neu = await laufwerkFreigabenSetzen(freigaben); setFreigaben(neu); setInfo({ ...info, freigaben: neu }); toast.success("Freigaben gespeichert. Der Dienst liest die Ordner jetzt ein."); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setLaeuft(""); }
  };
  const einlesen = async () => {
    setLaeuft("einlesen");
    try { await laufwerkEinlesen(); toast.success("Einlesen gestartet."); window.setTimeout(() => void laden(), 3000); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setLaeuft(""); }
  };
  const freigeben = (p: string) => {
    if (freigaben.some((f) => f.pfad.toLowerCase() === p.toLowerCase())) { toast.info("Dieser Ordner ist schon freigegeben."); return; }
    setFreigaben([...freigaben, { pfad: p, fuer: [], notiz: "" }]);
  };

  return (
    <section className="rv-laufwerk" aria-labelledby="laufwerk-titel">
      {titel}
      <p className="hint" style={{ margin: 0 }}>
        {info.name}{info.unc ? ` (${info.unc})` : ""}. Nur freigegebene Ordner liest der Hub-Dienst ein; im Baukasten sind sie unter Wissen als „Netzlaufwerk“ wählbar.
        Alle lesen mit dem Lesekonto des Servers: Wer eine Freigabe nutzt, sieht alle Dateien darin, unabhängig von den Ordnerrechten in Windows.
      </p>
      <p className="hint" style={{ margin: 0 }} role="status">
        {info.stand.laeuft ? <Arbeitet text="Liest ein" /> : `${info.stand.dateien} Dateien eingelesen, zuletzt ${datum(info.stand.zuletzt)}`}
        {info.stand.fehler ? `, ${info.stand.fehler} nicht lesbar` : ""}{info.stand.meldung ? `. ${info.stand.meldung}` : ""}
      </p>
      <div className="rv-lw-freigaben" role="list" aria-label="Freigegebene Ordner">
        {!freigaben.length && <p className="hint" style={{ margin: 0 }}>Noch kein Ordner freigegeben. Wähle unten einen Ordner aus.</p>}
        {freigaben.map((f, i) => (
          <div key={f.pfad} className="rv-lw-zeile" role="listitem">
            <span className="rv-lw-pfad"><Folder size={15} aria-hidden="true" />{f.pfad || "/ (ganzes Laufwerk)"}</span>
            <Input aria-label={`Wer darf „${f.pfad}“ nutzen`} placeholder="Alle Angemeldeten (oder E-Mails mit Komma)" value={f.fuer.join(", ")}
              onChange={(e) => setFreigaben(freigaben.map((x, k) => (k === i ? { ...x, fuer: e.target.value.split(/[,;]\s*/).map((t) => t.trim()) } : x)))}
              onBlur={() => setFreigaben(freigaben.map((x) => ({ ...x, fuer: x.fuer.filter(Boolean) })))} />
            <Input aria-label={`Notiz zu „${f.pfad}“`} placeholder="Notiz (optional), z. B. Projektunterlagen KTE" value={f.notiz} onChange={(e) => setFreigaben(freigaben.map((x, k) => (k === i ? { ...x, notiz: e.target.value } : x)))} />
            <Button variant="outline" size="icon-sm" aria-label={`Freigabe „${f.pfad}“ entfernen`} onClick={() => setFreigaben(freigaben.filter((_, k) => k !== i))}><Trash /></Button>
          </div>
        ))}
      </div>
      <div className="rv-lw-browser" role="group" aria-label="Ordner auf dem Netzlaufwerk">
        <nav aria-label="Pfad" className="rv-lw-pfadleiste">
          <button type="button" className="o-chat-link" onClick={() => setPfad("")}>{info.name}</button>
          {teile.map((t, i) => <span key={i}><ChevronRight size={13} aria-hidden="true" /><button type="button" className="o-chat-link" onClick={() => setPfad(teile.slice(0, i + 1).join("/"))}>{t}</button></span>)}
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => freigeben(pfad)}>{pfad ? `„${teile.at(-1)}“ freigeben` : "Ganzes Laufwerk freigeben"}</Button>
        </nav>
        {!ordner ? <p className="hint"><Arbeitet text="Lädt die Ordner" /></p> : !ordner.length ? <p className="hint">Keine Unterordner.</p> : (
          <ul>{ordner.map((o) => <li key={o.pfad}><button type="button" className="rv-lw-ordner" onClick={() => setPfad(o.pfad)}><Folder size={15} aria-hidden="true" />{o.name}</button></li>)}</ul>
        )}
      </div>
      <div className="rv-fuss">
        <Button variant="outline" className="rounded-full" disabled={!!laeuft || info.stand.laeuft} onClick={() => void einlesen()}><RefreshCw aria-hidden="true" />{laeuft === "einlesen" ? <Arbeitet text="Startet" /> : "Jetzt neu einlesen"}</Button>
        <span className="flex-1" />
        <Button className="rounded-full" disabled={!geaendert || !!laeuft} onClick={() => void speichern()}>{laeuft === "speichern" ? <Arbeitet text="Speichert" /> : "Freigaben speichern"}</Button>
      </div>
    </section>
  );
}
