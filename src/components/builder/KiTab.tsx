import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { App, Step } from "@/lib/schema";
import { DATEI_ZUSATZ, allKeys, appWarnings, fieldsOf, makeStep, renameRefs, rid, slug, stepText, stepsUsing, uniqueKey, varsIn, walk } from "@/lib/model";
import { FORMAT_LABEL, MODELL_LABEL, QUELL_TYP, buildRequest, graphPreview } from "@/lib/request";
import { KI_ZENTRAL } from "@/lib/ki/config";
import { kiModus } from "@/lib/ki";
import { Check, Fld, Sel, TextFld } from "./controls";
import type { Builder } from "./useBuilder";

const DATEI_OPTIONEN: [string, string][] = [["keine", "Keine (nur anzeigen)"], ["pdf", "PDF"], ["docx", "Word (.docx)"], ["xlsx", "Excel (.xlsx)"], ["pptx", "PowerPoint (.pptx)"], ["wunsch", "Wie in Aufgabe oder Eingabe verlangt"]];
const BED_OP: [NonNullable<Step["bedingung"]>["op"], string][] = [["gleich", "ist gleich"], ["ungleich", "ist nicht"], ["gefuellt", "ist ausgefüllt"], ["leer", "ist leer"]];

/** Fügt einen Platzhalter an der Cursorposition ein. */
function insertAt(el: HTMLTextAreaElement | null, text: string, apply: (v: string) => void) {
  if (!el) return;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  const v = el.value.slice(0, s) + text + el.value.slice(e);
  apply(v);
  requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + text.length; });
}

function VarChips({ app, i, onInsert }: { app: App; i: number; onInsert: (t: string) => void }) {
  return (
    <div className="vars" aria-label="Platzhalter einsetzen">
      <span className="hint">Einsetzen:</span>
      {fieldsOf(app).map((b) => <button key={b.id} type="button" className="var" title={`Setzt {{${b.props.key}}} ein`} onClick={() => onInsert(`{{${b.props.key}}}`)}><Plus size={11} aria-hidden="true" />{b.props.label}</button>)}
      {fieldsOf(app).filter((b) => b.type === "file").flatMap((b) => DATEI_ZUSATZ.map((z) => (
        <button key={`${b.id}-${z.key}`} type="button" className="var" title={`Setzt {{${b.props.key}_${z.key}}} ein`} onClick={() => onInsert(`{{${b.props.key}_${z.key}}}`)}><Plus size={11} aria-hidden="true" />{z.label}: {b.props.label}</button>
      )))}
      {app.steps.slice(0, i).map((s) => <button key={s.id} type="button" className="var prev" title={`Setzt {{${s.key}}} ein`} onClick={() => onInsert(`{{${s.key}}}`)}><Plus size={11} aria-hidden="true" />Ergebnis: {s.name}</button>)}
    </div>
  );
}

function StepKey({ b, i }: { b: Builder; i: number }) {
  const key = b.app.steps[i].key;
  const [v, setV] = useState(key);
  useEffect(() => setV(key), [key]);
  const commit = () => b.change((d) => {
    const s = d.steps[i];
    const nk = uniqueKey(slug(v), allKeys(d, s));
    if (nk !== s.key) renameRefs(d, s.key, nk);
    s.key = nk;
  });
  return (
    <Fld label="Name des Ergebnisses" htmlFor={`sk-${b.app.steps[i].id}`}>
      <Input id={`sk-${b.app.steps[i].id}`} className="font-mono text-[13px]" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </Fld>
  );
}

function StepCard({ b, i, onAktiv }: { b: Builder; i: number; onAktiv: (id: string | null) => void }) {
  const s = b.app.steps[i];
  const n = b.app.steps.length;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const zielRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Step>(k: K, v: Step[K], coalesce = false) => b.change((d) => { d.steps[i][k] = v; }, coalesce ? `${s.id}:${String(k)}` : undefined);
  const setTeam = (mut: (t: NonNullable<Step["team"]>) => void, coalesce?: string) => b.change((d) => { const t = d.steps[i].team; if (t) mut(t); }, coalesce);
  const fl = fieldsOf(b.app).filter((x) => stepsUsing(b.app, x.props.key).includes(i)).map((x) => x.props.label);
  const prev = b.app.steps.slice(0, i).filter((p) => varsIn(stepText(s)).includes(p.key.toLowerCase())).map((p) => `Ergebnis von ${p.name}`);
  let anzeigen = 0;
  walk(b.app.blocks, (x) => { if (x.type === "output" && x.props.quelle === s.id) anzeigen++; });
  const team = s.art === "team" && s.team;
  const [teil, setTeil] = useState("aufgabe");
  const aktTeil = teil === "team" && !team ? "aufgabe" : teil;

  return (
    <section className="panel srow ki-karte" aria-label={`Schritt ${i + 1}: ${s.name}`}>
      <div className="srow-head">
        <span className="step-no">Schritt {i + 1}</span>
        <Input value={s.name} aria-label="Name des Schritts" className="flex-1 font-medium" onChange={(e) => set("name", e.target.value, true)} />
        <Button variant="outline" size="icon-sm" aria-label="Schritt nach vorn" disabled={i === 0} onClick={() => b.change((d) => { [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; })}><ArrowUp /></Button>
        <Button variant="outline" size="icon-sm" aria-label="Schritt nach hinten" disabled={i === n - 1} onClick={() => b.change((d) => { [d.steps[i + 1], d.steps[i]] = [d.steps[i], d.steps[i + 1]]; })}><ArrowDown /></Button>
        <Button variant="outline" size="icon-sm" aria-label="Schritt löschen" onClick={() => { onAktiv(b.app.steps[i + 1]?.id ?? b.app.steps[i - 1]?.id ?? null); toast(`„${s.name}“ gelöscht.`, { action: { label: "Rückgängig", onClick: () => b.undo() } }); b.change((d) => {
          const id = d.steps[i].id;
          d.steps.splice(i, 1);
          walk(d.blocks, (x) => {
            if (x.type === "button" && (x.props.aktion === id || x.props.aktion === `ab:${id}`)) x.props.aktion = "alle";
            if (x.type === "output" && x.props.quelle === id) x.props.quelle = "";
          });
        }); }}><Trash /></Button>
      </div>
      <Fld label="Art">
        <ToggleGroup type="single" variant="outline" size="sm" value={s.art} className="justify-start" aria-label="Art des Schritts"
          onValueChange={(v) => { if (!v) return; b.change((d) => { const st = d.steps[i]; st.art = v as Step["art"]; if (st.art === "team" && !st.team) st.team = makeStep(d, "team").team; }); }}>
          <ToggleGroupItem value="prompt" className="rounded-full px-3">Ein Prompt</ToggleGroupItem>
          <ToggleGroupItem value="team" className="rounded-full px-3"><Users size={14} aria-hidden="true" />Agenten-Team</ToggleGroupItem>
        </ToggleGroup>
      </Fld>
      <Tabs value={aktTeil} onValueChange={setTeil} className="ki-teile">
        <TabsList variant="line" aria-label="Bereiche des Schritts">
          <TabsTrigger value="aufgabe">Aufgabe</TabsTrigger>
          {team && <TabsTrigger value="team">Agenten ({team.agenten.length})</TabsTrigger>}
          <TabsTrigger value="fein">Feineinstellungen</TabsTrigger>
          <TabsTrigger value="wissen">Wissen{s.quellen.length ? ` (${s.quellen.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="aufgabe" className="ki-teil">
      <Fld label={team ? "Aufgabe und Ausgangslage" : "Aufgabe für die KI"} htmlFor={`sp-${s.id}`}>
        <Textarea id={`sp-${s.id}`} ref={promptRef} rows={9} className="mono-ta min-h-[220px]" value={s.prompt} placeholder={team ? "Wovon geht das Team aus? Setze Eingaben über die Platzhalter ein." : "Was soll die KI in diesem Schritt tun?"} onChange={(e) => set("prompt", e.target.value, true)} />
      </Fld>
      <VarChips app={b.app} i={i} onInsert={(t) => insertAt(promptRef.current, t, (v) => set("prompt", v))} />
        </TabsContent>
      {team && (
        <TabsContent value="team" className="ki-teil">
        <div className="box neutral">
          <span style={{ fontWeight: 600, fontSize: 13 }}>Agenten-Team</span>
          <p className="hint" style={{ margin: 0 }}>Die Agenten bekommen Ausgangslage und Ziel und finden den Weg selbst. Eine Moderation entscheidet in jeder Runde, wer spricht und wann das Ziel erreicht ist.</p>
          <Fld label="Ziel" htmlFor={`sz-${s.id}`} hint="Woran erkennt das Team, dass es fertig ist? Platzhalter sind erlaubt.">
            <Textarea id={`sz-${s.id}`} ref={zielRef} rows={3} value={team.ziel} onChange={(e) => setTeam((t) => { t.ziel = e.target.value; }, `${s.id}:ziel`)} />
          </Fld>
          <VarChips app={b.app} i={i} onInsert={(t) => insertAt(zielRef.current, t, (v) => setTeam((tt) => { tt.ziel = v; }))} />
          <Sel label="Höchstens Runden" value={String(team.maxRunden)} options={[4, 6, 8, 10, 12, 16, 20].map((r) => [String(r), `${r} Runden`] as [string, string])} onChange={(v) => setTeam((t) => { t.maxRunden = Number(v); })} />
          <span className="lbl" style={{ fontWeight: 600, fontSize: 13 }}>Agenten</span>
          {team.agenten.map((a, ai) => (
            <div className="agent-row" key={a.id}>
              <Input aria-label={`Name von Agent ${ai + 1}`} value={a.name} onChange={(e) => setTeam((t) => { t.agenten[ai].name = e.target.value; }, `${a.id}:name`)} />
              <Textarea aria-label={`Rolle von ${a.name}`} rows={2} value={a.rolle} placeholder="Aufgabe und Haltung dieses Agenten" onChange={(e) => setTeam((t) => { t.agenten[ai].rolle = e.target.value; }, `${a.id}:rolle`)} />
              <Button variant="outline" size="icon-sm" aria-label={`${a.name} entfernen`} disabled={team.agenten.length <= 2} onClick={() => setTeam((t) => { t.agenten.splice(ai, 1); })}><Trash /></Button>
            </div>
          ))}
          <div><Button variant="outline" size="sm" disabled={team.agenten.length >= 6} onClick={() => setTeam((t) => { t.agenten.push({ id: rid("g"), name: `Agent ${t.agenten.length + 1}`, rolle: "" }); })}><Plus />Agent hinzufügen</Button></div>
          <TextFld label="Regeln für die Moderation (optional)" multiline rows={2} value={team.moderation} onChange={(v) => setTeam((t) => { t.moderation = v; }, `${s.id}:mod`)} />
        </div>
        </TabsContent>
      )}
        <TabsContent value="fein" className="ki-teil">
      {!team && <TextFld label="Rolle und Regeln für die KI" multiline rows={2} value={s.rolle} placeholder="z. B. Du bist Assistenz im Vertrieb. Du schreibst sachlich und erfindest keine Preise." onChange={(v) => set("rolle", v, true)} />}
      <div className="three">
        <StepKey b={b} i={i} />
        <Sel label="Modell" value={s.modell} options={Object.entries(MODELL_LABEL) as [Step["modell"], string][]} onChange={(v) => set("modell", v)} />
        <Sel label="Ausgabe" value={s.format} options={Object.entries(FORMAT_LABEL) as [Step["format"], string][]} onChange={(v) => set("format", v)} />
      </div>
      {s.format !== "json" && (
        <Sel label="Ergebnis als fertige Datei" value={s.datei || "keine"} options={DATEI_OPTIONEN}
          onChange={(v) => set("datei", v === "keine" ? "" : (v as Step["datei"]))} />
      )}
      {s.format !== "json" && <p className="hint" style={{ margin: 0 }}>Der Hub erzeugt die Datei selbst aus dem Ergebnis, die KI liefert nur den Inhalt. Unter jedem Ergebnis lässt sich außerdem jede andere Datei-Art herunterladen.</p>}
      <Check label="Alle Eingaben automatisch anhängen" hint="Ohne Platzhalter: Jedes Feld kommt mit Bezeichnung unten an die Aufgabe." checked={s.autoAll} onChange={(v) => set("autoAll", v)} />
      <Check label="Websuche erlauben" hint="Wirkt nur mit Copilot." checked={s.web} onChange={(v) => set("web", v)} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="lbl" style={{ fontWeight: 600, fontSize: 13 }}>Nur ausführen, wenn</span>
        <select aria-label="Feld der Bedingung" className="h-9 rounded-[4px] border border-input bg-background px-2 text-sm" value={s.bedingung?.feld ?? ""}
          onChange={(e) => b.change((d) => { const st = d.steps[i]; st.bedingung = e.target.value ? { feld: e.target.value, op: st.bedingung?.op ?? "gleich", wert: st.bedingung?.wert ?? "" } : null; })}>
          <option value="">immer ausführen</option>
          {fieldsOf(b.app).map((x) => <option key={x.id} value={x.props.key}>{x.props.label}</option>)}
        </select>
        {s.bedingung && <>
          <select aria-label="Vergleich" className="h-9 rounded-[4px] border border-input bg-background px-2 text-sm" value={s.bedingung.op} onChange={(e) => b.change((d) => { d.steps[i].bedingung!.op = e.target.value as typeof BED_OP[number][0]; })}>
            {BED_OP.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          {!["gefuellt", "leer"].includes(s.bedingung.op) && <Input aria-label="Wert der Bedingung" className="w-40" value={s.bedingung.wert} onChange={(e) => b.change((d) => { d.steps[i].bedingung!.wert = e.target.value; }, `${s.id}:bed`)} />}
        </>}
      </div>
        </TabsContent>
        <TabsContent value="wissen" className="ki-teil">
          <TextFld label="Hintergrundwissen als Text" multiline rows={4} value={s.wissen} placeholder="Feste Informationen, die die KI immer kennen soll, z. B. Richtlinien, Produktdaten, Textbausteine." onChange={(v) => set("wissen", v, true)} />
          {s.quellen.map((q, qi) => (
            <div className="qrow" key={qi}>
              <select aria-label="Art der Quelle" className="h-9 rounded-[4px] border border-input bg-background px-2 text-sm" value={q.typ} onChange={(e) => b.change((d) => { d.steps[i].quellen[qi].typ = e.target.value as typeof q.typ; })}>
                {Object.entries(QUELL_TYP).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
              <Input aria-label="Bezeichnung der Quelle" placeholder="z. B. QM-Handbuch" value={q.titel} onChange={(e) => b.change((d) => { d.steps[i].quellen[qi].titel = e.target.value; }, `${s.id}:q${qi}t`)} />
              <Input aria-label="Adresse der Quelle" placeholder="https://firma.sharepoint.com/sites/QM/Freigegebene Dokumente" value={q.url} onChange={(e) => b.change((d) => { d.steps[i].quellen[qi].url = e.target.value; }, `${s.id}:q${qi}u`)} />
              <Button variant="outline" size="icon-sm" aria-label="Quelle entfernen" onClick={() => b.change((d) => { d.steps[i].quellen.splice(qi, 1); })}><Trash /></Button>
            </div>
          ))}
          <div><Button variant="outline" size="sm" onClick={() => b.change((d) => { d.steps[i].quellen.push({ typ: "sharepoint", titel: "", url: "" }); })}><Plus />Wissensquelle</Button></div>
          <p className="hint" style={{ margin: 0 }}>SharePoint-Bereiche, Dateien oder Webseiten, in denen die KI nachschlagen soll. Die zentrale KI-Anbindung durchsucht sie über Microsoft Graph bzw. übergibt sie als Datei.</p>
        </TabsContent>
      </Tabs>
      <div className="ki-fuss">
        <span className="hint">{[...fl, ...prev].length ? <>Bekommt: <b style={{ color: "var(--ink)", fontWeight: 600 }}>{[...fl, ...prev].join(", ")}</b></> : "Bekommt noch keine Eingaben."}</span>
        <span className="hint" style={!anzeigen ? { color: "var(--tool-text)" } : undefined}>{anzeigen ? `Wird in ${anzeigen} Ergebnis-Element${anzeigen > 1 ? "en" : ""} angezeigt.` : "Kein Ergebnis-Element auf der Oberfläche. Das Ergebnis erscheint als Kachel in der Ergebnisübersicht."}</span>
      </div>
    </section>
  );
}

export function KiTab({ b }: { b: Builder }) {
  const app = b.app;
  const [aktivId, setAktivId] = useState<string | null>(app.steps[0]?.id ?? null);
  const [ansicht, setAnsicht] = useState<"neutral" | "graph">("neutral");
  const [seite, setSeite] = useState<"vorschau" | "pruefung" | "anbindung">("vorschau");
  /** Auf schmalen Bildschirmen: Schritte oder Vorschau und Prüfung. */
  const [bereich, setBereich] = useState<"schritt" | "info">("schritt");
  const ai = Math.max(0, app.steps.findIndex((s) => s.id === aktivId));
  const step = app.steps[ai];
  const ctx: Record<string, string> = {};
  fieldsOf(app).forEach((x) => { ctx[x.props.key.toLowerCase()] = x.props.beispiel || `‹${x.props.label}›`; });
  app.steps.forEach((s) => { ctx[s.key.toLowerCase()] = `‹Ergebnis von ${s.name}›`; });
  const req = step ? buildRequest(app, step, ctx) : null;
  const w = appWarnings(app);
  const harte = w.filter((x) => !x.weich);
  const add = (art: "prompt" | "team") => {
    const neu = makeStep(app, art);
    b.change((d) => { d.steps.push(structuredClone(neu)); });
    setAktivId(neu.id);
    setBereich("schritt");
  };
  const offenJe = (s: Step) => harte.some((x) => x.text.includes(`„${s.name}“`));

  return (
    <div className="ki" data-bereich={bereich}>
      <div className="ki-bereiche" role="group" aria-label="Bereich anzeigen">
        <button type="button" aria-pressed={bereich === "schritt"} onClick={() => setBereich("schritt")}>Schritte</button>
        <button type="button" aria-pressed={bereich === "info"} onClick={() => setBereich("info")}>Vorschau und Prüfung{harte.length ? ` (${harte.length})` : ""}</button>
      </div>
      <nav className="panel ki-rail" aria-label="KI-Schritte">
        <h2>KI-Ablauf</h2>
        <p className="hint" style={{ margin: 0 }}>Die Schritte laufen nacheinander. Jeder ist eine Anfrage an die zentrale KI-Anbindung.</p>
        <ol className="ki-steps">
          <li className="ki-io">{fieldsOf(app).length} {fieldsOf(app).length === 1 ? "Eingabe" : "Eingaben"}</li>
          {app.steps.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-current={i === ai ? "step" : undefined} onClick={() => { setAktivId(s.id); setBereich("schritt"); }}>
                <span className="s-no" aria-hidden="true">{i + 1}</span>
                <span className="s-name">{s.name}</span>
                {s.art === "team" && <Users size={13} aria-label="Agenten-Team" />}
                {offenJe(s) && <i className="ki-offen" aria-label="hat offene Punkte" />}
              </button>
            </li>
          ))}
          <li className="ki-io">Ergebnis</li>
        </ol>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => add("prompt")}><Plus />KI-Schritt</Button>
          <Button variant="outline" size="sm" onClick={() => add("team")}><Users />Agenten-Team</Button>
        </div>
      </nav>
      <div className="ki-mitte">
        {step ? <StepCard key={step.id} b={b} i={ai} onAktiv={setAktivId} />
          : <section className="panel ki-karte"><p className="hint" style={{ margin: 0 }}>Noch kein KI-Schritt. Leg links einen Schritt oder ein Agenten-Team an.</p></section>}
      </div>
      <div className="panel ki-side">
        <Tabs value={seite} onValueChange={(v) => setSeite(v as typeof seite)} className="ki-teile">
          <TabsList variant="line" aria-label="Zusatzinformationen">
            <TabsTrigger value="vorschau">Anfrage</TabsTrigger>
            <TabsTrigger value="pruefung">Prüfung{w.length ? ` (${w.length})` : ""}</TabsTrigger>
            <TabsTrigger value="anbindung">Anbindung</TabsTrigger>
          </TabsList>
          <TabsContent value="vorschau" className="ki-teil">
            {step && <p className="hint" style={{ margin: 0 }}>Für Schritt {ai + 1}: <b style={{ color: "var(--ink)" }}>{step.name}</b></p>}
            <ToggleGroup type="single" variant="outline" size="sm" value={ansicht} onValueChange={(v) => v && setAnsicht(v as typeof ansicht)} className="justify-start" aria-label="Darstellung der Anfrage">
              <ToggleGroupItem value="neutral" className="rounded-full px-3">Neutral</ToggleGroupItem>
              <ToggleGroupItem value="graph" className="rounded-full px-3">Copilot (Microsoft Graph)</ToggleGroupItem>
            </ToggleGroup>
            <p className="hint" style={{ margin: 0 }}>{ansicht === "graph" ? "So sendet die zentrale KI-Anbindung diese Anfrage an Copilot." : "Das übergibt die Applikation an die zentrale KI-Anbindung. Eingaben sind mit den Beispielwerten gefüllt."}{step?.art === "team" ? " Beim Agenten-Team ist das die Grundlage; Moderation und Agenten bekommen zusätzlich Ziel, Rollen und Verlauf." : ""}</p>
            <pre className="code ki-code">{req && step ? (ansicht === "graph" ? graphPreview(step, req) : JSON.stringify(req, null, 2)) : "Noch kein KI-Schritt angelegt."}</pre>
          </TabsContent>
          <TabsContent value="pruefung" className="ki-teil">
            {w.length ? <ul className="warns">{w.map((x, i) => <li key={i} className={x.weich ? "soft" : ""}>{x.text}</li>)}</ul> : <p className="hint" style={{ margin: 0, color: "var(--brand)" }}>Alles verbunden. Bereit zum Speichern.</p>}
          </TabsContent>
          <TabsContent value="anbindung" className="ki-teil">
            <p style={{ margin: 0 }}>Alle Applikationen nutzen die zentrale Anbindung des KI-Hubs. In der Applikation ist dafür nichts einzustellen.</p>
            <dl className="kv">
              <dt>Ziel</dt><dd>{KI_ZENTRAL.ziel}</dd>
              <dt>Anmeldung</dt><dd>{KI_ZENTRAL.anmeldung}</dd>
              <dt>Zustand</dt><dd>{kiModus() === "copilot" ? "verbunden" : kiModus() === "claude-test" ? "Testmodus: Claude antwortet statt Copilot" : kiModus() === "claude-api" ? "Testmodus: Claude über eigenen API-Schlüssel" : "nicht konfiguriert, Simulation"}</dd>
            </dl>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
