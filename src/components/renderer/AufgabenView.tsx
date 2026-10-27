import { useEffect, useState, type CSSProperties } from "react";
import { ListTodo } from "lucide-react";
import { toast } from "sonner";
import type { Block } from "@/lib/schema";
import { KiSimulation } from "@/lib/ki";
import { aufgabeAnlegen, aufgabenAusText, aufgabenEcht, bucketsLaden, listenLaden, personFinden, plaeneLaden, vorhandeneTitel, type Ablage, type Aufgabe, type AufgabenZiel, type Prioritaet } from "@/lib/ki/aufgaben";
import { Arbeitet } from "@/components/layout/Arbeitet";
import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";

type Zeile = Aufgabe & { an: boolean; schonDa: boolean; angelegt: boolean };
const ZIEL_LABEL: Record<AufgabenZiel, string> = { planner: "Team-Aufgaben (Planner)", todo: "Meine Aufgaben (To Do)" };
const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Aufgaben aus einem KI-Ergebnis in Planner oder Microsoft To Do anlegen: Die KI liest die Aufgaben aus dem Ergebnis,
 * die Person prüft und ändert sie in einer Tabelle (vorhandene mit gleichem Titel sind abgewählt), dann legt der Hub sie an.
 */
export function AufgabenView({ b, mode, app }: { b: Extract<Block, { type: "aufgaben" }>; mode: Mode; app: { steps: { id: string; name: string }[] } }) {
  const run = useRun();
  const P = b.props;
  const schritt = app.steps.find((s) => s.id === P.quelle);
  const out = run?.outs[P.quelle];
  const bereit = !!out && (out.status === "fertig" || out.status === "simuliert") && !!out.text;
  const [ziel, setZiel] = useState<AufgabenZiel>(P.ziel);
  const [ablagen, setAblagen] = useState<Ablage[] | null>(null);
  const [ablageId, setAblageId] = useState("");
  const [buckets, setBuckets] = useState<Ablage[]>([]);
  const [bucketId, setBucketId] = useState("");
  const [zeilen, setZeilen] = useState<Zeile[] | null>(null);
  const [phase, setPhase] = useState("");
  const [meldung, setMeldung] = useState("");

  // Pläne bzw. Listen laden (vorgewählt nach Name aus dem Baukasten), sobald Aufgaben da sind oder das Ziel wechselt
  useEffect(() => {
    if (!zeilen) return;
    let aus = false;
    setAblagen(null);
    (ziel === "planner" ? plaeneLaden() : listenLaden()).then((l) => {
      if (aus) return;
      setAblagen(l);
      setAblageId((P.plan && l.find((x) => gleich(x.name, P.plan))?.id) || (ziel === "todo" ? l[0]?.id ?? "" : l.length === 1 ? l[0]!.id : ""));
    }, (e) => { if (!aus) { setAblagen([]); toast.error(e instanceof Error ? e.message : String(e)); } });
    return () => { aus = true; };
  }, [ziel, !!zeilen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Buckets des Plans und vorhandene Aufgaben (nichts doppelt anlegen)
  useEffect(() => {
    if (!ablageId || !zeilen) return;
    let aus = false;
    void (async () => {
      try {
        if (ziel === "planner") {
          const bl = await bucketsLaden(ablageId);
          if (aus) return;
          setBuckets(bl);
          setBucketId((P.bucket && bl.find((x) => gleich(x.name, P.bucket))?.id) || bl[0]?.id || "");
        } else { setBuckets([]); setBucketId(""); }
        const da = await vorhandeneTitel(ziel, ablageId);
        if (!aus) setZeilen((z) => z?.map((x) => { const schonDa = da.has(x.titel.trim().toLowerCase()); return x.angelegt ? x : { ...x, schonDa, an: schonDa ? false : x.schonDa ? true : x.an }; }) ?? z);
      } catch (e) { if (!aus) toast.error(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { aus = true; };
  }, [ablageId, ziel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode !== "run" || !run) {
    return (
      <div className="o-aufgaben">
        <div className="o-aufgaben-kopf"><ListTodo size={16} aria-hidden="true" /><b>{P.titel}</b></div>
        <p className="o-muted">Übernimmt die Aufgaben aus „{schritt?.name ?? "…"}“ nach {ZIEL_LABEL[P.ziel]}{P.plan ? ` „${P.plan}“` : ""}. Die Person prüft sie vorher.</p>
      </div>
    );
  }

  const lesen = async () => {
    if (!out?.text) return;
    setPhase("KI liest die Aufgaben aus dem Ergebnis"); setMeldung(""); setZeilen(null);
    try {
      const l = await aufgabenAusText(out.text);
      setZeilen(l.map((a) => ({ ...a, an: true, schonDa: false, angelegt: false })));
      if (!l.length) setMeldung(`In „${schritt?.name ?? "dem Ergebnis"}“ stehen keine offenen Aufgaben.`);
    } catch (e) {
      if (e instanceof KiSimulation) setMeldung("Simulation: Das Lesen der Aufgaben braucht die KI-Anbindung.");
      else toast.error(`Aufgaben lesen nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setPhase(""); }
  };
  const aendern = (i: number, teil: Partial<Zeile>) => setZeilen((z) => z?.map((x, k) => (k === i ? { ...x, ...teil } : x)) ?? z);
  const gewaehlt = (zeilen ?? []).filter((z) => z.an && !z.angelegt);
  const ablageName = ablagen?.find((a) => a.id === ablageId)?.name ?? "";
  const wohin = ziel === "planner" && bucketId ? `${ablageName} › ${buckets.find((x) => x.id === bucketId)?.name ?? ""}` : ablageName;
  const anlegen = async () => {
    if (!ablageId || !gewaehlt.length) return;
    const ohne: string[] = [];
    let n = 0;
    try {
      for (const z of gewaehlt) {
        setPhase(`Legt an: ${n + 1} von ${gewaehlt.length}`);
        const person = ziel === "planner" && z.zustaendig ? await personFinden(z.zustaendig) : null;
        if (ziel === "planner" && z.zustaendig && !person) ohne.push(z.zustaendig);
        await aufgabeAnlegen(ziel, { ablageId, bucketId: bucketId || undefined }, z, person);
        n++;
        setZeilen((alt) => alt?.map((x) => (x === z || (x.titel === z.titel && x.an) ? { ...x, angelegt: true } : x)) ?? alt);
      }
      const text = `${n} ${n === 1 ? "Aufgabe" : "Aufgaben"} in „${wohin}“ angelegt.${ohne.length ? ` Ohne Zuständigen (nicht eindeutig gefunden, steht in der Notiz): ${[...new Set(ohne)].join(", ")}.` : ""}`;
      setMeldung(text); toast.success(text);
    } catch (e) {
      const text = `${n ? `${n} von ${gewaehlt.length} angelegt, dann: ` : ""}${e instanceof Error ? e.message : String(e)}`;
      setMeldung(text); toast.error(text);
    } finally { setPhase(""); }
  };
  const knopf = { "--btn": "var(--app-accent)", "--btn-ink": "var(--app-accent-ink)" } as CSSProperties;

  return (
    <div className="o-aufgaben">
      <div className="o-aufgaben-kopf">
        <ListTodo size={16} aria-hidden="true" /><b>{P.titel}</b>
        <span className="flex-1" />
        {!aufgabenEcht() && <span className="o-muted">Beispielpläne (ohne Copilot-Anmeldung)</span>}
        <button type="button" className="o-btn" style={knopf} disabled={!bereit || !!phase} onClick={() => void lesen()}>
          {phase.startsWith("KI") ? <Arbeitet text="Liest" /> : zeilen ? "Neu lesen" : `Aufgaben aus „${schritt?.name ?? "Ergebnis"}“ übernehmen`}
        </button>
      </div>
      {!bereit && <p className="o-muted">Erst wenn „{schritt?.name ?? "der Schritt"}“ fertig ist, lassen sich die Aufgaben übernehmen.</p>}
      {phase && <p className="o-muted" role="status"><Arbeitet text={phase} /></p>}
      {meldung && <p className="o-muted" role="status">{meldung}</p>}
      {zeilen && zeilen.length > 0 && (
        <div role="group" aria-label="Aufgaben zum Anlegen">
          <div className="o-aufgaben-ziel">
            <label>Wohin<select value={ziel} onChange={(e) => { setZiel(e.target.value as AufgabenZiel); setAblageId(""); }} aria-label="Wohin">{(Object.keys(ZIEL_LABEL) as AufgabenZiel[]).map((z) => <option key={z} value={z}>{ZIEL_LABEL[z]}</option>)}</select></label>
            <label>{ziel === "planner" ? "Plan" : "Liste"}
              <select value={ablageId} onChange={(e) => setAblageId(e.target.value)} aria-label={ziel === "planner" ? "Plan" : "Liste"} disabled={!ablagen}>
                <option value="">{!ablagen ? "Lädt …" : ablagen.length ? "Bitte wählen" : "Keine gefunden"}</option>
                {(ablagen ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {ziel === "planner" && buckets.length > 0 && <label>Bucket<select value={bucketId} onChange={(e) => setBucketId(e.target.value)} aria-label="Bucket">{buckets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            <span className="flex-1" />
            <button type="button" className="o-btn" style={knopf} disabled={!ablageId || !gewaehlt.length || !!phase} onClick={() => void anlegen()}>
              {phase.startsWith("Legt") ? <Arbeitet text="Legt an" /> : `${gewaehlt.length} ${gewaehlt.length === 1 ? "Aufgabe" : "Aufgaben"} anlegen`}
            </button>
          </div>
          {ziel === "todo" && <p className="o-muted">In „Meine Aufgaben“ gibt es keine Zuständigen; Namen stehen dann in der Notiz.</p>}
          <div className="o-aufgaben-tabelle" role="region" aria-label="Aufgaben" tabIndex={0}>
            <table>
              <thead><tr><th scope="col"><span className="sr-only">Anlegen</span></th><th scope="col">Aufgabe</th><th scope="col">Fällig</th><th scope="col">Zuständig</th><th scope="col">Priorität</th></tr></thead>
              <tbody>
                {zeilen.map((z, i) => (
                  <tr key={i} data-angelegt={z.angelegt || undefined}>
                    <td><input type="checkbox" checked={z.an && !z.angelegt} disabled={z.angelegt} aria-label={`„${z.titel}“ anlegen`} onChange={(e) => aendern(i, { an: e.target.checked })} /></td>
                    <td>
                      <input value={z.titel} disabled={z.angelegt} aria-label="Aufgabe" onChange={(e) => aendern(i, { titel: e.target.value })} />
                      {z.notiz && <span className="o-muted o-aufgaben-notiz">{z.notiz}</span>}
                      {z.schonDa && !z.angelegt && <span className="o-aufgaben-da">Gibt es schon in „{ablageName}“</span>}
                      {z.angelegt && <span className="o-aufgaben-ok">Angelegt</span>}
                    </td>
                    <td><input type="date" value={z.faellig} disabled={z.angelegt} aria-label={`Fällig: ${z.titel}`} onChange={(e) => aendern(i, { faellig: e.target.value })} /></td>
                    <td><input value={z.zustaendig} disabled={z.angelegt} placeholder="festzulegen" aria-label={`Zuständig: ${z.titel}`} onChange={(e) => aendern(i, { zustaendig: e.target.value })} /></td>
                    <td><select value={z.prioritaet} disabled={z.angelegt} aria-label={`Priorität: ${z.titel}`} onChange={(e) => aendern(i, { prioritaet: e.target.value as Prioritaet })}><option value="hoch">Hoch</option><option value="mittel">Mittel</option><option value="niedrig">Niedrig</option></select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
