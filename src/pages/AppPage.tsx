import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Check as Haken, ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMeinHub } from "@/state/meinhub";
import { AuftragDialog, VorlageDialog, VorlagenVerwalten } from "@/components/meinhub/Dialoge";
import { datumZeit, type Voreinstellung } from "@/lib/meinhub";
import { useApps } from "@/state/apps";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { areaIdx, fieldsOf } from "@/lib/model";
import { RunApp, type RunAppHandle } from "@/components/renderer/RunApp";
import { NotFoundPage } from "./NotFoundPage";

const STATUS = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Freigegeben" } as const;
const SCHUTZ = { oeffentlich: "Öffentlich", intern: "Intern", vertraulich: "Vertraulich" } as const;

export function AppPage() {
  const { id } = useParams();
  const { find, remove, geladen } = useApps();
  const nav = useNavigate();
  const runRef = useRef<RunAppHandle>(null);
  const [loeschen, setLoeschen] = useState(false);
  const mh = useMeinHub();
  const [sp, setSp] = useSearchParams();
  const [vorlage, setVorlage] = useState<Voreinstellung | null>(null);
  const [vorlageDlg, setVorlageDlg] = useState(false);
  const [auftragDlg, setAuftragDlg] = useState(false);
  const [verwaltenDlg, setVerwaltenDlg] = useState(false);
  const a = find(id);
  const vorlagen = a?.id ? mh.vorlagenFuer(a.id) : [];
  const letzter = a?.id ? mh.letzterLauf(a.id) : undefined;
  const laden = (v: Voreinstellung) => { runRef.current?.setzen(v.werte, v.dateien); setVorlage(v); toast.success(`Voreinstellung „${v.name}“ geladen.`); };
  // Aus Mein Hub: /app/:id?vorlage=… öffnet die App mit dieser Voreinstellung.
  const vorlageParam = sp.get("vorlage");
  useEffect(() => {
    if (!vorlageParam || !mh.geladen || !a) return;
    const v = mh.daten.voreinstellungen.find((x) => x.id === vorlageParam);
    if (v) requestAnimationFrame(() => { runRef.current?.setzen(v.werte, v.dateien); setVorlage(v); });
    setSp((p) => { const n = new URLSearchParams(p); n.delete("vorlage"); return n; }, { replace: true });
  }, [vorlageParam, mh.geladen, a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return geladen ? <NotFoundPage /> : <p className="hint">Applikation wird geladen …</p>;
  const ci = areaIdx(a.bereich);
  const hatBeispiele = fieldsOf(a).some((f) => f.type !== "file" && f.props.beispiel);
  const eigene = a._src === "eigene";
  const bearbeiten = () => nav(eigene ? `/baukasten/${a.id}` : `/baukasten?kopie=${a.id}`, { viewTransition: true });
  const bearbeitenText = eigene ? "Im Baukasten bearbeiten" : "Als Kopie im Baukasten öffnen";

  return (
    <>
      <div className="app-bar">
        <Link to="/" viewTransition className="link-back">Zur Übersicht</Link>
        <span className="area" style={{ "--ac": `var(--a${ci})` } as React.CSSProperties}><i aria-hidden="true" />{a.bereich}</span>
        {a.status !== "freigegeben" && <span className="tag draft">{STATUS[a.status]}</span>}
        {a.typ !== "link" && (
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" size="sm">Details</Button></PopoverTrigger>
            <PopoverContent align="start" className="w-72 rounded-none text-sm">
              <dl className="kv">
                <dt>Version</dt><dd>{a.version || 1}</dd>
                <dt>Status</dt><dd>{STATUS[a.status]}</dd>
                <dt>Schutzklasse</dt><dd>{SCHUTZ[a.schutz]}</dd>
                {a.owner && <><dt>Verantwortlich</dt><dd>{a.owner}</dd></>}
                {a.geaendert && <><dt>Geändert</dt><dd>{new Date(a.geaendert).toLocaleDateString("de-DE", { dateStyle: "medium" })}</dd></>}
              </dl>
            </PopoverContent>
          </Popover>
        )}
        <span className="flex-1" />
        {a.typ !== "link" && a.id && (
          <span className="nur-breit app-aktionen">
            <Button variant={mh.istGepinnt(a.id) ? "secondary" : "outline"} className="rounded-full" aria-pressed={mh.istGepinnt(a.id)} onClick={() => { mh.pinUmschalten(a.id!); toast.success(mh.istGepinnt(a.id!) ? "Aus Mein Hub entfernt." : "Zu Mein Hub hinzugefügt."); }}>
              {mh.istGepinnt(a.id) ? <><Haken aria-hidden="true" />In Mein Hub</> : <><Plus aria-hidden="true" />Zu Mein Hub</>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-full" aria-label={vorlage ? `Voreinstellungen, geladen: ${vorlage.name}` : "Voreinstellungen"}>{vorlage ? vorlage.name : "Voreinstellungen"}<ChevronDown aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {vorlagen.length > 0 && <DropdownMenuLabel>Laden</DropdownMenuLabel>}
                {vorlagen.map((v) => <DropdownMenuItem key={v.id} onSelect={() => laden(v)}>{v.id === vorlage?.id && <Haken aria-hidden="true" />}{v.name}</DropdownMenuItem>)}
                {vorlagen.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => setVorlageDlg(true)}>Eingaben als Voreinstellung speichern …</DropdownMenuItem>
                {vorlagen.length > 0 && <DropdownMenuItem onSelect={() => setVerwaltenDlg(true)}>Voreinstellungen verwalten …</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setAuftragDlg(true)}>Regelmäßig ausführen …</DropdownMenuItem>
                {letzter && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => nav(`/mein?lauf=${letzter.id}`, { viewTransition: true })}>Letztes Ergebnis ansehen ({datumZeit(letzter.start)})</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
        <span className="nur-breit app-aktionen">
          {hatBeispiele && <Button variant="ghost" className="rounded-full" onClick={() => runRef.current?.beispieleEinsetzen()}>Beispieldaten einsetzen</Button>}
          <Button variant="outline" className="rounded-full" onClick={bearbeiten}>{bearbeitenText}</Button>
          {eigene && <Button variant="ghost" className="rounded-full" onClick={() => setLoeschen(true)}>Löschen</Button>}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="nur-schmal" aria-label="Weitere Aktionen"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {a.typ !== "link" && a.id && <>
              <DropdownMenuItem onSelect={() => { mh.pinUmschalten(a.id!); toast.success(mh.istGepinnt(a.id!) ? "Aus Mein Hub entfernt." : "Zu Mein Hub hinzugefügt."); }}>{mh.istGepinnt(a.id) ? "Aus Mein Hub entfernen" : "Zu Mein Hub hinzufügen"}</DropdownMenuItem>
              {vorlagen.map((v) => <DropdownMenuItem key={v.id} onSelect={() => laden(v)}>Voreinstellung laden: {v.name}</DropdownMenuItem>)}
              <DropdownMenuItem onSelect={() => setVorlageDlg(true)}>Eingaben als Voreinstellung speichern …</DropdownMenuItem>
              {vorlagen.length > 0 && <DropdownMenuItem onSelect={() => setVerwaltenDlg(true)}>Voreinstellungen verwalten …</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setAuftragDlg(true)}>Regelmäßig ausführen …</DropdownMenuItem>
              {letzter && <DropdownMenuItem onSelect={() => nav(`/mein?lauf=${letzter.id}`, { viewTransition: true })}>Letztes Ergebnis ansehen ({datumZeit(letzter.start)})</DropdownMenuItem>}
              <DropdownMenuSeparator />
            </>}
            {hatBeispiele && <DropdownMenuItem onSelect={() => runRef.current?.beispieleEinsetzen()}>Beispieldaten einsetzen</DropdownMenuItem>}
            <DropdownMenuItem onSelect={bearbeiten}>{bearbeitenText}</DropdownMenuItem>
            {eigene && <DropdownMenuItem variant="destructive" onSelect={() => setLoeschen(true)}>Löschen</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {a.id && a.typ !== "link" && <>
        <VorlageDialog offen={vorlageDlg} onOffen={setVorlageDlg} appId={a.id} appName={a.name} aktiv={vorlage} onGespeichert={setVorlage}
          stand={() => runRef.current?.stand() ?? { werte: {}, dateien: {} }} />
        <VorlagenVerwalten offen={verwaltenDlg} onOffen={setVerwaltenDlg} appId={a.id} appName={a.name} />
        <AuftragDialog offen={auftragDlg} onOffen={setAuftragDlg} appId={a.id} appName={a.name} vorlageVorschlag={vorlage?.id ?? null}
          stand={() => runRef.current?.stand() ?? { werte: {}, dateien: {} }} />
      </>}
      <AlertDialog open={loeschen} onOpenChange={setLoeschen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{a.name}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>Die Applikation verschwindet für alle aus dem KI-Hub. Das lässt sich nicht rückgängig machen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={async () => {
              try { await remove(a.id!); toast.success(`„${a.name}“ gelöscht.`); nav("/", { viewTransition: true }); }
              catch (e) { toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); }
            }}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {a.typ === "link" ? (
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 32 }}>
          <h1 style={{ fontSize: 40, letterSpacing: "-0.035em", margin: 0 }}>{a.name}</h1>
          <p className="lede">{a.beschreibung}</p>
          <div><Button asChild className="rounded-full"><a href={a.url} target="_blank" rel="noopener noreferrer">In neuem Fenster öffnen</a></Button></div>
        </section>
      ) : (
        <RunApp key={a.id} ref={runRef} app={a} onLaufFertig={(outs) => mh.laufAblegen(a, outs, vorlage)} />
      )}
    </>
  );
}
