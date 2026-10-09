import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { App, Block, PropsOf } from "@/lib/schema";
import { isFieldType } from "@/lib/schema";
import { allKeys, cloneBlock, locate, removeVar, renameRefs, seiteMit, seitenTitel, seitenVon, setCols, slug, uniqueKey, varsIn, stepText } from "@/lib/model";
import { loadImage } from "@/lib/files";
import { BT } from "./catalog";
import { Check, Fld, PALETTES, Seg, Sel, Swatches, TextFld } from "./controls";
import type { Builder } from "./useBuilder";

const ALIGN: ["left" | "center" | "right", string][] = [["left", "Links"], ["center", "Mitte"], ["right", "Rechts"]];
const STATUS: [App["status"], string][] = [["entwurf", "Entwurf"], ["pruefung", "In Prüfung"], ["freigegeben", "Freigegeben"]];
const SCHUTZ: [App["schutz"], string][] = [["oeffentlich", "Öffentlich"], ["intern", "Intern"], ["vertraulich", "Vertraulich"]];

function AppSettings({ b, alleBereiche }: { b: Builder; alleBereiche: string[] }) {
  const t = b.app.theme;
  const setTheme = <K extends keyof App["theme"]>(k: K, v: App["theme"][K]) => b.change((d) => { d.theme[k] = v; });
  return (
    <>
      <div className="insp-head"><h3>Applikation</h3></div>
      <Tabs defaultValue="allgemein" className="ki-teile">
        <TabsList variant="line" aria-label="Einstellungen der Applikation">
          <TabsTrigger value="allgemein">Allgemein</TabsTrigger>
          <TabsTrigger value="design">Gestaltung</TabsTrigger>
          <TabsTrigger value="freigabe">Freigabe</TabsTrigger>
        </TabsList>
        <TabsContent value="allgemein" className="ki-teil">
          <Fld label="Bereich" htmlFor="insp-first" hint="Neuen Bereich einfach eintippen.">
            <Input id="insp-first" list="ap-bereiche" value={b.app.bereich} onChange={(e) => b.change((d) => { d.bereich = e.target.value; }, "bereich")} />
            <datalist id="ap-bereiche">{alleBereiche.map((x) => <option key={x} value={x} />)}</datalist>
          </Fld>
          <TextFld label="Kurzbeschreibung für die Kachel" multiline rows={3} value={b.app.beschreibung} onChange={(v) => b.change((d) => { d.beschreibung = v; }, "beschreibung")} />
          <p className="hint" style={{ margin: 0 }}>Klick einen Baustein auf der Fläche an, um ihn zu bearbeiten, oder einen Seiten-Reiter für die Seite. Entf löscht den gewählten Baustein, Strg+Z macht rückgängig.</p>
        </TabsContent>
        <TabsContent value="design" className="ki-teil">
          <Swatches label="Akzentfarbe" value={t.accent} colors={PALETTES.akzent} onChange={(v) => setTheme("accent", v)} />
          <Swatches label="Hintergrund" value={t.bg} colors={PALETTES.grund} onChange={(v) => setTheme("bg", v)} />
          <Seg label="Schrift" value={t.font} options={[["sans", "Modern"], ["serif", "Klassisch"], ["display", "Markant"], ["mono", "Technisch"]]} onChange={(v) => setTheme("font", v)} />
          <Seg label="Ecken" value={t.radius} options={[["s", "Eckig"], ["m", "Leicht"], ["l", "Rund"]]} onChange={(v) => setTheme("radius", v)} />
          <Seg label="Breite" value={t.width} options={[["s", "Schmal"], ["m", "Normal"], ["l", "Breit"]]} onChange={(v) => setTheme("width", v)} />
        </TabsContent>
        <TabsContent value="freigabe" className="ki-teil">
          <Seg label="Status" value={b.app.status} options={STATUS} onChange={(v) => b.change((d) => { d.status = v; })} />
          <TextFld label="Verantwortlich" value={b.app.owner} placeholder="Name oder Abteilung" onChange={(v) => b.change((d) => { d.owner = v; }, "owner")} />
          <Seg label="Schutzklasse der Daten" value={b.app.schutz} options={SCHUTZ} onChange={(v) => b.change((d) => { d.schutz = v; })} />
          <span className="hint">Version {b.app.version || 0}{b.app.geaendert ? `, zuletzt gespeichert ${new Date(b.app.geaendert).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}` : ", noch nicht gespeichert"}. Jedes Speichern erhöht die Version.</span>
        </TabsContent>
      </Tabs>
    </>
  );
}

function KeyField({ b, x }: { b: Builder; x: Block }) {
  const key = (x.props as { key: string }).key;
  const [v, setV] = useState(key);
  useEffect(() => setV(key), [key]);
  const commit = () => b.change((d) => {
    const loc = locate(d.blocks, x.id);
    if (!loc || !isFieldType(loc.b.type)) return;
    const p = loc.b.props as PropsOf<"input">;
    const nk = uniqueKey(slug(v), allKeys(d, loc.b));
    if (nk !== p.key) renameRefs(d, p.key, nk);
    p.key = nk; p.keyAuto = false;
  });
  return (
    <Fld label="Platzhalter" htmlFor="insp-key" hint={<>So setzt du dieses Feld in eine Aufgabe für die KI ein: <code>{`{{${key}}}`}</code></>}>
      <Input id="insp-key" className="font-mono text-[13px]" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </Fld>
  );
}

function PassBox({ b, x }: { b: Builder; x: Block }) {
  const P = x.props as PropsOf<"input">;
  const k = P.key.toLowerCase();
  if (!b.app.steps.length) return <div className="box"><span className="hint">Leg zuerst im KI-Ablauf einen Schritt an.</span></div>;
  return (
    <div className="box">
      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--brand)" }}>An die KI übergeben</span>
      {b.app.steps.map((s, i) => {
        const inText = varsIn(stepText(s)).includes(k);
        return (
          <Check key={s.id} checked={s.autoAll || inText} disabled={s.autoAll && !inText}
            label={`Schritt ${i + 1}: ${s.name}`} hint={s.autoAll && !inText ? "bekommt alle Eingaben automatisch" : undefined}
            onChange={(on) => b.change((d) => {
              const st = d.steps[i];
              if (on) { if (!varsIn(stepText(st)).includes(k)) st.prompt = (st.prompt.trim() ? st.prompt.replace(/\s+$/, "") + "\n\n" : "") + `${P.label}:\n{{${P.key}}}`; }
              else removeVar(st, P.key);
            })} />
        );
      })}
      <span className="hint">Ein Häkchen gibt „{P.label}“ an diesen Schritt weiter. Ohne Häkchen bekommt die KI dieses Feld nicht.</span>
    </div>
  );
}

/** Baustein auf eine andere Seite verschieben (ans Ende der Zielseite). */
function SeitenWahl({ b, id, onSeite }: { b: Builder; id: string; onSeite: (i: number) => void }) {
  const seiten = seitenVon(b.app);
  if (seiten.length < 2) return null;
  const hier = seiteMit(b.app, (x) => x.id === id);
  return (
    <Sel label="Steht auf Seite" value={seiten[hier]?.id ?? ""} options={seiten.map((p, i) => [p.id, `${i + 1}: ${seitenTitel(p, i)}`] as [string, string])}
      onChange={(ziel) => {
        const zi = seiten.findIndex((p) => p.id === ziel);
        if (zi < 0 || zi === hier) return;
        b.change((d) => {
          const l = locate(d.blocks, id);
          const zp = d.blocks.find((p) => p.id === ziel);
          if (!l || !zp) return;
          l.list.splice(l.i, 1);
          (zp.children ??= []).push(l.b);
        });
        onSeite(zi);
      }} />
  );
}

export function Inspector({ b, onDelete, bereiche, onSeite }: { b: Builder; onDelete: (id: string) => void; bereiche: string[]; onSeite: (i: number) => void }) {
  const loc = b.sel ? locate(b.app.blocks, b.sel) : null;
  const [bildMeldung, setBildMeldung] = useState("");
  if (!loc) return <aside className="panel insp" aria-label="Eigenschaften"><AppSettings b={b} alleBereiche={bereiche} /></aside>;
  const x = loc.b;
  const id = x.id;
  const set = (k: string, v: unknown, coalesce?: boolean) => b.change((d) => {
    const l = locate(d.blocks, id);
    if (l) (l.b.props as Record<string, unknown>)[k] = v;
  }, coalesce ? `${id}:${k}` : undefined);
  const P = x.props as Record<string, never>;
  const steps: [string, string][] = b.app.steps.map((s) => [s.id, s.name]);
  const { label, icon: Icon } = BT[x.type];
  let f: React.ReactNode;
  switch (x.type) {
    case "seite": {
      const i = b.app.blocks.findIndex((p) => p.id === id);
      const n = b.app.blocks.length;
      const schieben = (dir: -1 | 1) => {
        b.change((d) => { const j = i + dir; if (j < 0 || j >= d.blocks.length) return; [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]]; });
        onSeite(i + dir);
      };
      f = <>
        <TextFld id="insp-first" label="Titel der Seite" value={x.props.titel} onChange={(v) => set("titel", v, true)} />
        <p className="hint" style={{ margin: 0 }}>Der Titel steht in der App unten in der Seitenleiste und auf dem Weiter-Knopf der vorigen Seite. Jede Seite sollte ohne Scrollen auf einen Bildschirm passen.</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" disabled={i <= 0} onClick={() => schieben(-1)}><ArrowLeft size={14} aria-hidden="true" />Nach vorn</Button>
          <Button variant="outline" size="sm" disabled={i >= n - 1} onClick={() => schieben(1)}>Nach hinten<ArrowRight size={14} aria-hidden="true" /></Button>
        </div></>;
      break;
    }
    case "heading": f = <>
      <TextFld id="insp-first" label="Text" value={x.props.text} onChange={(v) => set("text", v, true)} />
      <Seg label="Größe" value={x.props.level} options={[[1, "Groß"], [2, "Mittel"], [3, "Klein"]]} onChange={(v) => set("level", v)} />
      <Seg label="Ausrichtung" value={x.props.align} options={ALIGN} onChange={(v) => set("align", v)} />
      <Swatches label="Farbe" value={x.props.color} colors={PALETTES.text} onChange={(v) => set("color", v)} /></>; break;
    case "text": f = <>
      <TextFld id="insp-first" label="Text" multiline rows={5} value={x.props.text} onChange={(v) => set("text", v, true)} />
      <Seg label="Größe" value={x.props.size} options={[["s", "Klein"], ["m", "Normal"], ["l", "Groß"]]} onChange={(v) => set("size", v)} />
      <Seg label="Ausrichtung" value={x.props.align} options={ALIGN} onChange={(v) => set("align", v)} />
      <Swatches label="Farbe" value={x.props.color} colors={PALETTES.text} onChange={(v) => set("color", v)} /></>; break;
    case "callout": f = <>
      <TextFld id="insp-first" label="Text" multiline value={x.props.text} onChange={(v) => set("text", v, true)} />
      <Seg label="Art" value={x.props.tone} options={[["info", "Info"], ["warn", "Achtung"], ["ok", "Tipp"]]} onChange={(v) => set("tone", v)} /></>; break;
    case "image": f = <>
      <Fld label="Bilddatei" htmlFor="insp-first" hint={bildMeldung || (x.props.src ? "Eine neue Datei ersetzt das Bild." : "PNG, JPG, WebP oder SVG. Große Bilder werden verkleinert.")}>
        <Input id="insp-first" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const src = await loadImage(file);
            if (src.length > 400_000) { setBildMeldung("Das Bild ist auch verkleinert noch zu groß. Nutze ein kleineres Bild oder ein Logo als PNG/SVG."); return; }
            b.change((d) => { const l = locate(d.blocks, id); if (l?.b.type === "image") { l.b.props.src = src; if (!l.b.props.alt) l.b.props.alt = file.name.replace(/\.[^.]+$/, ""); } });
            setBildMeldung("");
          } catch { setBildMeldung("Die Datei konnte nicht als Bild gelesen werden."); }
        }} />
      </Fld>
      <TextFld label="Alternativtext" value={x.props.alt} placeholder="Was zeigt das Bild?" onChange={(v) => set("alt", v, true)} />
      <Seg label="Größe" value={x.props.size} options={[["s", "Klein"], ["m", "Mittel"], ["l", "Groß"], ["full", "Volle Breite"]]} onChange={(v) => set("size", v)} />
      <Seg label="Ausrichtung" value={x.props.align} options={ALIGN} onChange={(v) => set("align", v)} />
      {x.props.src && <Button variant="outline" size="sm" onClick={() => set("src", "")}>Bild entfernen</Button>}</>; break;
    case "spacer": f = <Seg label="Höhe" value={x.props.h} options={[[12, "Klein"], [24, "Mittel"], [48, "Groß"]]} onChange={(v) => set("h", v)} />; break;
    case "divider": f = <p className="hint" style={{ margin: 0 }}>Eine Trennlinie hat keine Einstellungen.</p>; break;
    case "section": f = <>
      <Swatches label="Hintergrund" value={x.props.bg} colors={PALETTES.grund} onChange={(v) => set("bg", v)} />
      <Seg label="Innenabstand" value={x.props.pad} options={[["s", "Klein"], ["m", "Mittel"], ["l", "Groß"]]} onChange={(v) => set("pad", v)} />
      <Check label="Rahmen anzeigen" checked={x.props.border} onChange={(v) => set("border", v)} /></>; break;
    case "columns": f = <>
      <Seg label="Spalten" value={x.props.count} options={[[2, "2 Spalten"], [3, "3 Spalten"]]} onChange={(v) => b.change((d) => { const l = locate(d.blocks, id); if (l) setCols(l.b, v); })} />
      <p className="hint" style={{ margin: 0 }}>Zieh Bausteine in die einzelnen Spalten. Auf schmalen Bildschirmen stehen die Spalten untereinander.</p></>; break;
    case "button": f = <>
      <TextFld id="insp-first" label="Beschriftung" value={x.props.text} onChange={(v) => set("text", v, true)} />
      <Sel label="Startet" value={x.props.aktion} onChange={(v) => set("aktion", v)}
        options={[["alle", "Alle KI-Schritte nacheinander"], ...steps.map(([sid, n]) => [sid, `Nur: ${n}`] as [string, string]), ...steps.slice(1).map(([sid, n]) => [`ab:${sid}`, `Ab: ${n} (bis zum Ende)`] as [string, string])]} />
      <p className="hint" style={{ margin: 0 }}>Braucht ein Schritt das Ergebnis eines früheren, muss dieser vorher gelaufen sein. Pflichtfelder werden nur für die gestarteten Schritte geprüft.</p>
      <Seg label="Stil" value={x.props.stil} options={[["filled", "Gefüllt"], ["outline", "Umrandet"]]} onChange={(v) => set("stil", v)} />
      <Seg label="Ausrichtung" value={x.props.align} options={ALIGN} onChange={(v) => set("align", v)} />
      <Swatches label="Farbe" value={x.props.color} colors={PALETTES.akzent} onChange={(v) => set("color", v)} /></>; break;
    case "output": f = <>
      <TextFld id="insp-first" label="Titel" value={x.props.titel} onChange={(v) => set("titel", v, true)} />
      <Sel label="Zeigt das Ergebnis von" value={x.props.quelle || "__none"} onChange={(v) => set("quelle", v === "__none" ? "" : v)} options={[["__none", "Bitte wählen"], ...steps]} />
      <Seg label="Stil" value={x.props.stil} options={[["card", "Karte"], ["plain", "Schlicht"]]} onChange={(v) => set("stil", v)} /></>; break;
    default: {
      const fp = x.props as PropsOf<"select">;
      f = <>
        <TextFld id="insp-first" label="Bezeichnung" value={fp.label} onChange={(v) => b.change((d) => {
          const l = locate(d.blocks, id);
          if (!l || !isFieldType(l.b.type)) return;
          const p = l.b.props as PropsOf<"input">;
          p.label = v;
          if (p.keyAuto) { const nk = uniqueKey(slug(v), allKeys(d, l.b)); if (nk !== p.key) { renameRefs(d, p.key, nk); p.key = nk; } }
        }, `${id}:label`)} />
        <KeyField b={b} x={x} />
        {["input", "textarea", "number"].includes(x.type) && <TextFld label="Platzhaltertext" value={P.placeholder ?? ""} onChange={(v) => set("placeholder", v, true)} />}
        {(x.type === "select" || x.type === "radio") && <TextFld label="Optionen (eine pro Zeile)" multiline rows={4} value={fp.optionen.join("\n")} onChange={(v) => set("optionen", v.split("\n").map((s) => s.trim()).filter(Boolean), true)} />}
        {x.type === "textarea" && <Seg label="Höhe" value={x.props.rows} options={[[3, "Klein"], [5, "Mittel"], [9, "Groß"]]} onChange={(v) => set("rows", v)} />}
        <TextFld label="Hilfetext" value={fp.hilfe} placeholder="Optional, steht unter dem Feld" onChange={(v) => set("hilfe", v, true)} />
        {x.type !== "file" && <TextFld label="Beispielwert zum Testen" multiline={x.type === "textarea"} value={fp.beispiel} onChange={(v) => set("beispiel", v, true)} />}
        {x.type === "file" && <>
          <Seg label="Übergabe an die KI" value={x.props.uebergabe} options={[["text", "Inhalt als Text"], ["referenz", "Als Datei (Copilot)"]]} onChange={(v) => set("uebergabe", v)} />
          <p className="hint" style={{ margin: 0 }}>Gelesen werden Word (.docx), Excel (.xlsx), PDF und Textdateien. „Als Datei“ bedeutet: Die zentrale KI-Anbindung legt die Datei in OneDrive ab und übergibt Copilot einen Verweis.</p></>}
        <Check label="Pflichtfeld" checked={fp.pflicht} onChange={(v) => set("pflicht", v)} />
        <PassBox b={b} x={x} />
      </>;
    }
  }
  return (
    <aside className="panel insp" aria-label="Eigenschaften">
      <div className="insp-head"><span className="g" aria-hidden="true"><Icon size={15} /></span><h3>{label}</h3></div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => b.setSel(null)}>App-Einstellungen</Button>
        <Button variant="outline" size="sm" onClick={() => b.change((d) => { const l = locate(d.blocks, id); if (l) { const c = cloneBlock(l.b, d); l.list.splice(l.i + 1, 0, c); } })}><Copy size={14} aria-hidden="true" />Duplizieren</Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => onDelete(id)}><Trash size={14} aria-hidden="true" />Löschen</Button>
      </div>
      {f}
      {x.type !== "seite" && <SeitenWahl b={b} id={id} onSeite={onSeite} />}
    </aside>
  );
}
