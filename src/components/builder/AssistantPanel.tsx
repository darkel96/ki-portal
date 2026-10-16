import { useRef, useState } from "react";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { assistentAnwenden, standUhr } from "@/lib/assistant";
import { KiSimulation } from "@/lib/ki";
import { useKiModus } from "@/components/layout/KiSchluessel";
import type { App } from "@/lib/schema";
import type { AssistScope } from "@/lib/sanitize";
import type { Builder } from "./useBuilder";

/** Kurze zuerst: In die eine Zeile passen so mehr Vorschläge */
const VORSCHLAEGE = [
  "Verteile die Eingaben auf zwei Seiten",
  "Gestalte es seriös in Dunkelblau mit runden Ecken",
  "Mach daraus ein Agenten-Team aus Planer, Fachexperte und Prüfer",
  "Lies die hochgeladene Datei und lass die Werte auf einer Prüfseite mit Auswahlfeldern bestätigen",
  "Erzeuge am Ende ein ZIP mit Ordnerstruktur und den Originalvorlagen aus SharePoint",
];
/** Wortlaut der Erfolgsmeldung je Umfang: „Nur Design“ darf keine Strukturänderungen behaupten. */
const UMFANG: Record<AssistScope, string> = { alles: "Umgebaut", ui: "Nur Oberfläche übernommen", design: "Nur Gestaltung übernommen" };

type Meldung = { art: "info" | "ok" | "fehler"; text: string } | null;
export type AssistZustand = { offen: boolean; wunsch: string; scope: AssistScope; meldung: Meldung; log: { wunsch: string; zusammenfassung: string }[]; laeuft: boolean };

/** Zustand des Assistenten lebt im Editor: Tab-Wechsel und Vorschau verwerfen Log, Meldung und Wunsch nicht. */
export function useAssistZustand(app: App) {
  // Neue, noch nie gespeicherte Apps: Assistent gleich aufgeklappt, außer das Fenster ist niedrig oder schmal (dann bleibt die Fläche sichtbar).
  const [st, setSt] = useState<AssistZustand>(() => ({ offen: !app.id && window.innerHeight >= 800 && window.innerWidth > 640, wunsch: "", scope: "alles", meldung: null, log: [], laeuft: false }));
  const ctl = useRef<AbortController | null>(null);
  return { st, setSt, ctl };
}
export type Assist = ReturnType<typeof useAssistZustand>;

export function AssistantPanel({ b, a }: { b: Builder; a: Assist }) {
  const { st, setSt, ctl } = a;
  const { offen, wunsch, scope, meldung, log, laeuft } = st;
  const patch = (p: Partial<AssistZustand>) => setSt((s) => ({ ...s, ...p }));
  const aus = useKiModus() === "simulation";

  const umsetzen = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    if (!wunsch.trim()) { patch({ meldung: { art: "fehler", text: "Beschreib zuerst, was entstehen oder sich ändern soll." } }); return; }
    // b.app ist hier eine alte Closure: Vergleich gegen den jeweils neuesten Stand.
    const vorlage = b.aktuell();
    const basis = JSON.stringify(vorlage);
    const c = new AbortController();
    ctl.current = c;
    patch({ laeuft: true });
    // Live-Stand statt fester Zeitangabe: Man sieht, dass die KI arbeitet und wie weit die Antwort ist
    const uhr = standUhr((text) => { if (!c.signal.aborted) patch({ meldung: { art: "info", text } }); });
    try {
      const r = await assistentAnwenden(vorlage, wunsch.trim(), scope, c.signal, uhr.zeichen);
      uhr.stopp();
      if (JSON.stringify(b.aktuell()) !== basis) { patch({ meldung: { art: "fehler", text: "Du hast währenddessen weitergearbeitet. Der Vorschlag wurde nicht übernommen, schick den Wunsch noch einmal." } }); return; }
      b.replace(r.app);
      b.setSel(null);
      const text = `${UMFANG[scope]}: ${r.zusammenfassung}`;
      setSt((s) => ({ ...s, log: [{ wunsch: wunsch.trim(), zusammenfassung: scope === "alles" ? r.zusammenfassung : text }, ...s.log].slice(0, 5), wunsch: "", meldung: { art: "ok", text } }));
    } catch (e) {
      if (c.signal.aborted) patch({ meldung: { art: "info", text: "Abgebrochen. Nichts wurde geändert." } });
      else if (e instanceof KiSimulation) patch({ meldung: { art: "fehler", text: "Der KI-Assistent braucht die zentrale KI-Anbindung. Sie ist in dieser Umgebung nicht eingerichtet." } });
      else patch({ meldung: { art: "fehler", text: e instanceof Error ? e.message : "Das Umbauen ist fehlgeschlagen. Versuch es noch einmal." } });
    } finally {
      uhr.stopp();
      ctl.current = null;
      patch({ laeuft: false });
    }
  };

  if (aus) return (
    <p className="ai-note">
      <span className="g" aria-hidden="true"><Sparkles size={13} /></span>
      Der KI-Assistent baut Apps nach deiner Beschreibung. Die KI-Anbindung ist hier nicht eingerichtet. Du kannst im Baukasten selbst bauen.
    </p>
  );

  return (
    <Collapsible open={offen} onOpenChange={(o) => patch({ offen: o })} asChild>
    <section className="panel ai-box" aria-labelledby="assistent-titel" aria-busy={laeuft || undefined}>
      <div className="ai-head">
        <span className="g" aria-hidden="true"><Sparkles size={14} /></span>
        <h2 id="assistent-titel">KI-Assistent</h2>
        {laeuft
          ? <span className="status-pill mit-icon" data-s="laeuft"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Die KI baut um …</span>
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
      <CollapsibleContent className="ai-inhalt flex flex-col gap-2.5">
      <label htmlFor="assistent-wunsch" className="sr-only">Wunsch an den KI-Assistenten</label>
      <Textarea id="assistent-wunsch" rows={2} value={wunsch} onChange={(e) => patch({ wunsch: e.target.value })} disabled={laeuft}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && wunsch.trim()) { e.preventDefault(); void umsetzen(); } }} aria-keyshortcuts="Control+Enter"
        placeholder="z. B. Mach daraus ein Formular für Reisekosten mit Datum, Ziel, Betrag und Beleg-Upload. Oben ein Hinweis zum Datenschutz, Akzentfarbe Dunkelblau …" />
      {/* Vorschläge nur, solange das Feld leer ist: Sie füllen es ohnehin nur vor und kosten sonst Platz */}
      {!wunsch.trim() && <div className="ai-sugg">{VORSCHLAEGE.map((v) => <button key={v} type="button" title={v} disabled={laeuft} onClick={() => patch({ wunsch: v })}>{v}</button>)}</div>}
      {/* Feste Fußzeile im Klappbereich: „Umsetzen“ bleibt auch bei langem Wunsch und niedrigem Fenster sichtbar */}
      <div className="ai-aktion flex flex-wrap items-center gap-3">
        {wunsch.trim() && <ToggleGroup type="single" variant="outline" size="sm" value={scope} disabled={laeuft} onValueChange={(v) => v && patch({ scope: v as AssistScope })} aria-label="Was darf die KI ändern?" className="flex-wrap">
          <ToggleGroupItem value="alles" className="rounded-full px-3">Oberfläche und Ablauf</ToggleGroupItem>
          <ToggleGroupItem value="ui" className="rounded-full px-3">Nur Oberfläche</ToggleGroupItem>
          <ToggleGroupItem value="design" className="rounded-full px-3">Nur Design</ToggleGroupItem>
        </ToggleGroup>}
        {laeuft
          ? <Button variant="outline" onClick={() => ctl.current?.abort()}><X aria-hidden="true" />Abbrechen</Button>
          : <Button variant="outline" className="ai-umsetzen" onClick={() => void umsetzen()}><Sparkles aria-hidden="true" />Umsetzen</Button>}
        {!laeuft && wunsch.trim() && <span className="hint nur-breit">oder Strg+Enter</span>}
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
