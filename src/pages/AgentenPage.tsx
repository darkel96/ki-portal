import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Loader2, Plus, Sparkles, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApps } from "@/state/apps";
import { useRechte } from "@/state/rechte";
import { KeineRechte } from "@/pages/VerwaltungPage";
import type { AgentVorlage } from "@/lib/schema";
import { agentLoeschen, agentNutzung, agentRolle, agentSpeichern, agentenLaden, neueAgentId } from "@/lib/agenten";
import { KiSimulation, kiFragen } from "@/lib/ki";
import { markdown } from "@/lib/markdown";
import { Fld } from "@/components/builder/controls";

const leer = (): AgentVorlage => ({ id: neueAgentId(), name: "", beschreibung: "", rolle: "", hinweise: "", geaendert: "", erstelltVon: "" });

/** Agentenbibliothek: Agenten global anlegen, feinjustieren, ausprobieren; Agenten-Teams in Apps verweisen darauf */
export function AgentenPage() {
  const rechte = useRechte();
  const { apps } = useApps();
  const [liste, setListe] = useState<AgentVorlage[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [aktiv, setAktiv] = useState<AgentVorlage | null>(null);
  const [neu, setNeu] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [loeschen, setLoeschen] = useState(false);
  const [probe, setProbe] = useState("");
  const [antwort, setAntwort] = useState<{ text: string; simulation?: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState<AbortController | null>(null);
  useEffect(() => { document.title = "Agenten – KI-Hub"; }, []);
  const laden = async () => { try { setListe(await agentenLaden(true)); } catch (e) { toast.error(e instanceof Error ? e.message : "Die Agenten konnten nicht geladen werden."); } finally { setGeladen(true); } };
  useEffect(() => { void laden(); }, []);
  const original = useMemo(() => liste.find((a) => a.id === aktiv?.id) ?? null, [liste, aktiv?.id]);
  const geaendert = !!aktiv && (neu || JSON.stringify({ ...aktiv, geaendert: "" }) !== JSON.stringify({ ...original, geaendert: "" }));

  if (!rechte.geladen) return <p className="hint">Wird geladen …</p>;
  if (!rechte.darf("bauen")) return <KeineRechte was="die Agentenbibliothek" />;

  const waehlen = (a: AgentVorlage) => { setAktiv({ ...a }); setNeu(false); setAntwort(null); setProbe(""); };
  const anlegen = () => { setAktiv(leer()); setNeu(true); setAntwort(null); setProbe(""); };
  const speichern = async () => {
    if (!aktiv) return;
    if (!aktiv.name.trim()) { toast.error("Der Agent braucht einen Namen."); return; }
    setSpeichert(true);
    try {
      const e = await agentSpeichern({ ...aktiv, erstelltVon: aktiv.erstelltVon || rechte.ich?.email || "" });
      await laden();
      setAktiv({ ...e }); setNeu(false);
      toast.success(`„${e.name}“ gespeichert. Agenten-Teams und KI-Schritte, die ihn verwenden, nutzen ab jetzt diese Fassung.`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen."); }
    finally { setSpeichert(false); }
  };
  const entfernen = async () => {
    if (!aktiv) return;
    try { await agentLoeschen(aktiv.id); await laden(); setAktiv(null); toast.success(`„${aktiv.name}“ gelöscht. Teams behalten die zuletzt gespeicherte Fassung als eigene Kopie.`); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen."); }
    finally { setLoeschen(false); }
  };
  const ausprobieren = async () => {
    if (!aktiv || !probe.trim()) return;
    const c = new AbortController();
    setLaeuft(c); setAntwort(null);
    try {
      const text = await kiFragen(`${[`Du bist „${aktiv.name.trim() || "Agent"}“, ein KI-Agent in einem Team. Antworte auf Deutsch.`, agentRolle(aktiv)].filter(Boolean).join("\n\n")}\n\nAufgabe:\n${probe.trim()}`, c.signal, (t) => setAntwort({ text: t }));
      setAntwort({ text });
    } catch (e) {
      if (e instanceof KiSimulation) setAntwort({ text: "nachricht" in e.req ? e.req.nachricht : "", simulation: true });
      else if (!c.signal.aborted) toast.error(e instanceof Error ? e.message : "Der Probelauf ist fehlgeschlagen.");
    } finally { setLaeuft(null); }
  };
  const nutzung = aktiv ? agentNutzung(apps, aktiv.id) : [];

  return (
    <>
      <section className="hero hero-meldung hero-kompakt">
        <div className="hero-text">
          <h1>Agentenbibliothek</h1>
          <p className="lede">Agenten einmal anlegen und feinjustieren, dann in jedem Agenten-Team oder als Rolle eines KI-Schritts verwenden. Änderungen wirken sofort in allen Apps, die den Agenten verknüpft haben.</p>
        </div>
      </section>
      <div className="ag-seite">
        <aside className="ag-liste" aria-label="Agenten">
          <div className="ag-liste-kopf"><span className="lbl">{liste.length} {liste.length === 1 ? "Agent" : "Agenten"}</span><Button size="sm" className="rounded-full" onClick={anlegen}><Plus aria-hidden="true" />Neuer Agent</Button></div>
          {!geladen ? <p className="hint">Wird geladen …</p> : !liste.length ? <p className="hint">Noch keine Agenten. Leg den ersten an oder nimm im Baukasten einen Agenten eines Teams in die Bibliothek auf.</p> : (
            <ul>
              {liste.map((a) => (
                <li key={a.id}>
                  <button type="button" className={`ag-eintrag${aktiv?.id === a.id ? " ist-aktiv" : ""}`} onClick={() => waehlen(a)} aria-current={aktiv?.id === a.id ? "true" : undefined}>
                    <Bot size={16} aria-hidden="true" />
                    <span className="ag-text"><b>{a.name}</b>{a.beschreibung && <span className="hint">{a.beschreibung}</span>}</span>
                    {agentNutzung(apps, a.id).length > 0 && <span className="ag-zahl" title="In so vielen Apps verwendet">{agentNutzung(apps, a.id).length}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="ag-editor" aria-label={aktiv ? `Agent ${aktiv.name || "neu"}` : "Kein Agent gewählt"}>
          {!aktiv ? <p className="hint">Wähle links einen Agenten oder lege einen neuen an.</p> : <>
            <Fld label="Name" htmlFor="ag-name"><Input id="ag-name" value={aktiv.name} placeholder="z. B. Prüfer" onChange={(e) => setAktiv({ ...aktiv, name: e.target.value })} /></Fld>
            <Fld label="Kurzbeschreibung" htmlFor="ag-besch" hint="Ein Satz, wofür der Agent da ist (erscheint in der Liste und im Baukasten)."><Input id="ag-besch" value={aktiv.beschreibung} onChange={(e) => setAktiv({ ...aktiv, beschreibung: e.target.value })} /></Fld>
            <Fld label="Rolle" htmlFor="ag-rolle" hint="Aufgabe, Haltung, Fachgebiet; so wie du es einem neuen Kollegen erklären würdest."><Textarea id="ag-rolle" rows={6} value={aktiv.rolle} onChange={(e) => setAktiv({ ...aktiv, rolle: e.target.value })} /></Fld>
            <Fld label="Feinjustierung" htmlFor="ag-hinw" hint="Regeln, Tonfall, Grenzen, die immer gelten. Hier justierst du nach, wenn der Agent in Teams nicht so arbeitet wie gewünscht."><Textarea id="ag-hinw" rows={4} value={aktiv.hinweise} placeholder="z. B. Nenne immer Quelle und Stand. Keine Annahmen über Kundendaten. Höchstens fünf Punkte." onChange={(e) => setAktiv({ ...aktiv, hinweise: e.target.value })} /></Fld>
            <div className="ag-zeile">
              <Button className="rounded-full" disabled={!geaendert || speichert} onClick={() => void speichern()}>{speichert ? <><Loader2 className="animate-spin" aria-hidden="true" />Speichert …</> : "Speichern"}</Button>
              {!neu && <Button variant="ghost" className="rounded-full" onClick={() => setLoeschen(true)}><Trash aria-hidden="true" />Löschen</Button>}
              <span className="flex-1" />
              <span className="hint">{nutzung.length ? `Verwendet in: ${nutzung.map((a) => a.name).join(", ")}` : neu ? "Noch nicht gespeichert" : "In keiner App verknüpft"}</span>
            </div>
            <div className="ag-probe">
              <span className="lbl">Ausprobieren</span>
              <p className="hint" style={{ margin: 0 }}>Gib dem Agenten eine Aufgabe und sieh, wie er mit Rolle und Feinjustierung antwortet. Der Probelauf nutzt den ungespeicherten Stand.</p>
              <Textarea rows={2} value={probe} placeholder="z. B. Prüfe diesen Projektplan auf Risiken: …" aria-label="Aufgabe für den Probelauf" onChange={(e) => setProbe(e.target.value)} />
              <div className="ag-zeile">
                {laeuft ? <Button variant="outline" className="rounded-full" onClick={() => laeuft.abort()}>Stoppen</Button>
                  : <Button variant="outline" className="rounded-full" disabled={!probe.trim()} onClick={() => void ausprobieren()}><Sparkles aria-hidden="true" />Probelauf</Button>}
              </div>
              {antwort && (antwort.simulation
                ? <><p className="o-muted">Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p><pre className="code o-sim">{antwort.text}</pre></>
                : <div className="ag-antwort o-body" aria-live="polite" dangerouslySetInnerHTML={{ __html: markdown(antwort.text || "…") }} />)}
            </div>
          </>}
        </section>
      </div>
      <AlertDialog open={loeschen} onOpenChange={setLoeschen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{aktiv?.name}“ aus der Bibliothek löschen?</AlertDialogTitle>
            <AlertDialogDescription>{nutzung.length ? `Der Agent wird in ${nutzung.length === 1 ? "einer App" : `${nutzung.length} Apps`} verwendet (${nutzung.map((a) => a.name).join(", ")}). Diese Teams behalten die zuletzt gespeicherte Fassung als eigene Kopie; Feinjustierungen wirken dort nicht mehr.` : "Der Agent wird in keiner App verwendet."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void entfernen()}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
