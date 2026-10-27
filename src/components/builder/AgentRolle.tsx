import { useState } from "react";
import { Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KiSimulation } from "@/lib/ki";
import { agentRolle, agentSpeichern, agentenLaden, neueAgentId } from "@/lib/agenten";
import { aufgabeAbstimmen, rolleAufteilen, type AufgabenAbgleich, type RollenAufteilung } from "@/lib/agentenabgleich";
import type { AgentVorlage, Step } from "@/lib/schema";
import { Arbeitet } from "@/components/layout/Arbeitet";
import { Fld, Sel, TextFld } from "./controls";
import type { Builder } from "./useBuilder";

/**
 * Rolle eines KI-Schritts: eigene Rolle oder ein Agent der Bibliothek. Beim Speichern als Agent teilt die KI die Rolle
 * in Agent und App-Teil auf; nach dem Verknüpfen stimmt sie die Aufgabe auf den Agenten ab. Beides als Vorschlag.
 */
export function AgentRolle({ b, i, bibliothek, setBibliothek }: { b: Builder; i: number; bibliothek: AgentVorlage[]; setBibliothek: (l: AgentVorlage[]) => void }) {
  const s = b.app.steps[i]!;
  const [laeuft, setLaeuft] = useState<"aufteilen" | "abstimmen" | "speichern" | null>(null);
  const [aufteilung, setAufteilung] = useState<RollenAufteilung | null>(null);
  const [abgleich, setAbgleich] = useState<(AufgabenAbgleich & { stepId: string; vorher: string }) | null>(null);
  const rollenAgent = s.agent ? bibliothek.find((v) => v.id === s.agent) : undefined;
  /** Änderungen am richtigen Schritt, auch wenn er inzwischen verschoben wurde */
  const amSchritt = (id: string, mut: (st: Step) => void) => b.change((d) => { const st = d.steps.find((x) => x.id === id); if (st) mut(st); });

  const abstimmen = async (v: AgentVorlage, stepId: string, still = false) => {
    const aufgabe = b.aktuell().steps.find((x) => x.id === stepId)?.prompt ?? "";
    if (!aufgabe.trim()) return;
    setLaeuft("abstimmen");
    try {
      const r = await aufgabeAbstimmen(v, aufgabe);
      if (!r.aenderungen.length) { if (!still) toast.success(`Die Aufgabe passt schon zu „${v.name}“.`); return; }
      setAbgleich({ ...r, stepId, vorher: aufgabe });
    } catch (e) {
      if (e instanceof KiSimulation) { if (!still) toast.info("Simulation: Das Abstimmen braucht die KI-Anbindung."); }
      else toast.error(`Abstimmen nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLaeuft(null); }
  };
  const verknuepfen = (id: string) => {
    const v = bibliothek.find((x) => x.id === id);
    if (!v) return;
    amSchritt(s.id, (st) => { st.agent = v.id; st.rolle = agentRolle(v); });
    // Von selbst: die Aufgabe auf den Agenten abstimmen (Vorschlag)
    void abstimmen(v, s.id, true);
  };

  const alsAgent = async () => {
    setLaeuft("aufteilen");
    try { setAufteilung(await rolleAufteilen(s.rolle, s)); }
    catch (e) {
      // Ohne KI: wie bisher, die ganze Rolle wird der Agent
      if (!(e instanceof KiSimulation)) toast.error(`Aufteilen nicht möglich (${e instanceof Error ? e.message : String(e)}); du kannst die Rolle unverändert übernehmen.`);
      setAufteilung({ name: s.name.trim() || "Agent", beschreibung: "", rolle: s.rolle, hinweise: "", aufgabe: "" });
    } finally { setLaeuft(null); }
  };
  const agentAnlegen = async (a: RollenAufteilung) => {
    setLaeuft("speichern");
    try {
      const v = await agentSpeichern({ id: neueAgentId(), name: a.name.trim() || s.name.trim() || "Agent", beschreibung: a.beschreibung, rolle: a.rolle, hinweise: a.hinweise, geaendert: "", erstelltVon: "" });
      setBibliothek(await agentenLaden(true));
      const stepId = s.id;
      amSchritt(stepId, (st) => { st.agent = v.id; st.rolle = agentRolle(v); if (a.aufgabe.trim()) st.prompt = [st.prompt.trim(), a.aufgabe.trim()].filter(Boolean).join("\n\n"); });
      setAufteilung(null);
      toast.success(`„${v.name}“ ist jetzt in der Agentenbibliothek und hier als Rolle verknüpft.${a.aufgabe.trim() ? " Der App-Teil steht jetzt in der Aufgabe." : ""}`);
      await abstimmen(v, stepId, true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Das hat nicht geklappt."); }
    finally { setLaeuft(null); }
  };

  return (
    <>
      {s.agent ? (
        <div className="ki-rollen-agent" role="group" aria-label="Rolle von einem Agenten">
          <span className="lbl text-[13px] font-semibold"><Users size={14} aria-hidden="true" /> Rolle von Agent „{rollenAgent?.name ?? "…"}“</span>
          {rollenAgent?.beschreibung && <p className="hint" style={{ margin: 0 }}>{rollenAgent.beschreibung}</p>}
          {!rollenAgent && bibliothek.length > 0 && <p className="hint" style={{ margin: 0 }}>Diesen Agenten gibt es nicht mehr in der Bibliothek; es gilt die zuletzt übernommene Rolle.</p>}
          <details><summary className="hint">Rolle und Feinjustierung ansehen</summary><pre className="ki-rollen-text">{rollenAgent ? agentRolle(rollenAgent) : s.rolle}</pre></details>
          <p className="hint" style={{ margin: 0 }}>Die Rolle kommt beim Lauf aus der Agentenbibliothek; eine Feinjustierung dort wirkt sofort in allen Apps, die den Agenten nutzen.</p>
          <div className="ag-team-zeile">
            {rollenAgent && <Button variant="outline" size="sm" disabled={!!laeuft || !s.prompt.trim()} onClick={() => void abstimmen(rollenAgent, s.id)} title="Doppeltes aus der Aufgabe streichen und die Gliederung auf den Agenten abstimmen (Vorschlag)">{laeuft === "abstimmen" ? <Arbeitet text="Stimmt ab" /> : <><Sparkles aria-hidden="true" />Aufgabe auf den Agenten abstimmen</>}</Button>}
            <Button variant="outline" size="sm" asChild><a href={`${import.meta.env.BASE_URL}agenten`}>In der Agentenbibliothek bearbeiten</a></Button>
            <Button variant="outline" size="sm" onClick={() => amSchritt(s.id, (st) => { st.agent = ""; if (rollenAgent) st.rolle = agentRolle(rollenAgent); })} title="Die Rolle bleibt als eigene Kopie in dieser App">Verknüpfung lösen</Button>
          </div>
        </div>
      ) : (
        <>
          {bibliothek.length > 0 && <Sel label="Rolle von einem Agenten" value="" options={[["", "Eigene Rolle (unten)"], ...bibliothek.map((v) => [v.id, v.beschreibung ? `${v.name}: ${v.beschreibung.slice(0, 60)}` : v.name] as [string, string])]} onChange={verknuepfen} />}
          <TextFld label="Rolle und Regeln für die KI" multiline rows={2} value={s.rolle} placeholder="z. B. Du bist Assistenz im Vertrieb. Du schreibst sachlich und erfindest keine Preise …" onChange={(v) => b.change((d) => { d.steps[i]!.rolle = v; }, `${s.id}:rolle`)} />
          {s.rolle.trim().length > 20 && <div className="ag-team-zeile"><Button variant="outline" size="sm" disabled={!!laeuft} onClick={() => void alsAgent()} title="Diese Rolle als Agenten in der Bibliothek anlegen, damit andere Apps sie nutzen können">{laeuft === "aufteilen" ? <Arbeitet text="KI teilt die Rolle auf" /> : "Als Agent speichern"}</Button></div>}
        </>
      )}
      {laeuft === "abstimmen" && !abgleich && s.agent && <p className="hint" role="status" style={{ margin: 0 }}><Arbeitet text="KI stimmt die Aufgabe auf den Agenten ab" /></p>}
      {abgleich && abgleich.stepId === s.id && (
        <div className="ki-abgleich" role="group" aria-label="Vorschlag für die Aufgabe">
          <span className="lbl text-[13px] font-semibold"><Sparkles size={14} aria-hidden="true" /> Vorschlag: Aufgabe auf den Agenten abgestimmt</span>
          <ul className="hint">{abgleich.aenderungen.map((a, k) => <li key={k}>{a}</li>)}</ul>
          {abgleich.fehlend.length > 0 && <p className="ki-abgleich-warn" role="alert">Im Vorschlag fehlen Platzhalter: {abgleich.fehlend.map((v) => `{{${v}}}`).join(", ")}. Bitte ergänzen oder verwerfen.</p>}
          <Textarea aria-label="Vorgeschlagene Aufgabe" rows={8} value={abgleich.aufgabe} onChange={(e) => setAbgleich({ ...abgleich, aufgabe: e.target.value })} />
          <div className="ag-team-zeile">
            <Button size="sm" onClick={() => { const neu = abgleich.aufgabe; amSchritt(abgleich.stepId, (st) => { st.prompt = neu; }); setAbgleich(null); toast.success("Aufgabe übernommen. Mit „Rückgängig“ kommst du zur alten Fassung zurück."); }}>Übernehmen</Button>
            <Button size="sm" variant="outline" onClick={() => setAbgleich(null)}>Verwerfen</Button>
            <details className="ki-abgleich-alt"><summary className="hint">Bisherige Aufgabe</summary><pre className="ki-rollen-text">{abgleich.vorher}</pre></details>
          </div>
        </div>
      )}
      <Dialog open={!!aufteilung} onOpenChange={(o) => { if (!o && laeuft !== "speichern") setAufteilung(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Als Agent speichern</DialogTitle>
            <DialogDescription>Die KI hat die Rolle aufgeteilt: Was in jeder App gilt, wird der Agent; was nur in diese App gehört (Ausgabe, Zeitraum), kommt in die Aufgabe dieses Schritts. Alles lässt sich noch ändern.</DialogDescription>
          </DialogHeader>
          {aufteilung && (
            <div className="grid gap-3">
              <TextFld label="Name des Agenten" value={aufteilung.name} onChange={(v) => setAufteilung({ ...aufteilung, name: v })} />
              <TextFld label="Kurzbeschreibung" value={aufteilung.beschreibung} onChange={(v) => setAufteilung({ ...aufteilung, beschreibung: v })} />
              <Fld label="Rolle (gilt in jeder App)" htmlFor="aa-rolle"><Textarea id="aa-rolle" rows={6} value={aufteilung.rolle} onChange={(e) => setAufteilung({ ...aufteilung, rolle: e.target.value })} /></Fld>
              <Fld label="Feinjustierung (Regeln, die immer gelten)" htmlFor="aa-hinw"><Textarea id="aa-hinw" rows={4} value={aufteilung.hinweise} onChange={(e) => setAufteilung({ ...aufteilung, hinweise: e.target.value })} /></Fld>
              <Fld label="Kommt in die Aufgabe dieses Schritts" htmlFor="aa-aufg" hint="Ausgabe, Gliederung, Zeitraum: nur für diese App. Leer lassen, wenn nichts dazukommen soll."><Textarea id="aa-aufg" rows={4} value={aufteilung.aufgabe} onChange={(e) => setAufteilung({ ...aufteilung, aufgabe: e.target.value })} /></Fld>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={laeuft === "speichern"} onClick={() => setAufteilung(null)}>Abbrechen</Button>
            <Button disabled={laeuft === "speichern" || !aufteilung?.rolle.trim()} onClick={() => aufteilung && void agentAnlegen(aufteilung)}>{laeuft === "speichern" ? <Arbeitet text="Speichert" /> : "Agent anlegen und verknüpfen"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
