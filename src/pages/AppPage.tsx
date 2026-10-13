import { useEffect, useMemo, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { areaIdx, fieldsOf } from "@/lib/model";
import { parsePaketFuer } from "@/lib/paket";
import { ergebnisDateiFuer } from "@/lib/request";
import type { OutState } from "@/lib/runner";
import type { App } from "@/lib/schema";
import type { Lauf } from "@/lib/meinhub";
import { RunApp, type RunAppHandle } from "@/components/renderer/RunApp";
import { OutputView } from "@/components/renderer/OutputView";
import { RunContext, type RunCtx } from "@/components/renderer/runContext";
import { themeStyle } from "@/components/renderer/theme";
import { NotFoundPage } from "./NotFoundPage";

const STATUS = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Freigegeben" } as const;
const SCHUTZ = { oeffentlich: "Öffentlich", intern: "Intern", vertraulich: "Vertraulich" } as const;

/** Letztes Ergebnis dieser Applikation im Dialog, ohne die Seite (und die Eingaben) zu verlassen. */
function LetzterLaufDialog({ lauf, app, offen, onOffen }: { lauf: Lauf; app: App; offen: boolean; onOffen: (o: boolean) => void }) {
  const eintrag = (s: { id: string; key: string }) => lauf.ergebnisse[s.id] ?? Object.values(lauf.ergebnisse).find((e) => e.key === s.key);
  const steps = app.steps.filter((s) => eintrag(s));
  const outs = useMemo(() => {
    const o: Record<string, OutState> = {};
    for (const s of steps) {
      const e = eintrag(s)!;
      const status = e.status as OutState["status"];
      o[s.id] = { status, text: status === "simuliert" ? undefined : e.text, meldung: e.meldung, paket: s.format === "dateien" && e.text ? parsePaketFuer(s, e.text) : undefined, req: { nachricht: e.text ?? "", ergebnisDatei: ergebnisDateiFuer(s, e.text ?? "") } as never };
    }
    return o;
  }, [lauf]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: RunCtx = { werte: {}, setWert: () => {}, files: {}, dateiInfo: {}, setDatei: () => {}, fehler: new Set(), hinweise: {}, outs, laeuft: null, ebenen: {}, starten: () => {} };
  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-3xl lauf-dialog">
        <DialogHeader>
          <DialogTitle>Letztes Ergebnis: {lauf.titel}</DialogTitle>
          <DialogDescription>{datumZeit(lauf.start)}{lauf.meldung ? ` – ${lauf.meldung}` : ""}. Alle Ergebnisse stehen im <a href={`/mein?lauf=${lauf.id}`} target="_blank" rel="noopener">Verlauf von Mein Hub</a> (neues Fenster).</DialogDescription>
        </DialogHeader>
        {steps.length ? (
          <RunContext.Provider value={ctx}>
            <div className="app-frame lauf-dialog-inhalt innen-scroll" style={themeStyle(app.theme)}>
              {steps.map((s) => <OutputView key={s.id} app={app} titel={s.name} stepId={s.id} stil="card" mode="run" />)}
            </div>
          </RunContext.Provider>
        ) : <p className="hint">{Object.keys(lauf.ergebnisse).length ? "Die Ergebnisse passen nicht mehr zur aktuellen Version der Applikation." : "Dieser Lauf hat keine Ergebnisse."}</p>}
      </DialogContent>
    </Dialog>
  );
}

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
  const [laufDlg, setLaufDlg] = useState(false);
  const a = find(id);
  const vorlagen = a?.id ? mh.vorlagenFuer(a.id) : [];
  const letzter = a?.id ? mh.letzterLauf(a.id) : undefined;
  /** Eingaben ersetzen, mit „Rückgängig“ für den vorherigen Stand */
  const ersetzen = (tun: () => void, meldung: string, vorher: Voreinstellung | null) => {
    const alt = runRef.current?.stand();
    tun();
    toast.success(meldung, alt ? { action: { label: "Rückgängig", onClick: () => { runRef.current?.setzen(alt.werte, alt.dateien); setVorlage(vorher); } } } : undefined);
  };
  const laden = (v: Voreinstellung) => ersetzen(() => { runRef.current?.setzen(v.werte, v.dateien); setVorlage(v); }, `Voreinstellung „${v.name}“ geladen.`, vorlage);
  const beispiele = () => ersetzen(() => runRef.current?.beispieleEinsetzen(), "Beispieldaten eingesetzt.", vorlage);
  const pinUmschalten = (id: string) => { const war = mh.istGepinnt(id); mh.pinUmschalten(id); toast.success(war ? "Aus Mein Hub entfernt." : "Zu Mein Hub hinzugefügt."); };
  // Aus Mein Hub: /app/:id?vorlage=… öffnet die App mit dieser Voreinstellung.
  const vorlageParam = sp.get("vorlage");
  useEffect(() => {
    if (!vorlageParam || !mh.geladen || !a) return;
    const v = mh.daten.voreinstellungen.find((x) => x.id === vorlageParam);
    if (v) requestAnimationFrame(() => { runRef.current?.setzen(v.werte, v.dateien); setVorlage(v); });
    setSp((p) => { const n = new URLSearchParams(p); n.delete("vorlage"); return n; }, { replace: true });
  }, [vorlageParam, mh.geladen, a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (a) document.title = `${a.name} – KI-Hub`; }, [a?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return geladen ? <NotFoundPage /> : <p className="hint">Applikation wird geladen\u00a0…</p>;
  const ci = areaIdx(a.bereich);
  const hatBeispiele = fieldsOf(a).some((f) => f.type !== "file" && f.props.beispiel);
  const eigene = a._src === "eigene";
  const bearbeiten = () => nav(eigene ? `/baukasten/${a.id}` : `/baukasten?kopie=${a.id}`, { viewTransition: true });
  const bearbeitenText = eigene ? "Im Baukasten bearbeiten" : "Als Kopie im Baukasten öffnen";

  return (
    <>
      <div className="app-bar app-bar-lauf">
        <Link to="/" viewTransition className="link-back">Zur Übersicht</Link>
        <span className="area" style={{ "--ac": `var(--a${ci})` } as React.CSSProperties}><i aria-hidden="true" />{a.bereich}</span>
        {a.status !== "freigegeben" && <span className="tag draft">{STATUS[a.status]}</span>}
        {a.typ !== "link" && (
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" size="sm">Details</Button></PopoverTrigger>
            <PopoverContent align="start" collisionPadding={16} className="w-72 text-sm">
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
            <Button variant={mh.istGepinnt(a.id) ? "secondary" : "outline"} className="rounded-full" aria-pressed={mh.istGepinnt(a.id)} onClick={() => pinUmschalten(a.id!)}>
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
                {letzter && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setLaufDlg(true)}>Letztes Ergebnis ansehen ({datumZeit(letzter.start)})</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
        <span className="nur-breit app-aktionen">
          {hatBeispiele && <Button variant="outline" className="rounded-full" onClick={beispiele}>Beispieldaten einsetzen</Button>}
          <Button variant="outline" className="rounded-full" onClick={bearbeiten}>{bearbeitenText}</Button>
          {eigene && <Button variant="ghost" className="rounded-full" onClick={() => setLoeschen(true)}>Löschen</Button>}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="nur-schmal" aria-label="Weitere Aktionen"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {a.typ !== "link" && a.id && <>
              <DropdownMenuItem onSelect={() => pinUmschalten(a.id!)}>{mh.istGepinnt(a.id) ? "Aus Mein Hub entfernen" : "Zu Mein Hub hinzufügen"}</DropdownMenuItem>
              {vorlagen.map((v) => <DropdownMenuItem key={v.id} onSelect={() => laden(v)}>Voreinstellung laden: {v.name}</DropdownMenuItem>)}
              <DropdownMenuItem onSelect={() => setVorlageDlg(true)}>Eingaben als Voreinstellung speichern …</DropdownMenuItem>
              {vorlagen.length > 0 && <DropdownMenuItem onSelect={() => setVerwaltenDlg(true)}>Voreinstellungen verwalten …</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setAuftragDlg(true)}>Regelmäßig ausführen …</DropdownMenuItem>
              {letzter && <DropdownMenuItem onSelect={() => setLaufDlg(true)}>Letztes Ergebnis ansehen ({datumZeit(letzter.start)})</DropdownMenuItem>}
              <DropdownMenuSeparator />
            </>}
            {hatBeispiele && <DropdownMenuItem onSelect={beispiele}>Beispieldaten einsetzen</DropdownMenuItem>}
            <DropdownMenuItem onSelect={bearbeiten}>{bearbeitenText}</DropdownMenuItem>
            {eigene && <DropdownMenuItem variant="destructive" onSelect={() => setLoeschen(true)}>Löschen</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {a.id && a.typ !== "link" && <>
        <VorlageDialog offen={vorlageDlg} onOffen={setVorlageDlg} appId={a.id} appName={a.name} aktiv={vorlage} onGespeichert={setVorlage}
          stand={() => runRef.current?.stand() ?? { werte: {}, dateien: {} }} />
        <VorlagenVerwalten offen={verwaltenDlg} onOffen={setVerwaltenDlg} appId={a.id} appName={a.name} />
        {letzter && <LetzterLaufDialog lauf={letzter} app={a} offen={laufDlg} onOffen={setLaufDlg} />}
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
