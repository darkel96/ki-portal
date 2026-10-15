import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Redo2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApps } from "@/state/apps";
import type { App, BlockType } from "@/lib/schema";
import { appWarnings, areaList, clone, locate, makeBlock, newApp, seiteMit, seitenTitel, seitenVon, walk } from "@/lib/model";
import { RunApp, type RunAppHandle } from "@/components/renderer/RunApp";
import { geloeschtToast, useBuilder } from "@/components/builder/useBuilder";
import { Canvas, Palette, SeitenLeiste, UiDnd, listOf, scrollArt } from "@/components/builder/Canvas";
import { Inspector } from "@/components/builder/Inspector";
import { KiTab } from "@/components/builder/KiTab";
import { AssistantPanel, useAssistZustand } from "@/components/builder/AssistantPanel";
import { JsonDialog } from "@/components/builder/JsonDialog";
import { BT } from "@/components/builder/catalog";
import { NotFoundPage } from "./NotFoundPage";
import { loadApp } from "@/lib/sanitize";
import { useRechte } from "@/state/rechte";
import { KeineRechte } from "@/pages/VerwaltungPage";

function Editor({ start, ungespeichert }: { start: App; ungespeichert: boolean }) {
  const b = useBuilder(start, ungespeichert);
  const { save, apps } = useApps();
  const nav = useNavigate();
  const [tab, setTab] = useState<"ui" | "ki">("ui");
  const [vorschau, setVorschau] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [ansage, setAnsage] = useState("");
  /** Zählt hoch, wenn der KI-Ablauf die Prüfung zeigen soll (Speichern mit offenen Punkten). */
  const [pruefen, setPruefen] = useState(0);
  /** Seite mit Inhalt, deren Löschen noch bestätigt werden muss. */
  const [seiteWeg, setSeiteWeg] = useState<{ id: string; titel: string; n: number } | null>(null);
  const [seiteRoh, setSeite] = useState(0);
  /** Auf schmalen Bildschirmen ist immer nur ein Bereich sichtbar. */
  const [bereich, setBereich] = useState<"pal" | "flaeche" | "insp">("flaeche");
  const seiten = seitenVon(b.app);
  const seite = Math.min(seiteRoh, Math.max(0, seiten.length - 1));
  const runRef = useRef<RunAppHandle>(null);
  const assist = useAssistZustand(start);

  // Die Fläche folgt der Auswahl: Liegt der gewählte Baustein auf einer anderen Seite (z. B. nach Rückgängig), dorthin wechseln.
  useEffect(() => {
    if (!b.sel) return;
    const direkt = seiten.findIndex((p) => p.id === b.sel);
    const s = direkt >= 0 ? direkt : seiteMit(b.app, (x) => x.id === b.sel);
    if (s >= 0 && s !== seite) setSeite(s);
  }, [b.sel, b.app]); // eslint-disable-line react-hooks/exhaustive-deps
  const bereiche = useMemo(() => areaList(apps), [apps]);
  const harte = appWarnings(b.app).filter((w) => !w.weich);

  /** Nach „Verwerfen“ oder „Speichern und verlassen“ darf die Seite ohne weitere Rückfrage verlassen werden */
  const freigabe = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !freigabe.current && b.dirty && !speichert && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const pfadRef = useRef(window.location.hash || window.location.pathname);
  pfadRef.current = window.location.hash || window.location.pathname;
  /**
   * Blockierte Navigation fortsetzen. Der Router setzt sie selbst fort; bleibt die Seite trotzdem stehen (z. B. weil
   * der Blocker zwischenzeitlich zurückgesetzt wurde), navigiert der Hub nach kurzer Zeit selbst zum Ziel.
   */
  const verlassen = () => {
    const bl = blockerRef.current;
    if (bl.state !== "blocked") return;
    const ziel = bl.location;
    const start = pfadRef.current;
    freigabe.current = true;
    bl.proceed();
    window.setTimeout(() => {
      if (pfadRef.current === start) nav(ziel.pathname + ziel.search + ziel.hash);
    }, 500);
  };
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (b.dirty && !speichert) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [b.dirty, speichert]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void speichernRef.current(); return; }
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) b.redo(); else b.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); b.redo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [b]);

  const loeschen = useCallback((id: string) => {
    const vorher = b.aktuell();
    const l = locate(vorher.blocks, id);
    b.change((d) => { const x = locate(d.blocks, id); if (x) x.list.splice(x.i, 1); });
    b.setSel(null);
    const name = l ? BT[l.b.type].label : "Baustein";
    setAnsage(`${name} gelöscht. Strg+Z stellt ihn wieder her.`);
    geloeschtToast(b, vorher, `${name} gelöscht.`, () => b.setSel(id));
  }, [b]);
  const del = useCallback((id: string) => {
    const app = b.aktuell();
    const l = locate(app.blocks, id);
    if (l?.b.type === "seite") {
      const seitenListe = seitenVon(app);
      if (seitenListe.length <= 1) { toast.error("Eine Applikation braucht mindestens eine Seite."); return; }
      let n = 0;
      walk(l.b.children ?? [], () => { n++; });
      // Eine Seite mit Bausteinen erst nach Rückfrage löschen.
      if (n > 0) { setSeiteWeg({ id, titel: seitenTitel(l.b, seitenListe.findIndex((p) => p.id === id)), n }); return; }
    }
    loeschen(id);
  }, [b, loeschen]);
  const focusProp = useCallback((id: string) => { b.setSel(id); setBereich("insp"); requestAnimationFrame(() => document.getElementById("insp-first")?.focus()); }, [b]);
  const addByClick = (type: BlockType) => {
    const nb = makeBlock(type, b.app);
    if (type === "seite") {
      b.change((d) => { d.blocks.splice(seite + 1, 0, structuredClone(nb)); });
      setSeite(seite + 1);
      b.setSel(nb.id);
      setBereich("flaeche");
      setAnsage(`Seite ${seite + 2} eingefügt.`);
      return;
    }
    b.change((d) => {
      const aktuell = d.blocks[seite];
      const loc = b.sel ? locate(d.blocks, b.sel) : null;
      let target = aktuell.children ?? (aktuell.children = []), idx = target.length;
      if (loc) {
        if (loc.b.type === "section" || loc.b.type === "seite") { target = loc.b.children ?? (loc.b.children = []); idx = target.length; }
        else if (loc.b.type === "columns") { target = listOf(d, `${loc.b.id}:0`) ?? target; idx = target.length; }
        else { target = loc.list; idx = loc.i + 1; }
      }
      target.splice(idx, 0, structuredClone(nb));
    });
    b.setSel(nb.id);
    setBereich("flaeche");
    requestAnimationFrame(() => document.querySelector(`[data-bid="${nb.id}"]`)?.scrollIntoView({ block: "nearest", behavior: scrollArt() }));
  };

  const speichernRef = useRef<() => Promise<boolean>>(async () => false);
  /** Speichert und öffnet die App. Mit bleiben: nur speichern (z. B. beim Verlassen über den Dialog). */
  const speichern = async (bleiben = false): Promise<boolean> => {
    if (speichert) return false;
    // Fehlender Name: dort bleiben, wo man ist, und das Namensfeld fokussieren.
    if (!b.aktuell().name.trim()) { toast.error("Gib der Applikation einen Namen."); document.getElementById("bld-name")?.focus(); return false; }
    if (harte.length) {
      toast.error(harte[0].text + (harte.length > 1 ? ` (und ${harte.length - 1} weitere Punkte im KI-Ablauf)` : ""));
      setTab("ki"); setVorschau(false); setPruefen((n) => n + 1);
      return false;
    }
    setSpeichert(true);
    try {
      const def = await save(b.aktuell());
      b.setDirty(false);
      toast.success(`„${def.name}“ gespeichert, Version ${def.version}.`);
      if (!bleiben) nav(`/app/${def.id}`, { viewTransition: true });
      return true;
    } catch (e) {
      setSpeichert(false);
      toast.error(e instanceof Error ? e.message : "Speichern ist fehlgeschlagen.");
      return false;
    }
  };
  const speichernUndVerlassen = async () => {
    if (await speichern(true)) verlassen();
    else blockerRef.current.reset?.();
  };

  speichernRef.current = speichern;

  return (
    <>
      <h1 className="sr-only">Baukasten: {b.app.name || "Neue Applikation"}</h1>
      <div className="sr-only" aria-live="polite">{ansage}</div>
      <div className="bld-bar">
        <label htmlFor="bld-name" className="sr-only">Name der Applikation</label>
        <Input id="bld-name" className="bar-name" maxLength={60} value={b.app.name} placeholder="Name der Applikation" onChange={(e) => b.change((d) => { d.name = e.target.value; }, "name")} />
        <Tabs value={tab} onValueChange={(v) => { setTab(v as "ui" | "ki"); setVorschau(false); setPruefen(0); }}>
          <TabsList className="rounded-full">
            <TabsTrigger value="ui" className="rounded-full px-4">Oberfläche</TabsTrigger>
            <TabsTrigger value="ki" className="rounded-full px-4">KI-Ablauf{harte.length > 0 && <><span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 text-[11px] text-destructive" aria-hidden="true">{harte.length}</span><span className="sr-only">, {harte.length} offene Punkte</span></>}</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <Button variant="outline" size="icon" aria-label="Rückgängig (Strg+Z)" title="Rückgängig (Strg+Z)" disabled={!b.canUndo} onClick={b.undo}><Undo2 /></Button>
        <Button variant="outline" size="icon" aria-label="Wiederholen (Strg+Y)" title="Wiederholen (Strg+Y)" disabled={!b.canRedo} onClick={b.redo}><Redo2 /></Button>
        <span className="nur-breit"><JsonDialog b={b} /></span>
        <Button variant={vorschau ? "secondary" : "outline"} aria-pressed={vorschau} onClick={() => setVorschau((v) => !v)}>{vorschau ? <EyeOff /> : <Eye />}<span className="bar-txt">{vorschau ? "Vorschau beenden" : "Vorschau testen"}</span><span className="bar-kurz" aria-hidden="true">{vorschau ? "Zurück" : "Vorschau"}</span></Button>
        <Button onClick={() => void speichern()} disabled={speichert} title="Speichern (Strg+S)" aria-keyshortcuts="Control+S">{speichert ? <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Speichert …</> : <><Save />Speichern{b.dirty && <><span className="dirty-punkt" aria-hidden="true" /><span className="sr-only"> (ungespeicherte Änderungen)</span></>}</>}</Button>
      </div>

      {vorschau ? (
        <div className="stage vorschau">
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
            <span className="status-pill" data-s="fertig">Vorschau</span>So sieht die Applikation im Hub aus. Eingaben und KI-Buttons funktionieren.
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => runRef.current?.beispieleEinsetzen()}>Beispieldaten einsetzen</Button>
          </div>
          <RunApp ref={runRef} app={b.app} eingebettet />
        </div>
      ) : tab === "ki" ? <KiTab b={b} fokusPruefung={pruefen} /> : (
        <UiDnd b={b} onAdded={(id) => b.setSel(id)} onSeiteNeu={() => addByClick("seite")}>
          <div className="bld-bereiche" role="group" aria-label="Bereich anzeigen">
            {([["pal", "Bausteine"], ["flaeche", "Fläche"], ["insp", "Eigenschaften"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={bereich === k} onClick={() => setBereich(k)}>{l}</button>
            ))}
          </div>
          <div className="bld" data-bereich={bereich}>
            <Palette onAdd={addByClick} />
            <div className="bld-mitte">
              <AssistantPanel b={b} a={assist} />
              <SeitenLeiste b={b} seite={seite} onSeite={setSeite} onNeu={() => addByClick("seite")} />
              <Canvas b={b} seite={seite} onDelete={del} onFocusProp={focusProp} />
            </div>
            <Inspector b={b} onDelete={del} bereiche={bereiche} onSeite={setSeite} />
          </div>
        </UiDnd>
      )}

      <AlertDialog open={blocker.state === "blocked"} onOpenChange={(o) => { if (!o && !freigabe.current) blockerRef.current.reset?.(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
            <AlertDialogDescription>Du hast „{b.app.name}“ geändert und noch nicht gespeichert. Wenn du die Seite verlässt, gehen die Änderungen verloren.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={speichert} onClick={verlassen}>Änderungen verwerfen</AlertDialogAction>
            <Button disabled={speichert} onClick={() => void speichernUndVerlassen()}>{speichert ? <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Speichert …</> : "Speichern und verlassen"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!seiteWeg} onOpenChange={(o) => { if (!o) setSeiteWeg(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seite „{seiteWeg?.titel}“ mit {seiteWeg?.n} {seiteWeg?.n === 1 ? "Baustein" : "Bausteinen"} löschen?</AlertDialogTitle>
            <AlertDialogDescription>Die Seite und alles darauf werden entfernt. Mit „Rückgängig“ holst du sie zurück.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behalten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (seiteWeg) loeschen(seiteWeg.id); setSeiteWeg(null); }}>Seite löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BuilderPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { find, geladen } = useApps();
  const rechte = useRechte();
  const loc = useLocation();
  const kopie = sp.get("kopie");
  // Entwurf aus „Neue Applikation“ (per KI erstellt), über den Navigationszustand übergeben.
  const entwurf = !id && !kopie ? (loc.state as { entwurf?: App } | null)?.entwurf : undefined;
  const quelle = id ? find(id) : kopie ? find(kopie) : undefined;
  if ((id || kopie) && !quelle) return geladen ? <NotFoundPage /> : <p className="hint">Applikation wird geladen …</p>;
  if (id && quelle && quelle._src !== "eigene") return <NotFoundPage />;
  if (rechte.geladen && !rechte.darf("bauen")) return <KeineRechte was="den Baukasten" />;
  if (rechte.geladen && id && quelle && !rechte.darfApp(quelle, "bearbeiten")) return <KeineRechte was={`das Bearbeiten von „${quelle.name}“`} />;
  let start: App;
  if (quelle) {
    const { _src, ...rest } = clone(quelle);
    void _src;
    start = kopie ? { ...rest, id: null, name: `${rest.name} (Kopie)`, status: "entwurf", version: 0, geaendert: "" } : rest;
  } else start = entwurf ? loadApp(entwurf) ?? newApp() : newApp();
  // Entwurf und Kopie sind noch nicht gespeichert: Verlassen soll warnen.
  return <Editor key={`${id ?? ""}|${kopie ?? ""}|${entwurf ? loc.key : ""}`} start={start} ungespeichert={!!kopie || (!quelle && !!entwurf)} />;
}
