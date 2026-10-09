import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApps } from "@/state/apps";
import type { App } from "@/lib/schema";
import { appWarnings, areaList, fieldsOf, leereApp, seitenVon } from "@/lib/model";
import { assistentAnwenden } from "@/lib/assistant";
import { KiSimulation, kiModus } from "@/lib/ki";
import { Blatt } from "@/components/layout/Pager";
import { RunApp, type RunAppHandle } from "@/components/renderer/RunApp";
import { Seg, TextFld } from "@/components/builder/controls";

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
  const ctl = useRef<AbortController | null>(null);
  const runRef = useRef<RunAppHandle>(null);
  const ohneKi = kiModus() === "simulation";

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
    try {
      const r = await assistentAnwenden(art === "bauen" ? leereApp(bereich) : entwurf!, wunsch, "alles", c.signal);
      setEntwurf(r.app);
      setNr((n) => n + 1);
      setVerlauf((v) => (art === "bauen" ? [r.zusammenfassung] : [r.zusammenfassung, ...v]).slice(0, 4));
      setAenderung("");
      setSchritt(1);
      setTestBereich("vorschau");
    } catch (e) {
      if (c.signal.aborted) setMeldung("Abgebrochen. Nichts wurde geändert.");
      else if (e instanceof KiSimulation) setMeldung("Für den Entwurf per KI braucht es die zentrale KI-Anbindung. Sie ist in dieser Umgebung nicht eingerichtet.");
      else setMeldung(e instanceof Error ? e.message : "Der Entwurf ist fehlgeschlagen. Versuch es noch einmal.");
    } finally {
      ctl.current = null;
      setLaeuft(null);
    }
  };

  const speichern = async () => {
    if (!entwurf) return;
    const harte = appWarnings(entwurf).filter((w) => !w.weich);
    if (harte.length) { toast.error(`${harte[0].text} Öffne den Entwurf im Baukasten, um das zu beheben.`); return; }
    setSpeichert(true);
    try {
      const def = await save(entwurf);
      toast.success(`„${def.name}“ gespeichert.`);
      nav(`/app/${def.id}`, { viewTransition: true });
    } catch (e) {
      setSpeichert(false);
      toast.error(e instanceof Error ? e.message : "Speichern ist fehlgeschlagen.");
    }
  };

  const imBaukasten = () => entwurf && nav("/baukasten", { state: { entwurf }, viewTransition: true });
  const setE = (mut: (a: App) => void) => setEntwurf((a) => { if (!a) return a; const n = structuredClone(a); mut(n); return n; });

  return (
    <div className="neu">
      <div className="neu-kopf">
        <h1>Neue Applikation</h1>
        <ol className="neu-schritte" aria-label="Fortschritt">
          {SCHRITTE.map((s, i) => (
            <li key={s} aria-current={i === schritt ? "step" : undefined} data-fertig={i < schritt}>
              <button type="button" disabled={i > 0 && !entwurf} onClick={() => setSchritt(i)}><span className="s-no" aria-hidden="true">{i + 1}</span>{s}</button>
            </li>
          ))}
        </ol>
      </div>

      {schritt === 0 && (
        <Blatt id="beschreiben" className="neu-blatt neu-eins">
          <section className="panel neu-form" aria-labelledby="neu-was">
            <h2 id="neu-was">Was soll die Applikation tun?</h2>
            <p className="hint neu-erklaerung" style={{ margin: 0 }}>Beschreib die Aufgabe so, wie du sie jemandem im Team erklären würdest: welche Angaben oder Dateien hineinkommen und was am Ende herauskommen soll. Die KI baut daraus Seiten, Eingaben und den KI-Ablauf.</p>
            <label htmlFor="neu-beschreibung" className="sr-only">Beschreibung der Applikation</label>
            <Textarea id="neu-beschreibung" rows={6} className="min-h-[150px]" value={beschreibung} disabled={!!laeuft} onChange={(e) => setBeschreibung(e.target.value)}
              placeholder="z. B. Mitarbeitende laden ein Besprechungsprotokoll hoch. Die KI erstellt daraus eine Aufgabenliste mit Verantwortlichen und Terminen und einen kurzen Bericht für die Abteilungsleitung." />
            <div className="ai-sugg neu-beispiele">{BEISPIELE.map((v) => <button key={v} type="button" onClick={() => setBeschreibung(v)}>{v}</button>)}</div>
            <div className="neu-zwei">
              <TextFld label="Hintergrundwissen und Regeln (optional)" multiline rows={3} value={wissen} onChange={setWissen}
                placeholder="z. B. Freigabegrenzen, Tonalität, Fachbegriffe, was die KI nie tun soll" />
              <div className="fld">
                <label htmlFor="neu-bereich" style={{ fontSize: 13, fontWeight: 600 }}>Bereich</label>
                <Input id="neu-bereich" list="neu-bereiche" value={bereich} onChange={(e) => setBereich(e.target.value)} />
                <datalist id="neu-bereiche">{bereiche.map((x) => <option key={x} value={x} />)}</datalist>
                <span className="hint">Neuen Bereich einfach eintippen.</span>
              </div>
            </div>
            {meldung && <p className="hint" role="status" style={{ margin: 0, color: "var(--danger)" }}>{meldung}</p>}
            <div className="neu-aktion">
              {ohneKi ? (
                <>
                  <p className="hint" style={{ margin: 0, flex: "1 1 240px" }}>Der Entwurf per KI ist verfügbar, sobald die zentrale KI-Anbindung eingerichtet ist. Bis dahin kannst du im Baukasten selbst bauen.</p>
                  <Button asChild variant="outline"><Link to="/baukasten" viewTransition>Im Baukasten selbst bauen</Link></Button>
                </>
              ) : (
                <>
                  <Link to="/baukasten" viewTransition className="link-back">Lieber selbst im Baukasten bauen</Link>
                  <span className="flex-1" />
                  {laeuft === "bauen" && <span className="status-pill" data-s="laeuft">Die KI baut den Entwurf, meist 30 bis 90 Sekunden</span>}
                  <Button size="lg" className="ki-knopf" onClick={() => void fragen("bauen")}>
                    <Sparkles aria-hidden="true" />{laeuft === "bauen" ? "Abbrechen" : "Entwurf erstellen"}
                  </Button>
                </>
              )}
            </div>
          </section>
        </Blatt>
      )}

      {schritt === 1 && entwurf && (
        <Blatt id="testen" className="neu-blatt neu-test" >
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
            <RunApp key={nr} ref={runRef} app={entwurf} />
          </div>
          <aside className="panel neu-seite" data-sichtbar={testBereich === "anpassen"} aria-label="Entwurf anpassen">
            <h2>{entwurf.name}</h2>
            <p className="hint" style={{ margin: 0 }}>{seitenVon(entwurf).length} Seiten, {fieldsOf(entwurf).length} Eingaben, {entwurf.steps.length} KI-Schritte{entwurf.steps.some((s) => s.art === "team") ? ", mit Agenten-Team" : ""}.</p>
            {verlauf.length > 0 && <ul className="ai-log">{verlauf.map((v, i) => <li key={i}><span>{v}</span></li>)}</ul>}
            <label htmlFor="neu-aenderung" style={{ fontSize: 13, fontWeight: 600 }}>Was soll anders werden?</label>
            <Textarea id="neu-aenderung" rows={4} value={aenderung} disabled={!!laeuft} onChange={(e) => setAenderung(e.target.value)}
              placeholder="z. B. Zusätzlich ein Feld für die Priorität. Das Ergebnis als Tabelle. Ruhiger in Dunkelblau." />
            {meldung && <p className="hint" role="status" style={{ margin: 0, color: "var(--danger)" }}>{meldung}</p>}
            <Button className="ki-knopf" onClick={() => void fragen("aendern")}><Sparkles aria-hidden="true" />{laeuft === "aendern" ? "Abbrechen" : "Entwurf ändern"}</Button>
            {laeuft === "aendern" && <span className="status-pill" data-s="laeuft">Die KI ändert den Entwurf</span>}
            <span className="flex-1" />
            <div className="neu-weiter">
              <Button variant="outline" onClick={imBaukasten}>Im Baukasten feinschleifen</Button>
              <Button onClick={() => setSchritt(2)}>Weiter zum Speichern</Button>
            </div>
          </aside>
        </Blatt>
      )}

      {schritt === 2 && entwurf && (
        <Blatt id="speichern" className="neu-blatt neu-eins">
          <section className="panel neu-form" aria-labelledby="neu-speichern">
            <h2 id="neu-speichern">Speichern und im Hub zeigen</h2>
            <div className="neu-zwei">
              <TextFld label="Name" value={entwurf.name} onChange={(v) => setE((a) => { a.name = v.slice(0, 60); })} />
              <div className="fld">
                <label htmlFor="neu-bereich2" style={{ fontSize: 13, fontWeight: 600 }}>Bereich</label>
                <Input id="neu-bereich2" list="neu-bereiche2" value={entwurf.bereich} onChange={(e) => setE((a) => { a.bereich = e.target.value.slice(0, 40); })} />
                <datalist id="neu-bereiche2">{bereiche.map((x) => <option key={x} value={x} />)}</datalist>
              </div>
            </div>
            <TextFld label="Kurzbeschreibung für die Kachel" multiline rows={2} value={entwurf.beschreibung} onChange={(v) => setE((a) => { a.beschreibung = v.slice(0, 300); })} />
            <div className="neu-zwei">
              <TextFld label="Verantwortlich" value={entwurf.owner} placeholder="Name oder Abteilung" onChange={(v) => setE((a) => { a.owner = v.slice(0, 120); })} />
              <Seg label="Schutzklasse der Daten" value={entwurf.schutz} options={SCHUTZ} onChange={(v) => setE((a) => { a.schutz = v; })} />
            </div>
            <Seg label="Status" value={entwurf.status} options={STATUS} onChange={(v) => setE((a) => { a.status = v; })} />
            <div className="neu-aktion">
              <Button variant="ghost" onClick={() => setSchritt(1)}>Zurück zum Testen</Button>
              <span className="flex-1" />
              <Button variant="outline" onClick={imBaukasten}>Im Baukasten öffnen</Button>
              <Button size="lg" disabled={speichert || !entwurf.name.trim()} onClick={() => void speichern()}>Speichern und öffnen</Button>
            </div>
          </section>
        </Blatt>
      )}
    </div>
  );
}
