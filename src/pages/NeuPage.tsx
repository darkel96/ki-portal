import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApps } from "@/state/apps";
import { useRechte } from "@/state/rechte";
import { KeineRechte } from "@/pages/VerwaltungPage";
import type { App } from "@/lib/schema";
import { appWarnings, areaList, fieldsOf, leereApp, seitenVon } from "@/lib/model";
import { assistentAnwenden } from "@/lib/assistant";
import { KiSimulation } from "@/lib/ki";
import { useKiModus } from "@/components/layout/KiSchluessel";
import { Blatt } from "@/components/layout/Pager";
import { RunApp, type RunAppHandle } from "@/components/renderer/RunApp";
import { Fld, Seg, TextFld } from "@/components/builder/controls";

const BEISPIELE = [
  "Eine Checkliste (Excel) hochladen und auswerten: offene Punkte, Risiken und eine Zusammenfassung für die Leitung",
  "Aus einer Kundenanfrage ein Angebotsschreiben entwerfen, mit Produkt, Menge und Liefertermin als Eingaben",
  "Ein Agenten-Team aus Planer, Fachexperte und Prüfer, das aus Start und Ziel einen Projektplan erarbeitet",
];
const SCHRITTE = ["Beschreiben", "Entwurf testen", "Speichern"] as const;
const STATUS: [App["status"], string][] = [["entwurf", "Entwurf"], ["pruefung", "In Prüfung"], ["freigegeben", "Freigegeben"]];
const SCHUTZ: [App["schutz"], string][] = [["oeffentlich", "Öffentlich"], ["intern", "Intern"], ["vertraulich", "Vertraulich"]];

/** Neue Applikation per KI: beschreiben, Entwurf testen und nachschärfen, speichern. Jeder Schritt ist eine eigene Seite. */
export function NeuPage() {
  const rechte = useRechte();
  if (rechte.geladen && !rechte.darf("assistent") && !rechte.darf("bauen")) return <KeineRechte was="den KI-Assistenten" />;
  return <NeuSeite />;
}

function NeuSeite() {
  const { apps, save } = useApps();
  const nav = useNavigate();
  const bereiche = useMemo(() => areaList(apps), [apps]);
  const [schritt, setSchritt] = useState(0);
  const [beschreibung, setBeschreibung] = useState("");
  const [wissen, setWissen] = useState("");
  const [bereich, setBereich] = useState("Allgemein");
  const [entwurf, setEntwurf] = useState<App | null>(null);
  const [aenderung, setAenderung] = useState("");
  const [verlauf, setVerlauf] = useState<string[]>([]);
  const [laeuft, setLaeuft] = useState<"bauen" | "aendern" | null>(null);
  const [meldung, setMeldung] = useState("");
  const [speichert, setSpeichert] = useState(false);
  const [nr, setNr] = useState(0);
  const [testBereich, setTestBereich] = useState<"vorschau" | "anpassen">("vorschau");
  const [ansage, setAnsage] = useState("");
  const [nameFehler, setNameFehler] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const runRef = useRef<RunAppHandle>(null);
  const blattRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  /** Nach einem Schrittwechsel per Knopf den Fokus auf das neue Blatt setzen. */
  const fokusNachWechsel = useRef(false);
  /** Gewolltes Verlassen (Speichern, Übergabe an den Baukasten): nicht warnen. */
  const frei = useRef(false);
  const ohneKi = useKiModus() === "simulation";

  // Laufende Anfrage abbrechen, wenn die Seite verlassen wird.
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    if (!fokusNachWechsel.current) return;
    fokusNachWechsel.current = false;
    blattRef.current?.focus();
  }, [schritt]);
  const wechseln = (i: number) => { fokusNachWechsel.current = true; setSchritt(i); };

  // Ein ungespeicherter Entwurf geht beim Verlassen verloren: nachfragen.
  // Schützenswert: ein fertiger Entwurf, ein laufender Bau oder eine schon getippte Beschreibung (Schritt 1)
  const warnen = !speichert && (!!entwurf || !!laeuft || beschreibung.trim().length > 20);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => warnen && !frei.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!warnen) return;
    const h = (e: BeforeUnloadEvent) => { if (!frei.current) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [warnen]);

  const fragen = async (art: "bauen" | "aendern") => {
    if (ctl.current) { ctl.current.abort(); return; }
    const text = art === "bauen" ? beschreibung.trim() : aenderung.trim();
    if (!text) { setMeldung(art === "bauen" ? "Beschreib zuerst, was die Applikation tun soll." : "Schreib, was am Entwurf anders werden soll."); return; }
    const wunsch = art === "bauen"
      ? `Baue eine neue Applikation für den Bereich „${bereich || "Allgemein"}“:\n${text}${wissen.trim() ? `\n\nHintergrundwissen und Regeln, die die KI-Schritte kennen sollen (in das Feld „wissen“ der passenden Schritte übernehmen):\n${wissen.trim()}` : ""}`
      : text;
    const c = new AbortController();
    ctl.current = c;
    setLaeuft(art);
    setMeldung("");
    setAnsage(art === "bauen" ? "Die KI baut den Entwurf. Das dauert meist 30 bis 90 Sekunden." : "Die KI ändert den Entwurf …");
    try {
      const r = await assistentAnwenden(art === "bauen" ? leereApp(bereich) : entwurf!, wunsch, "alles", c.signal);
      setEntwurf(r.app);
      setNr((n) => n + 1);
      setVerlauf((v) => (art === "bauen" ? [r.zusammenfassung] : [r.zusammenfassung, ...v]).slice(0, 4));
      setAenderung("");
      setAnsage(art === "bauen" ? `Entwurf erstellt: ${r.zusammenfassung} Du kannst ihn jetzt ausprobieren.` : `Entwurf geändert: ${r.zusammenfassung}`);
      if (art === "bauen") wechseln(1);
      setTestBereich("vorschau");
    } catch (e) {
      setAnsage("");
      if (c.signal.aborted) setMeldung("Abgebrochen. Nichts wurde geändert.");
      else if (e instanceof KiSimulation) setMeldung("Die KI-Anbindung ist hier nicht eingerichtet. Du kannst im Baukasten selbst bauen.");
      else setMeldung(e instanceof Error ? e.message : "Der Entwurf ist fehlgeschlagen. Versuch es noch einmal.");
    } finally {
      ctl.current = null;
      setLaeuft(null);
    }
  };

  const speichern = async () => {
    if (!entwurf || speichert) return;
    if (!entwurf.name.trim()) { setNameFehler("Gib der Applikation einen Namen."); nameRef.current?.focus(); return; }
    const harte = appWarnings(entwurf).filter((w) => !w.weich);
    if (harte.length) { toast.error(`${harte[0].text} Öffne den Entwurf im Baukasten, um das zu beheben.`); return; }
    setSpeichert(true);
    try {
      const def = await save(entwurf);
      toast.success(`„${def.name}“ gespeichert.`);
      frei.current = true;
      nav(`/app/${def.id}`, { viewTransition: true });
    } catch (e) {
      frei.current = false;
      setSpeichert(false);
      toast.error(e instanceof Error ? e.message : "Speichern ist fehlgeschlagen.");
    }
  };

  const imBaukasten = () => { if (!entwurf) return; frei.current = true; nav("/baukasten", { state: { entwurf }, viewTransition: true }); };
  const setE = (mut: (a: App) => void) => setEntwurf((a) => { if (!a) return a; const n = structuredClone(a); mut(n); return n; });

  return (
    <div className="neu">
      <p className="sr-only" role="status">{ansage}</p>
      <div className="neu-kopf">
        <h1>Neue Applikation</h1>
        <ol className="neu-schritte" aria-label="Fortschritt">
          {SCHRITTE.map((s, i) => (
            <li key={s} aria-current={i === schritt ? "step" : undefined} data-fertig={i < schritt}>
              <button type="button" disabled={!!laeuft || (i > 0 && !entwurf)} onClick={() => wechseln(i)}><span className="s-no" aria-hidden="true">{i + 1}</span>{s}</button>
            </li>
          ))}
        </ol>
      </div>

      {schritt === 0 && (
        <Blatt id="beschreiben" innerRef={blattRef} className="neu-blatt neu-eins" aria-label="Beschreiben">
          <section className="panel neu-form" aria-labelledby="neu-was">
            <h2 id="neu-was">Was soll die Applikation tun?</h2>
            <p className="hint neu-erklaerung" style={{ margin: 0 }}>Beschreib die Aufgabe so, wie du sie jemandem im Team erklären würdest: welche Angaben oder Dateien hineinkommen und was am Ende herauskommen soll. Die KI baut daraus Seiten, Eingaben und den KI-Ablauf.</p>
            <label htmlFor="neu-beschreibung" className="sr-only">Beschreibung der Applikation</label>
            <Textarea id="neu-beschreibung" rows={6} className="min-h-[150px]" value={beschreibung} disabled={!!laeuft} onChange={(e) => { setBeschreibung(e.target.value); setMeldung(""); }}
              placeholder="z. B. Mitarbeitende laden ein Besprechungsprotokoll hoch. Die KI erstellt daraus eine Aufgabenliste mit Verantwortlichen und Terminen und einen kurzen Bericht für die Abteilungsleitung …" />
            <div className="ai-sugg neu-beispiele">{BEISPIELE.map((v) => <button key={v} type="button" disabled={!!laeuft} onClick={() => setBeschreibung(v)}>{v}</button>)}</div>
            <div className="neu-zwei">
              <TextFld label="Hintergrundwissen und Regeln (optional)" multiline rows={3} value={wissen} onChange={setWissen} disabled={!!laeuft}
                placeholder="z. B. Freigabegrenzen, Tonalität, Fachbegriffe, was die KI nie tun soll …" />
              <Fld label="Bereich" htmlFor="neu-bereich" hint="Neuen Bereich einfach eintippen.">
                <Input id="neu-bereich" list="neu-bereiche" value={bereich} disabled={!!laeuft} onChange={(e) => setBereich(e.target.value)} />
                <datalist id="neu-bereiche">{bereiche.map((x) => <option key={x} value={x} />)}</datalist>
              </Fld>
            </div>
            {meldung && <p className="hint neu-fehler" role="alert">{meldung}</p>}
            <div className="neu-aktion">
              {ohneKi ? (
                <>
                  <p className="hint" style={{ margin: 0, flex: "1 1 240px" }}>Die KI-Anbindung ist hier nicht eingerichtet. Du kannst im Baukasten selbst bauen.</p>
                  <Button asChild variant="outline"><Link to="/baukasten" viewTransition>Im Baukasten selbst bauen</Link></Button>
                </>
              ) : (
                <>
                  {laeuft ? <span className="link-back" aria-disabled="true">Lieber selbst im Baukasten bauen</span>
                    : <Link to="/baukasten" viewTransition className="link-back">Lieber selbst im Baukasten bauen</Link>}
                  <span className="flex-1" />
                  {laeuft === "bauen" && <span className="status-pill mit-icon" data-s="laeuft" aria-hidden="true"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" />Die KI baut den Entwurf, meist 30 bis 90 Sekunden</span>}
                  {laeuft === "bauen"
                    ? <Button size="lg" variant="outline" onClick={() => ctl.current?.abort()}><X aria-hidden="true" />Abbrechen</Button>
                    : <Button size="lg" className="ki-knopf" disabled={!!laeuft} onClick={() => void fragen("bauen")}><Sparkles aria-hidden="true" />Entwurf erstellen</Button>}
                </>
              )}
            </div>
          </section>
        </Blatt>
      )}

      {schritt === 1 && entwurf && (
        <Blatt id="testen" innerRef={blattRef} className="neu-blatt neu-test" aria-label="Entwurf testen">
          <div className="neu-umschalter" role="group" aria-label="Bereich anzeigen">
            <button type="button" aria-pressed={testBereich === "vorschau"} onClick={() => setTestBereich("vorschau")}>Ausprobieren</button>
            <button type="button" aria-pressed={testBereich === "anpassen"} onClick={() => setTestBereich("anpassen")}>Anpassen</button>
          </div>
          <div className="neu-vorschau" data-sichtbar={testBereich === "vorschau"}>
            <div className="neu-vorschau-kopf">
              <span className="status-pill" data-s="fertig">Entwurf</span>
              <span className="hint">Eingaben und KI-Buttons funktionieren. Nichts ist gespeichert.</span>
              <span className="flex-1" />
              {fieldsOf(entwurf).some((f) => f.type !== "file" && f.props.beispiel) && <Button size="sm" variant="outline" onClick={() => runRef.current?.beispieleEinsetzen()}>Beispieldaten einsetzen</Button>}
            </div>
            <RunApp key={nr} ref={runRef} app={entwurf} eingebettet />
          </div>
          <aside className="panel neu-seite" data-sichtbar={testBereich === "anpassen"} aria-label="Entwurf anpassen">
            <h2>{entwurf.name}</h2>
            <p className="hint" style={{ margin: 0 }}>{seitenVon(entwurf).length} Seiten, {fieldsOf(entwurf).length} Eingaben, {entwurf.steps.length} KI-Schritte{entwurf.steps.some((s) => s.art === "team") ? ", mit Agenten-Team" : ""}.</p>
            {verlauf.length > 0 && <ul className="ai-log">{verlauf.map((v, i) => <li key={i}><span>{v}</span></li>)}</ul>}
            <Fld label="Was soll anders werden?" htmlFor="neu-aenderung">
            <Textarea id="neu-aenderung" rows={4} value={aenderung} disabled={!!laeuft} onChange={(e) => { setAenderung(e.target.value); setMeldung(""); }}
              placeholder="z. B. Zusätzlich ein Feld für die Priorität. Das Ergebnis als Tabelle. Ruhiger in Dunkelblau …" />
            </Fld>
            {meldung && <p className="hint neu-fehler" role="alert">{meldung}</p>}
            {laeuft === "aendern"
              ? <Button variant="outline" onClick={() => ctl.current?.abort()}><X aria-hidden="true" />Abbrechen</Button>
              : <Button className="ki-knopf" disabled={!!laeuft} onClick={() => void fragen("aendern")}><Sparkles aria-hidden="true" />Entwurf ändern</Button>}
            {laeuft === "aendern" && <span className="status-pill mit-icon" data-s="laeuft" aria-hidden="true"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" />Die KI ändert den Entwurf …</span>}
            <span className="flex-1" />
            <div className="neu-weiter">
              <Button variant="outline" disabled={!!laeuft} onClick={imBaukasten}>Im Baukasten feinschleifen</Button>
              <Button disabled={!!laeuft} onClick={() => wechseln(2)}>Weiter zum Speichern</Button>
            </div>
          </aside>
        </Blatt>
      )}

      {schritt === 2 && entwurf && (
        <Blatt id="speichern" innerRef={blattRef} className="neu-blatt neu-eins" aria-label="Speichern">
          <section className="panel neu-form" aria-labelledby="neu-speichern">
            <h2 id="neu-speichern">Speichern und im Hub zeigen</h2>
            <div className="neu-zwei">
              <TextFld label="Name" value={entwurf.name} inputRef={nameRef} fehler={nameFehler} onChange={(v) => { setNameFehler(""); setE((a) => { a.name = v.slice(0, 60); }); }} />
              <Fld label="Bereich" htmlFor="neu-bereich2">
                <Input id="neu-bereich2" list="neu-bereiche2" value={entwurf.bereich} onChange={(e) => setE((a) => { a.bereich = e.target.value.slice(0, 40); })} />
                <datalist id="neu-bereiche2">{bereiche.map((x) => <option key={x} value={x} />)}</datalist>
              </Fld>
            </div>
            <TextFld label="Kurzbeschreibung für die Kachel" multiline rows={2} value={entwurf.beschreibung} onChange={(v) => setE((a) => { a.beschreibung = v.slice(0, 300); })} />
            <div className="neu-zwei">
              <TextFld label="Verantwortlich" value={entwurf.owner} placeholder="Name oder Abteilung" onChange={(v) => setE((a) => { a.owner = v.slice(0, 120); })} />
              <Seg label="Schutzklasse der Daten" value={entwurf.schutz} options={SCHUTZ} onChange={(v) => setE((a) => { a.schutz = v; })} />
            </div>
            <Seg label="Status" value={entwurf.status} options={STATUS} onChange={(v) => setE((a) => { a.status = v; })} />
            <div className="neu-aktion">
              <Button variant="ghost" disabled={speichert} onClick={() => wechseln(1)}>Zurück zum Testen</Button>
              <span className="flex-1" />
              <Button variant="outline" disabled={speichert} onClick={imBaukasten}>Im Baukasten öffnen</Button>
              <Button size="lg" disabled={speichert} onClick={() => void speichern()}>{speichert ? <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Speichert …</> : "Speichern und öffnen"}</Button>
            </div>
          </section>
        </Blatt>
      )}

      {/* Escape und „Weiter bearbeiten“ schließen den Dialog; der Fokus geht zurück aufs Blatt. */}
      <AlertDialog open={blocker.state === "blocked"} onOpenChange={(o) => { if (!o) blocker.reset?.(); }}>
        <AlertDialogContent onCloseAutoFocus={(e) => { e.preventDefault(); blattRef.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Entwurf nicht gespeichert</AlertDialogTitle>
            <AlertDialogDescription>„{entwurf?.name || "Neue Applikation"}“ ist noch nicht gespeichert. Wenn du die Seite verlässt, geht der Entwurf verloren.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>Entwurf verwerfen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
