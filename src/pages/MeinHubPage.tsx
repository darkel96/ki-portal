import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ChevronLeft, Play, Square, Trash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApps } from "@/state/apps";
import { useMeinHub } from "@/state/meinhub";
import { Blatt, Pager } from "@/components/layout/Pager";
import { useRaster } from "@/components/layout/useRaster";
import { AuftragDialog, VorlagenVerwalten } from "@/components/meinhub/Dialoge";
import { OutputView } from "@/components/renderer/OutputView";
import { RunContext, type RunCtx } from "@/components/renderer/runContext";
import { themeStyle } from "@/components/renderer/theme";
import { areaIdx, inkFor } from "@/lib/model";
import { parsePaket } from "@/lib/paket";
import { ergebnisDateiFuer } from "@/lib/request";
import type { OutState } from "@/lib/runner";
import { ZIEL_LABEL, datumZeit, zeitplanText, type Auftrag, type Lauf } from "@/lib/meinhub";
import type { HubApp } from "@/lib/schema";
import { initials } from "@/lib/model";

type Reiter = "apps" | "auftraege" | "verlauf";
const REITER: Reiter[] = ["apps", "auftraege", "verlauf"];
const LAUF_STATUS: Record<Lauf["status"], [string, OutState["status"]]> = {
  laeuft: ["Läuft", "laeuft"], fertig: ["Fertig", "fertig"], fehler: ["Fehler", "fehler"], abgebrochen: ["Abgebrochen", "gestoppt"],
};
/** Status der einzelnen Schritte, einheitlich groß geschrieben */
const SCHRITT_STATUS: Record<OutState["status"], string> = {
  wartet: "Wartet", laeuft: "Läuft", fertig: "Fertig", simuliert: "Simulation", uebersprungen: "Übersprungen", fehler: "Fehler", gestoppt: "Gestoppt",
};
const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;
const LAEDT = <p className="hint">Mein Hub wird geladen&nbsp;…</p>;

/** Blättert eine Liste von Karten so, dass nie gescrollt werden muss. */
function KartenRaster<T>({ items, render, leer, hoehe = 200, hoeheSchmal = Math.min(hoehe, 150), breite = 300, schluessel }: {
  items: T[]; render: (x: T) => ReactNode; leer: ReactNode; hoehe?: number; hoeheSchmal?: number; breite?: number; schluessel: (x: T) => string;
}) {
  const feld = useRef<HTMLDivElement>(null);
  const r = useRaster(feld, { breite, hoehe, breiteSchmal: 300, hoeheSchmal });
  const [seite, setSeite] = useState(0);
  const pro = r.spalten * r.zeilen;
  const seiten = Math.max(1, Math.ceil(items.length / pro));
  const akt = Math.min(seite, seiten - 1);
  return (
    <div className="mh-liste">
      <div className="tiles-feld" ref={feld}>
        {items.length ? (
          <Blatt id={`${akt}|${pro}|${items.length}`} className="tiles-blatt">
            <div className="mh-raster" style={{ gridTemplateColumns: `repeat(${r.spalten}, minmax(0, 1fr))`, gridAutoRows: `${r.hoehe - 12}px` }}>
              {items.slice(akt * pro, (akt + 1) * pro).map((x) => <div key={schluessel(x)} className="mh-zelle">{render(x)}</div>)}
            </div>
          </Blatt>
        ) : <div className="mh-leer">{leer}</div>}
      </div>
      <Pager seite={akt} anzahl={seiten} onWechsel={setSeite} />
    </div>
  );
}

function AppKarte({ a, onLauf }: { a: HubApp; onLauf: (id: string) => void }) {
  const mh = useMeinHub();
  const [verwalten, setVerwalten] = useState(false);
  const letzter = mh.letzterLauf(a.id!);
  const ci = areaIdx(a.bereich);
  const ac = a.theme.accent || `var(--a${ci})`;
  const aci = a.theme.accent ? inkFor(a.theme.accent) ?? "#fff" : `var(--a${ci}i)`;
  const vorlagen = mh.vorlagenFuer(a.id!);
  const auftraege = mh.daten.auftraege.filter((x) => x.appId === a.id);
  // Sofort entfernen, aber mit „Rückgängig“ an der alten Stelle wieder einsetzen
  const entfernen = () => {
    const stelle = mh.daten.pins.findIndex((p) => p.appId === a.id);
    mh.pinSetzen(a.id!, false);
    toast(`„${a.name}“ aus Mein Hub entfernt.`, { action: { label: "Rückgängig", onClick: () => mh.pinSetzen(a.id!, true, stelle) } });
  };
  return (
    <article className="mh-karte" style={{ "--ac": ac, "--aci": aci } as CSSProperties}>
      <div className="mh-karte-kopf">
        <span className="mono" aria-hidden="true">{initials(a.name)}</span>
        <div className="min-w-0 flex-1">
          <Link to={`/app/${a.id}`} viewTransition className="mh-titel">{a.name}</Link>
          <span className="mh-meta">{a.bereich}{auftraege.length ? `, ${auftraege.length} ${auftraege.length === 1 ? "Auftrag" : "Aufträge"}` : ""}</span>
        </div>
        <button type="button" className="mh-x" aria-label={`${a.name} aus Mein Hub entfernen`} title="Aus Mein Hub entfernen" onClick={entfernen}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="mh-vorlagen">
        {vorlagen.length ? vorlagen.slice(0, 4).map((v) => (
          <Link key={v.id} to={`/app/${a.id}?vorlage=${v.id}`} viewTransition className="var" title="Mit dieser Voreinstellung öffnen">{v.name}</Link>
        )) : <span className="hint">Noch keine Voreinstellung. Öffne die App, füll sie aus und speichere die Eingaben.</span>}
        {vorlagen.length > 4 && <span className="hint">+{vorlagen.length - 4} weitere</span>}
      </div>
      <div className="mh-letzter">
        {letzter ? <>Letztes Ergebnis: {datumZeit(letzter.start)} <span className="status-pill" data-s={LAUF_STATUS[letzter.status][1]}>{LAUF_STATUS[letzter.status][0]}</span><button type="button" onClick={() => onLauf(letzter.id)}>Ansehen</button></>
          : <span>Noch kein Ergebnis</span>}
      </div>
      <div className="mh-fuss">
        <Button asChild size="sm" className="rounded-full"><Link to={`/app/${a.id}`} viewTransition>Öffnen</Link></Button>
        {vorlagen.length > 0 && <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setVerwalten(true)}>Voreinstellungen verwalten</Button>}
      </div>
      <VorlagenVerwalten offen={verwalten} onOffen={setVerwalten} appId={a.id!} appName={a.name} />
    </article>
  );
}

function AuftragKarte({ a, app, onBearbeiten, onLoeschen }: { a: Auftrag; app?: HubApp; onBearbeiten: () => void; onLoeschen: () => void }) {
  const mh = useMeinHub();
  const letzter = mh.daten.laeufe.find((l) => l.auftragId === a.id);
  const laeuft = mh.laufend?.auftragId === a.id;
  const vorlage = mh.daten.voreinstellungen.find((v) => v.id === a.voreinstellungId);
  return (
    <article className="mh-karte" data-laeuft={laeuft || undefined}>
      <div className="mh-karte-kopf">
        <div className="min-w-0 flex-1">
          <span className="mh-titel">{a.name}</span>
          <span className="mh-meta">{app?.name ?? "Applikation fehlt"}{vorlage ? `, mit „${vorlage.name}“` : ", ohne Voreinstellung"}</span>
        </div>
        <label className="mh-aktiv">
          <Switch checked={a.aktiv} onCheckedChange={(v) => mh.auftragAktiv(a.id, v)} aria-label={`Auftrag „${a.name}“ aktiv`} />
          Aktiv
        </label>
      </div>
      <dl className="kv mh-kv">
        <dt>Zeitplan</dt><dd>{zeitplanText(a.zeitplan)}</dd>
        <dt>Nächster Lauf</dt><dd>{a.aktiv ? datumZeit(a.naechsterLauf) : "pausiert"}</dd>
        <dt>Letzter Lauf</dt><dd>{laeuft ? <span className="status-pill" data-s="laeuft">Läuft</span> : letzter ? <>{datumZeit(letzter.start)} <span className="status-pill" data-s={LAUF_STATUS[letzter.status][1]}>{LAUF_STATUS[letzter.status][0]}</span></> : "noch nie"}</dd>
        <dt>Ergebnis</dt><dd>{ZIEL_LABEL[a.ziel.art]}</dd>
      </dl>
      <div className="mh-fuss">
        <Button size="sm" className="rounded-full ki-knopf" disabled={laeuft} onClick={() => mh.jetztAusfuehren(a.id)}><Play aria-hidden="true" />Jetzt ausführen</Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={onBearbeiten}>Bearbeiten</Button>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Auftrag „${a.name}“ löschen`} title="Auftrag löschen" onClick={onLoeschen}><Trash /></Button>
      </div>
    </article>
  );
}

/** Ergebnisse eines gespeicherten Laufs, je Schritt eine Seite, mit den üblichen Download-Knöpfen. */
function LaufDetail({ lauf, app, onZurueck }: { lauf: Lauf; app?: HubApp; onZurueck: () => void }) {
  const mh = useMeinHub();
  const [i, setI] = useState(0);
  const [fragen, setFragen] = useState(false);
  const laeuft = mh.laufend?.id === lauf.id;
  // Schritt über die ID finden, sonst über den Namen des Ergebnisses (falls die App inzwischen umgebaut wurde)
  const eintrag = (s: { id: string; key: string }) => lauf.ergebnisse[s.id] ?? Object.values(lauf.ergebnisse).find((e) => e.key === s.key);
  const steps = (app?.steps ?? []).filter((s) => eintrag(s));
  const outs = useMemo(() => {
    const o: Record<string, OutState> = {};
    for (const s of steps) {
      const e = eintrag(s)!;
      const status = e.status as OutState["status"];
      o[s.id] = {
        status, text: status === "simuliert" ? undefined : e.text, meldung: e.meldung,
        paket: s.format === "dateien" && e.text ? parsePaket(e.text) : undefined,
        req: { nachricht: e.text ?? "", ergebnisDatei: ergebnisDateiFuer(s, e.text ?? "") } as never,
      };
    }
    return o;
  }, [lauf, steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: RunCtx = { werte: {}, setWert: () => {}, files: {}, dateiInfo: {}, setDatei: () => {}, fehler: new Set(), outs, laeuft: null, ebenen: {}, starten: () => {} };
  const s = steps[Math.min(i, steps.length - 1)];
  return (
    <div className="mh-detail">
      <div className="e-kopf">
        <button type="button" className="pg-btn" onClick={onZurueck}><ChevronLeft size={16} aria-hidden="true" />Verlauf</button>
        <h2 className="mh-h2">{lauf.titel}</h2>
        <span className="hint">{datumZeit(lauf.start)}{lauf.appName && lauf.appName !== lauf.titel ? `, ${lauf.appName}` : ""}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="rounded-full" disabled={laeuft} title={laeuft ? "Läuft noch" : undefined} onClick={() => setFragen(true)}><Trash aria-hidden="true" />Löschen</Button>
      </div>
      {lauf.meldung && <p className="hint" style={{ margin: 0, color: lauf.status === "fehler" ? "var(--danger)" : undefined }}>{lauf.meldung}</p>}
      {app && s ? (
        <RunContext.Provider value={ctx}>
          <div className="app-frame" style={themeStyle(app.theme)}>
            <Blatt id={s.id} className="app-inner innen-scroll">
              <OutputView app={app} titel={s.name} stepId={s.id} stil="plain" mode="run" />
            </Blatt>
            <Pager className="app-pager" label="Ergebnis" mehrzahl="Ergebnisse" seite={Math.min(i, steps.length - 1)} anzahl={steps.length} titel={(k) => steps[k].name} onWechsel={setI} />
          </div>
        </RunContext.Provider>
      ) : !lauf.meldung && <p className="hint">{!app ? "Die Applikation gibt es nicht mehr." : Object.keys(lauf.ergebnisse).length ? "Die Ergebnisse dieses Laufs passen nicht mehr zur aktuellen Version der Applikation." : "Dieser Lauf hat keine Ergebnisse."}</p>}
      <AlertDialog open={fragen} onOpenChange={setFragen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ergebnis „{lauf.titel}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>Das Ergebnis vom {datumZeit(lauf.start)} verschwindet aus dem Verlauf. Auftrag und Voreinstellung bleiben erhalten.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { mh.laufLoeschen(lauf.id); onZurueck(); toast.success("Ergebnis gelöscht."); }}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function MeinHubPage() {
  const { apps, find } = useApps();
  const mh = useMeinHub();
  const [bearbeiten, setBearbeiten] = useState<Auftrag | null>(null);
  const [loeschen, setLoeschen] = useState<Auftrag | null>(null);
  // Name getrennt merken, damit der Titel beim Schließen nicht leer aufblitzt
  const [loeschName, setLoeschName] = useState("");
  // Reiter und offenes Ergebnis stehen in der Adresse: /mein?tab=verlauf&lauf=<id> (z. B. aus „Letztes Ergebnis ansehen“ in der App).
  const [sp, setSp] = useSearchParams();
  const offenerLauf = sp.get("lauf");
  const tab = sp.get("tab") as Reiter | null;
  const reiterAkt: Reiter = tab && REITER.includes(tab) ? tab : offenerLauf ? "verlauf" : "apps";
  const adresse = (r: Reiter, lauf: string | null) => setSp((alt) => {
    const p = new URLSearchParams(alt);
    if (r === "apps") p.delete("tab"); else p.set("tab", r);
    if (lauf) p.set("lauf", lauf); else p.delete("lauf");
    return p;
  }, { replace: true });
  const zumLauf = (id: string) => adresse("verlauf", id);
  const meine = mh.daten.pins.map((p) => apps.find((a) => a.id === p.appId)).filter((a): a is HubApp => !!a);
  const auftraege = [...mh.daten.auftraege].sort((x, y) => (x.naechsterLauf || "z").localeCompare(y.naechsterLauf || "z"));
  const laeufe = mh.daten.laeufe;
  const lauf = laeufe.find((l) => l.id === offenerLauf);
  const bearbeitetesApp = bearbeiten ? find(bearbeiten.appId) : undefined;

  return (
    <div className="mh">
      <header className="hero mh-hero">
        <div className="hero-text">
          <p className="eyebrow">KI-Hub · Mein Hub</p>
          <h1>Deine Apps und Aufträge</h1>
          <p className="lede">
            {mh.nutzerName ? <>Angemeldet als <b>{mh.nutzerName}</b>. </> : "Noch nicht angemeldet, Mein Hub wird in diesem Browser gespeichert. "}
            Gespeicherte Eingaben, regelmäßige Aufträge und ihre Ergebnisse an einem Ort.
          </p>
        </div>
        <div className="mh-steuerung">
          {mh.laufend && <span className="status-pill" data-s="laeuft">Läuft: {mh.laufend.titel}</span>}
          {mh.laufend && <Button size="sm" variant="outline" className="rounded-full" onClick={mh.abbrechen}><Square aria-hidden="true" />Stoppen</Button>}
          <label className="mh-auto">
            <Switch checked={mh.daten.automatisch} onCheckedChange={mh.setAutomatisch} />
            Fällige Aufträge automatisch ausführen
          </label>
        </div>
      </header>
      <Tabs className="mh-reiter" value={reiterAkt} onValueChange={(v) => adresse(v as Reiter, null)}>
        <TabsList className="rounded-full">
          <TabsTrigger value="apps" className="rounded-full px-4">Meine Apps ({meine.length})</TabsTrigger>
          <TabsTrigger value="auftraege" className="rounded-full px-4">Aufträge ({auftraege.length})</TabsTrigger>
          <TabsTrigger value="verlauf" className="rounded-full px-4">Verlauf ({laeufe.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="apps" className="mh-tab">
          <KartenRaster items={meine} schluessel={(a) => a.id!} hoehe={250} hoeheSchmal={150} render={(a) => <AppKarte a={a} onLauf={zumLauf} />}
            leer={mh.geladen ? <><p>Noch keine Apps in Mein Hub.</p><p className="hint">Öffne eine Applikation und wähle „Zu Mein Hub“. Gespeicherte Voreinstellungen und Aufträge bringen ihre App automatisch mit.</p><Button asChild className="rounded-full"><Link to="/" viewTransition>Zu den Applikationen</Link></Button></> : LAEDT} />
        </TabsContent>
        <TabsContent value="auftraege" className="mh-tab">
          <KartenRaster items={auftraege} schluessel={(a) => a.id} hoehe={250} hoeheSchmal={230} breite={340}
            render={(a) => <AuftragKarte a={a} app={find(a.appId)} onBearbeiten={() => setBearbeiten(a)} onLoeschen={() => { setLoeschen(a); setLoeschName(a.name); }} />}
            leer={mh.geladen ? <><p>Noch keine Aufträge.</p><p className="hint">Öffne eine Applikation, füll sie aus und wähle im Menü „Voreinstellungen“ den Punkt „Regelmäßig ausführen“. Dann läuft sie zum Beispiel jeden Montag um 7 Uhr von selbst.</p></> : LAEDT} />
        </TabsContent>
        <TabsContent value="verlauf" className="mh-tab">
          {lauf ? <LaufDetail key={lauf.id} lauf={lauf} app={find(lauf.appId)} onZurueck={() => adresse("verlauf", null)} /> : (
            <KartenRaster items={laeufe} schluessel={(l) => l.id} hoehe={150} breite={280}
              render={(l) => {
                const fertig = Object.values(l.ergebnisse).filter((e) => e.status === "fertig" || e.status === "simuliert").length;
                const status = [...new Set(Object.values(l.ergebnisse).map((e) => SCHRITT_STATUS[e.status as OutState["status"]] ?? e.status))].join(", ");
                return (
                  <button type="button" className="e-kachel mh-lauf" data-s={LAUF_STATUS[l.status][1]} onClick={() => zumLauf(l.id)}>
                    <span className="e-kachel-kopf"><span className="e-titel">{l.titel}</span><span className="status-pill" data-s={LAUF_STATUS[l.status][1]}>{LAUF_STATUS[l.status][0]}</span></span>
                    <span className="e-text">{datumZeit(l.start)}{l.appName && l.appName !== l.titel ? `, ${l.appName}` : ""}{l.meldung ? `. ${l.meldung}` : `. ${anzahl(fertig, "Ergebnis", "Ergebnisse")}${status ? ` (${status})` : ""}`}</span>
                    <span className="e-oeffnen">Öffnen</span>
                  </button>
                );
              }}
              leer={mh.geladen ? <p className="hint">Hier erscheinen die Ergebnisse deiner Aufträge.</p> : LAEDT} />
          )}
        </TabsContent>
      </Tabs>

      {bearbeiten && bearbeitetesApp?.id && (
        <AuftragDialog offen onOffen={(o) => { if (!o) setBearbeiten(null); }} appId={bearbeitetesApp.id} appName={bearbeitetesApp.name} auftrag={bearbeiten} />
      )}
      <AlertDialog open={!!loeschen} onOpenChange={(o) => { if (!o) setLoeschen(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auftrag „{loeschName}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>Der Auftrag läuft dann nicht mehr. Bisherige Ergebnisse bleiben im Verlauf, die Voreinstellung bleibt erhalten.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (loeschen) mh.auftragLoeschen(loeschen.id); setLoeschen(null); }}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
