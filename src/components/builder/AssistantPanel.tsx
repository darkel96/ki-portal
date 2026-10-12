import { useRef, useState } from "react";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { assistentAnwenden } from "@/lib/assistant";
import { KiSimulation } from "@/lib/ki";
import { useKiModus } from "@/components/layout/KiSchluessel";
import type { AssistScope } from "@/lib/sanitize";
import type { Builder } from "./useBuilder";

const VORSCHLAEGE = [
  "Verteile die Eingaben auf zwei Seiten",
  "Füge oben einen Hinweis zum Datenschutz ein",
  "Gestalte es seriös in Dunkelblau mit runden Ecken",
  "Teile den Ablauf in zwei Schritte: erst analysieren, dann Antwort formulieren",
  "Mach daraus ein Agenten-Team aus Planer, Fachexperte und Prüfer",
];

type Meldung = { art: "info" | "ok" | "fehler"; text: string } | null;

export function AssistantPanel({ b }: { b: Builder }) {
  const [wunsch, setWunsch] = useState("");
  const [scope, setScope] = useState<AssistScope>("alles");
  const [meldung, setMeldung] = useState<Meldung>(null);
  const [log, setLog] = useState<{ wunsch: string; zusammenfassung: string }[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const aus = useKiModus() === "simulation";
  // Neue, noch nie gespeicherte Apps: Assistent gleich aufgeklappt.
  const [offen, setOffen] = useState(() => !b.app.id);

  const umsetzen = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    if (!wunsch.trim()) { setMeldung({ art: "fehler", text: "Beschreib zuerst, was entstehen oder sich ändern soll." }); return; }
    // b.app ist hier eine alte Closure: Vergleich gegen den jeweils neuesten Stand.
    const vorlage = b.aktuell();
    const basis = JSON.stringify(vorlage);
    const c = new AbortController();
    ctl.current = c;
    setLaeuft(true);
    setMeldung({ art: "info", text: "Die KI baut um. Das dauert meist 30 bis 90 Sekunden." });
    try {
      const r = await assistentAnwenden(vorlage, wunsch.trim(), scope, c.signal);
      if (JSON.stringify(b.aktuell()) !== basis) { setMeldung({ art: "fehler", text: "Du hast währenddessen weitergearbeitet. Der Vorschlag wurde nicht übernommen, schick den Wunsch noch einmal." }); return; }
      b.replace(r.app);
      b.setSel(null);
      setLog((l) => [{ wunsch: wunsch.trim(), zusammenfassung: r.zusammenfassung }, ...l].slice(0, 5));
      setWunsch("");
      setMeldung({ art: "ok", text: `Umgebaut: ${r.zusammenfassung}` });
    } catch (e) {
      if (c.signal.aborted) setMeldung({ art: "info", text: "Abgebrochen. Nichts wurde geändert." });
      else if (e instanceof KiSimulation) setMeldung({ art: "fehler", text: "Der KI-Assistent braucht die zentrale KI-Anbindung. Sie ist in dieser Umgebung nicht eingerichtet." });
      else setMeldung({ art: "fehler", text: e instanceof Error ? e.message : "Das Umbauen ist fehlgeschlagen. Versuch es noch einmal." });
    } finally {
      ctl.current = null;
      setLaeuft(false);
    }
  };

  if (aus) return (
    <p className="ai-note">
      <span className="g" aria-hidden="true"><Sparkles size={13} /></span>
      Der KI-Assistent baut Apps nach deiner Beschreibung. Die KI-Anbindung ist hier nicht eingerichtet. Du kannst im Baukasten selbst bauen.
    </p>
  );

  return (
    <Collapsible open={offen} onOpenChange={setOffen} asChild>
    <section className="panel ai-box" aria-labelledby="assistent-titel" aria-busy={laeuft || undefined}>
      <div className="ai-head">
        <span className="g" aria-hidden="true"><Sparkles size={14} /></span>
        <h2 id="assistent-titel" style={{ fontSize: 18, margin: 0 }}>KI-Assistent</h2>
        {laeuft
          ? <span className="status-pill mit-icon" data-s="laeuft"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Die KI baut um …</span>
          : <span className="hint ai-unterzeile">Beschreib, was entstehen oder sich ändern soll.</span>}
        <span className="flex-1" />
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={offen ? "KI-Assistent zuklappen" : "KI-Assistent aufklappen"}>
            {offen ? "Zuklappen" : "Aufklappen"}<ChevronDown style={{ transform: offen ? "rotate(180deg)" : undefined }} />
          </Button>
        </CollapsibleTrigger>
      </div>
      {/* Außerhalb des Klappbereichs: Meldungen bleiben sichtbar und werden auch zugeklappt angesagt. */}
      <p className="ai-meldung" role="status" data-art={meldung?.art}>{meldung && meldung.art !== "fehler" ? meldung.text : ""}</p>
      {meldung?.art === "fehler" && <p className="ai-meldung" role="alert" data-art="fehler">{meldung.text}</p>}
      <CollapsibleContent className="flex flex-col gap-2.5">
      <label htmlFor="assistent-wunsch" className="sr-only">Wunsch an den KI-Assistenten</label>
      <Textarea id="assistent-wunsch" rows={2} value={wunsch} onChange={(e) => setWunsch(e.target.value)} disabled={laeuft}
        placeholder="z. B. Mach daraus ein Formular für Reisekosten mit Datum, Ziel, Betrag und Beleg-Upload. Oben ein Hinweis zum Datenschutz, Akzentfarbe Dunkelblau …" />
      <div className="ai-sugg">{VORSCHLAEGE.map((v) => <button key={v} type="button" disabled={laeuft} onClick={() => setWunsch(v)}>{v}</button>)}</div>
      <div className="flex flex-wrap items-center gap-3">
        {wunsch.trim() && <ToggleGroup type="single" variant="outline" size="sm" value={scope} disabled={laeuft} onValueChange={(v) => v && setScope(v as AssistScope)} aria-label="Was darf die KI ändern?" className="flex-wrap">
          <ToggleGroupItem value="alles" className="rounded-full px-3">Oberfläche und Ablauf</ToggleGroupItem>
          <ToggleGroupItem value="ui" className="rounded-full px-3">Nur Oberfläche</ToggleGroupItem>
          <ToggleGroupItem value="design" className="rounded-full px-3">Nur Design</ToggleGroupItem>
        </ToggleGroup>}
        {laeuft
          ? <Button variant="outline" onClick={() => ctl.current?.abort()}><X aria-hidden="true" />Abbrechen</Button>
          : <Button className="ki-knopf" onClick={() => void umsetzen()}><Sparkles aria-hidden="true" />Umsetzen</Button>}
      </div>
      {log.length > 0 && (
        <ul className="ai-log">
          {log.map((l, i) => (
            <li key={i}><q>{l.wunsch.length > 70 ? l.wunsch.slice(0, 70).trimEnd() + "…" : l.wunsch}</q><span>{l.zusammenfassung}</span>
              {i === 0 && b.canUndo && <Button size="sm" variant="outline" onClick={b.undo}>Rückgängig</Button>}</li>
          ))}
        </ul>
      )}
      </CollapsibleContent>
    </section>
    </Collapsible>
  );
}
