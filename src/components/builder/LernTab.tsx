/**
 * Reiter „Lernen“ im Baukasten: die Lernschicht eines Fachexperten-Chats. Zeigt Rückmeldungen, lässt auswerten,
 * und gibt Vorschläge frei (annehmen, ändern, verwerfen). Freigegebenes landet als neue Fassung der Hausregeln
 * im KI-Schritt; live geht es erst mit dem Speichern der Applikation. Rolle und Belegregel bleiben unberührt.
 */
import { useEffect, useState } from "react";
import { Check, History, Loader2, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { chatSteps } from "@/lib/model";
import type { Step } from "@/lib/schema";
import { ART_LABEL, hausregelnFassung, hausregelnText, neueSeit, statistik, type LernStand, type Vorschlag } from "@/lib/lernen";
import { auswerten, lernStand, vorschlagStand } from "@/lib/lernenBrowser";
import { KiSimulation } from "@/lib/ki";
import { Fld } from "./controls";
import type { Builder } from "./useBuilder";

export function LernTab({ b }: { b: Builder }) {
  const chat = chatSteps(b.app);
  const steps = b.app.steps.filter((s) => chat.has(s.id));
  if (!steps.length) {
    return <div className="ki-teil"><p className="hint">Die Lernschicht gilt für Fachexperten-Chats. Lege auf der Oberfläche einen Chat-Baustein an und verbinde ihn mit einem KI-Schritt.</p></div>;
  }
  return <div className="lern-tab">{steps.map((s) => <LernSchritt key={s.id} b={b} step={s} />)}</div>;
}

function LernSchritt({ b, step }: { b: Builder; step: Step }) {
  const appId = b.app.id ?? "";
  const [stand, setStand] = useState<LernStand | null>(null);
  const [entwurf, setEntwurf] = useState(hausregelnText(step));
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [bearbeitet, setBearbeitet] = useState<Record<string, string>>({});
  const [fassungenAuf, setFassungenAuf] = useState(false);
  const aktuell = hausregelnText(step);
  useEffect(() => { setEntwurf(hausregelnText(step)); }, [step.hausregeln]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (appId) void lernStand(appId).then(setStand).catch(() => setStand(null)); }, [appId]);

  const fassung = (text: string, warum: string) => {
    b.change((d) => { const s = d.steps.find((x) => x.id === step.id); if (s) s.hausregeln = hausregelnFassung(s, text, warum).hausregeln; });
    setGrund("");
  };
  const entscheiden = async (v: Vorschlag, neu: Vorschlag["stand"], text?: string) => {
    if (neu === "angenommen") {
      const t = (text ?? v.text).trim();
      if (!t) return;
      fassung([aktuell, `- ${t}`].filter(Boolean).join("\n"), `Vorschlag (${ART_LABEL[v.art]}) aus der Auswertung angenommen`);
    }
    try { setStand(await vorschlagStand(appId, v.id, neu)); } catch { toast.error("Der Stand des Vorschlags konnte nicht gespeichert werden."); }
    setBearbeitet(({ [v.id]: _, ...rest }) => rest);
  };
  const auswertenKlick = async () => {
    setLaeuft(true);
    try {
      const st = await auswerten(b.app, step);
      setStand(st);
      const offen = st.vorschlaege.filter((v) => v.stepId === step.id && v.stand === "offen").length;
      toast.success(offen ? `${offen} ${offen === 1 ? "Vorschlag" : "Vorschläge"} zur Freigabe.` : "Keine neuen Vorschläge. Die Rückmeldungen geben nichts her, was noch nicht in den Hausregeln steht.");
    } catch (e) {
      toast.error(e instanceof KiSimulation ? "Ohne KI-Anbindung gibt es keine Auswertung (Simulationsmodus)." : `Auswertung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    } finally { setLaeuft(false); }
  };

  const st = stand ?? { rueckmeldungen: [], vorschlaege: [], letzteAuswertung: {}, zusammenfassung: {} };
  const zahlen = statistik(st, step.id);
  const neu = neueSeit(st, step.id).length;
  const offen = st.vorschlaege.filter((v) => v.stepId === step.id && v.stand === "offen");
  const letzte = st.letzteAuswertung[step.id];
  const fassungen = [...step.hausregeln.fassungen].reverse();

  return (
    <section className="ki-teil lern-schritt" aria-label={`Lernen: ${step.name}`}>
      <div className="box neutral">
        <span className="text-[13px] font-semibold">Wie der Experte „{step.name}“ dazulernt</span>
        <p className="hint" style={{ margin: 0 }}>Die Rolle (Tonfall, Belegregel) bleibt fest. Dazu kommt ein Block „Hausregeln“, der nur durch deine Freigabe wächst: Rückmeldungen aus dem Chat werden per KI ausgewertet, du nimmst Vorschläge an oder verwirfst sie. Live geht eine neue Fassung mit dem Speichern der Applikation.</p>
      </div>

      <div className="box neutral">
        <span className="lbl text-[13px] font-semibold">Rückmeldungen der letzten {zahlen.tage} Tage</span>
        {!appId ? <p className="hint" style={{ margin: 0 }}>Rückmeldungen gibt es, sobald die Applikation gespeichert ist und im Hub genutzt wird.</p> : (
          <dl className="lern-zahlen">
            <div><dt>Hilfreich</dt><dd>{zahlen.gut}</dd></div>
            <div><dt>Nicht hilfreich</dt><dd>{zahlen.schlecht}</dd></div>
            <div><dt>Ohne Fundstelle</dt><dd>{zahlen.ohneQuelle}</dd></div>
            <div><dt>Seit der letzten Auswertung</dt><dd>{neu}</dd></div>
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!appId || laeuft || !zahlen.gesamt} onClick={() => void auswertenKlick()}>{laeuft ? <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Wertet aus …</> : <><Sparkles aria-hidden="true" />Jetzt auswerten</>}</Button>
          <Button size="sm" variant="ghost" disabled={!appId} aria-label="Rückmeldungen neu laden" onClick={() => void lernStand(appId).then(setStand)}><RefreshCw aria-hidden="true" /></Button>
          <span className="hint" style={{ margin: 0 }}>{letzte ? `Zuletzt ausgewertet am ${new Date(letzte).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}.` : "Noch nicht ausgewertet."} Mit Hub-Dienst läuft die Auswertung auch von selbst, sobald genug neue Rückmeldungen da sind.</span>
        </div>
        {st.zusammenfassung[step.id] && <p className="hint" style={{ margin: 0 }}><b>Auswertung:</b> {st.zusammenfassung[step.id]}</p>}
      </div>

      {offen.length > 0 && (
        <div className="box neutral">
          <span className="lbl text-[13px] font-semibold">Vorschläge zur Freigabe ({offen.length})</span>
          <ul className="lern-vorschlaege">
            {offen.map((v) => (
              <li key={v.id}>
                <span className="status-pill" data-s="wartet">{ART_LABEL[v.art]}</span>
                {v.id in bearbeitet
                  ? <Textarea rows={2} value={bearbeitet[v.id]} aria-label="Vorschlag bearbeiten" onChange={(e) => setBearbeitet((x) => ({ ...x, [v.id]: e.target.value }))} />
                  : <p className="lern-text">{v.text}</p>}
                <p className="hint" style={{ margin: 0 }}>{v.begruendung}{v.belege ? ` (${v.belege} ${v.belege === 1 ? "Rückmeldung" : "Rückmeldungen"})` : ""}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => void entscheiden(v, "angenommen", bearbeitet[v.id])}><Check aria-hidden="true" />Annehmen</Button>
                  {!(v.id in bearbeitet) && <Button size="sm" variant="outline" onClick={() => setBearbeitet((x) => ({ ...x, [v.id]: v.text }))}><Pencil aria-hidden="true" />Ändern</Button>}
                  <Button size="sm" variant="ghost" onClick={() => void entscheiden(v, "verworfen")}><X aria-hidden="true" />Verwerfen</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="box neutral">
        <Fld label="Hausregeln und Kontext (gelernt, freigegeben)" htmlFor={`hr-${step.id}`} hint="Wird in jeder Anfrage an die Rolle angehängt. Du kannst hier auch selbst ergänzen oder kürzen; jede Übernahme ist eine neue Fassung.">
          <Textarea id={`hr-${step.id}`} rows={6} value={entwurf} placeholder="Noch keine Hausregeln. Beispiel: „- KSCA-Kollegen meinen mit ‚BA‘ die Business Area.“" onChange={(e) => setEntwurf(e.target.value)} />
        </Fld>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={grund} placeholder="Grund der Änderung (optional)" aria-label="Grund der Änderung" className="w-72" onChange={(e) => setGrund(e.target.value)} />
          <Button size="sm" disabled={entwurf.trim() === aktuell} onClick={() => fassung(entwurf, grund || "Im Baukasten geändert")}><Check aria-hidden="true" />Als neue Fassung übernehmen</Button>
          {fassungen.length > 0 && <Button size="sm" variant="ghost" aria-expanded={fassungenAuf} onClick={() => setFassungenAuf((x) => !x)}><History aria-hidden="true" />{fassungen.length} {fassungen.length === 1 ? "Fassung" : "Fassungen"}</Button>}
        </div>
        {fassungenAuf && (
          <ol className="lern-fassungen" aria-label="Fassungen der Hausregeln">
            {fassungen.map((f, i) => (
              <li key={f.nr}>
                <b>Fassung {f.nr}</b> · {f.datum}{f.grund ? ` · ${f.grund}` : ""}{i === 0 && " · gilt"}
                {i > 0 && <Button size="sm" variant="ghost" onClick={() => fassung(f.text, `Zurück zu Fassung ${f.nr}`)}>Zurückdrehen</Button>}
                <pre className="lern-fassung-text">{f.text || "(leer)"}</pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
