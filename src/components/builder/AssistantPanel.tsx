import { useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { assistentAnwenden } from "@/lib/assistant";
import { KiSimulation, kiModus } from "@/lib/ki";
import type { AssistScope } from "@/lib/sanitize";
import type { Builder } from "./useBuilder";

const VORSCHLAEGE = [
  "Verteile die Eingaben auf zwei Seiten",
  "Füge oben einen Hinweis zum Datenschutz ein",
  "Gestalte es seriös in Dunkelblau mit runden Ecken",
  "Teile den Ablauf in zwei Schritte: erst analysieren, dann Antwort formulieren",
  "Mach daraus ein Agenten-Team aus Planer, Fachexperte und Prüfer",
];

export function AssistantPanel({ b }: { b: Builder }) {
  const [wunsch, setWunsch] = useState("");
  const [scope, setScope] = useState<AssistScope>("alles");
  const [meldung, setMeldung] = useState("");
  const [log, setLog] = useState<{ wunsch: string; zusammenfassung: string }[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const aus = kiModus() === "simulation";
  const [offen, setOffen] = useState(false);

  const umsetzen = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    if (!wunsch.trim()) { setMeldung("Beschreib zuerst, was entstehen oder sich ändern soll."); return; }
    const basis = JSON.stringify(b.app);
    const c = new AbortController();
    ctl.current = c;
    setLaeuft(true);
    setMeldung("Die KI baut um. Das dauert meist 30 bis 90 Sekunden.");
    try {
      const r = await assistentAnwenden(b.app, wunsch.trim(), scope, c.signal);
      if (JSON.stringify(b.app) !== basis) { setMeldung("Du hast währenddessen weitergearbeitet. Der Vorschlag wurde nicht übernommen, schick den Wunsch noch einmal."); return; }
      b.replace(r.app);
      b.setSel(null);
      setLog((l) => [{ wunsch: wunsch.trim(), zusammenfassung: r.zusammenfassung }, ...l].slice(0, 5));
      setWunsch("");
      setMeldung("");
    } catch (e) {
      if (c.signal.aborted) setMeldung("Abgebrochen. Nichts wurde geändert.");
      else if (e instanceof KiSimulation) setMeldung("Der KI-Assistent braucht die zentrale KI-Anbindung. Sie ist in dieser Umgebung nicht konfiguriert.");
      else setMeldung(e instanceof Error ? e.message : "Das Umbauen ist fehlgeschlagen. Versuch es noch einmal.");
    } finally {
      ctl.current = null;
      setLaeuft(false);
    }
  };

  if (aus) return (
    <p className="ai-note">
      <span className="g" aria-hidden="true"><Sparkles size={13} /></span>
      Der KI-Assistent baut Apps nach deiner Beschreibung. Er ist verfügbar, sobald die zentrale KI-Anbindung eingerichtet ist.
    </p>
  );

  return (
    <Collapsible open={offen} onOpenChange={setOffen} asChild>
    <section className="panel ai-box" aria-labelledby="assistent-titel">
      <div className="ai-head">
        <span className="g" aria-hidden="true"><Sparkles size={14} /></span>
        <h2 id="assistent-titel" style={{ fontSize: 18, margin: 0 }}>KI-Assistent</h2>
        <span className="hint" style={{ flex: 1 }}>Beschreib, was entstehen oder sich ändern soll.</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={offen ? "KI-Assistent zuklappen" : "KI-Assistent aufklappen"}>
            {offen ? "Zuklappen" : "Aufklappen"}<ChevronDown style={{ transform: offen ? "rotate(180deg)" : undefined }} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="flex flex-col gap-2.5">
      <label htmlFor="assistent-wunsch" className="sr-only">Wunsch an den KI-Assistenten</label>
      <Textarea id="assistent-wunsch" rows={2} value={wunsch} onChange={(e) => setWunsch(e.target.value)} disabled={laeuft}
        placeholder="z. B. Mach daraus ein Formular für Reisekosten mit Datum, Ziel, Betrag und Beleg-Upload. Oben ein Hinweis zum Datenschutz, Akzentfarbe Dunkelblau." />
      <div className="ai-sugg">{VORSCHLAEGE.map((v) => <button key={v} type="button" onClick={() => setWunsch(v)}>{v}</button>)}</div>
      <div className="flex flex-wrap items-center gap-3">
        {wunsch.trim() && <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v as AssistScope)} aria-label="Was darf die KI ändern?" className="flex-wrap">
          <ToggleGroupItem value="alles" className="rounded-full px-3">Oberfläche und Ablauf</ToggleGroupItem>
          <ToggleGroupItem value="ui" className="rounded-full px-3">Nur Oberfläche</ToggleGroupItem>
          <ToggleGroupItem value="design" className="rounded-full px-3">Nur Design</ToggleGroupItem>
        </ToggleGroup>}
        <Button onClick={() => void umsetzen()} style={{ background: "var(--signal)", color: "var(--signal-ink)" }}>{laeuft ? "Abbrechen" : "Umsetzen"}</Button>
        <span className="hint" aria-live="polite">{meldung}</span>
      </div>
      {log.length > 0 && (
        <ul className="ai-log">
          {log.map((l, i) => (
            <li key={i}><q>{l.wunsch.length > 70 ? l.wunsch.slice(0, 70) + " …" : l.wunsch}</q><span>{l.zusammenfassung}</span>
              {i === 0 && b.canUndo && <Button size="sm" variant="outline" onClick={b.undo}>Rückgängig</Button>}</li>
          ))}
        </ul>
      )}
      </CollapsibleContent>
    </section>
    </Collapsible>
  );
}
