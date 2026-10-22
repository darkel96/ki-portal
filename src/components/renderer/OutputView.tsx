import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { App } from "@/lib/schema";
import { renderResult, markdown } from "@/lib/markdown";
import { STATUS_LABEL, type OutState } from "@/lib/runner";
import { graphPreview } from "@/lib/request";
import { paketName, paketPfade, treeText, zipPaket } from "@/lib/paket";
import { saveFile } from "@/lib/files";
import { DATEI_ART, DATEI_ARTEN, dateiErzeugen, dateiName, type DateiArt } from "@/lib/dokument";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Check, ChevronDown, Copy, Download, RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { initials, slug, stepsFor, walk } from "@/lib/model";
import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";
import { alsText, teilAus } from "@/lib/vorbelegung";
import { diagrammeZeichnen } from "@/lib/diagramm";
import { msProjectXml, vorgaengeAus } from "@/lib/msproject";

/** Ein Teil eines JSON-Ergebnisses: Text als Markdown, Listen als Aufzählung oder Tabelle, Objekte als Tabelle „Schlüssel | Wert“. */
function JsonTeil({ wert }: { wert: unknown }) {
  if (wert == null || wert === "") return <p className="o-muted">Dieser Teil fehlt im Ergebnis.</p>;
  if (typeof wert !== "object") return <div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(String(wert)) }} />;
  if (Array.isArray(wert)) {
    const objekte = wert.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (objekte.length && objekte.length === wert.length) {
      const spalten = [...new Set(objekte.flatMap((o) => Object.keys(o)))];
      return (
        <div className="o-body"><table><thead><tr>{spalten.map((k) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>{objekte.map((o, i) => <tr key={i}>{spalten.map((k) => <td key={k}>{alsText(o[k])}</td>)}</tr>)}</tbody></table></div>
      );
    }
    return <div className="o-body"><ul>{wert.map((x, i) => <li key={i}>{alsText(x)}</li>)}</ul></div>;
  }
  const eintraege = Object.entries(wert as Record<string, unknown>);
  return (
    <div className="o-body"><table><tbody>{eintraege.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{alsText(v)}</td></tr>)}</tbody></table></div>
  );
}

const EASE_OUT = [0.2, 0, 0, 1] as const;
const AV = ["var(--a0)", "var(--a2)", "var(--a1)", "var(--a6)", "var(--a4)", "var(--a5)"];
const AVI = ["var(--a0i)", "var(--a2i)", "var(--a1i)", "var(--a6i)", "var(--a4i)", "var(--a5i)"];

/** Ergebnis als fertige Datei herunterladen: die eingestellte bzw. gewünschte Datei als Hauptknopf, alle anderen im Menü. */
export function DateiKnoepfe({ app, text, titel, haupt, roh, vorlage, kompakt }: { app: App; text: string; titel: string; haupt: DateiArt | null; roh: { name: string; endung: string }; vorlage?: string; /** Sammelleiste: kurze Beschriftung, Ergebnisname für Screenreader */ kompakt?: string }) {
  const [baut, setBaut] = useState<DateiArt | null>(null);
  // Hat das Ergebnis eine Vorgangstabelle, bietet das Menü zusätzlich eine Datei für MS Project an
  const vorgaenge = vorgaengeAus(text).length;
  const laden = async (art: DateiArt) => {
    setBaut(art);
    try {
      const blob = await dateiErzeugen(art, text, { titel, app: app.name, akzent: app.theme.accent, vorlage });
      await saveFile(dateiName(`${app.name} ${titel}`, art), blob, DATEI_ART[art].mime);
    } catch (e) {
      toast.error(`${DATEI_ART[art].label}-Datei konnte nicht erstellt werden.${e instanceof Error ? " " + e.message : ""}`);
    } finally {
      setBaut(null);
    }
  };
  return (
    <>
      {haupt && (
        <Button size="sm" className="rounded-full" disabled={!!baut} onClick={() => void laden(haupt)} aria-label={kompakt && baut !== haupt ? `${kompakt}: ${DATEI_ART[haupt].label} herunterladen` : undefined}>
          <Download aria-hidden="true" />{baut === haupt ? `${DATEI_ART[haupt].label} wird erstellt\u00a0…` : kompakt ? DATEI_ART[haupt].label : `${DATEI_ART[haupt].label} herunterladen`}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="rounded-full" disabled={!!baut} aria-label={kompakt && !(baut && baut !== haupt) ? `${kompakt}: ${haupt ? "anderes Format" : "als Datei herunterladen"}` : undefined}>
            {baut && baut !== haupt ? `${DATEI_ART[baut].label} wird erstellt\u00a0…` : kompakt ? (haupt ? "" : "Herunterladen") : haupt ? "Anderes Format" : "Als Datei herunterladen"}<ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Fertige Datei</DropdownMenuLabel>
          {DATEI_ARTEN.map((a) => <DropdownMenuItem key={a} onSelect={() => void laden(a)}>{DATEI_ART[a].label} (.{DATEI_ART[a].endung})</DropdownMenuItem>)}
          {vorgaenge > 0 && <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Terminplan ({vorgaenge} Vorgänge)</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void saveFile(dateiName(`${app.name} ${titel}`, "xlsx").replace(/\.xlsx$/, ".xml"), msProjectXml(vorgaengeAus(text), { titel: `${app.name} – ${titel}` }), "application/xml")}>MS Project (.xml)</DropdownMenuItem>
          </>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void saveFile(`${roh.name}.${roh.endung}`, text)}>Original (.{roh.endung})</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Kopiert formatiert (für Outlook/Word) und als reinen Text; die Schaltfläche bestätigt kurz selbst. */
function KopierKnopf({ text, format, teil }: { text: string; format: string; teil: boolean }) {
  const [ok, setOk] = useState(false);
  const kopieren = async () => {
    try {
      const html = renderResult(text, format as never);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch {
      toast.error("Kopieren nicht möglich. Markier den Text und kopier ihn mit Strg+C.");
    }
  };
  return (
    <Button size="sm" variant="outline" className="rounded-full" onClick={() => void kopieren()}>
      {ok ? <><Check aria-hidden="true" />Kopiert</> : <><Copy aria-hidden="true" />{teil ? "Teilergebnis kopieren" : "Kopieren"}</>}
    </Button>
  );
}

/** ZIP mit Ladezustand und Fehlermeldung */
function ZipKnopf({ onLaden, text, haupt, label }: { onLaden: (onStand: (t: string) => void) => Promise<void>; text: string; haupt: boolean; label?: string }) {
  const [baut, setBaut] = useState<string | null>(null);
  return (
    <Button size="sm" variant={haupt ? "default" : "outline"} className="rounded-full" disabled={!!baut} aria-label={baut ? undefined : label} onClick={async () => {
      setBaut("ZIP wird erstellt\u00a0…");
      try { await onLaden(setBaut); } catch (e) { toast.error(`Das ZIP konnte nicht erstellt werden.${e instanceof Error ? " " + e.message : ""}`); } finally { setBaut(null); }
    }}><Download aria-hidden="true" />{baut ?? text}</Button>
  );
}

const istDokument = (pfad: string) => /\.(html?|md|markdown|txt)$/i.test(pfad);
const dateiTitel = (pfad: string) => (pfad.split("/").pop() ?? pfad).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

function TeamLogView({ o, app, stepId }: { o: OutState; app: App; stepId: string }) {
  const step = app.steps.find((s) => s.id === stepId);
  const namen = step?.team?.agenten.map((a) => a.name) ?? [];
  if (!o.team?.length) return null;
  return (
    <ol className="team-log" aria-label="Verlauf des Agenten-Teams">
      <AnimatePresence initial={false}>
        {o.team.map((e, i) => e.art === "moderation" ? (
          <motion.li key={i} className="team-mod" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.15, ease: EASE_OUT } }}>
            <span>Runde {e.runde}: Moderation gibt das Wort an <b>{e.naechster}</b>{e.auftrag ? <>: „{e.auftrag}“</> : "."} {e.begruendung}</span>
          </motion.li>
        ) : (
          <motion.li key={i} className="team-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}>
            {(() => { const n = Math.max(0, namen.indexOf(e.beitrag.agent)) % AV.length; return <span className="team-av" style={{ "--av": AV[n], "--avi": AVI[n] } as React.CSSProperties} aria-hidden="true">{initials(e.beitrag.agent)}</span>; })()}
            <div>
              <div className="who">{e.beitrag.agent}</div>
              <div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(e.beitrag.text) }} />
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** Liegen mehrere Ergebnisse auf einer Seite, stehen ihre Downloads gesammelt in einer Leiste unten (siehe DownloadLeiste) */
export const SammelDownloads = createContext(false);

/** Ergebnis-Text (bzw. JSON-Teil) und Paket eines Schritts, aus denen die Downloads entstehen */
function downloadStand(app: App, stepId: string, o: OutState | undefined, pfad: string) {
  const step = app.steps.find((s) => s.id === stepId);
  const teil = step?.format === "json" && pfad.trim() && o?.text && o.status !== "laeuft" ? teilAus(o.text, pfad.trim()) : undefined;
  const teilText = typeof teil === "string" ? teil : teil !== undefined ? alsText(teil) : null;
  const fertig = !!o && (o.status === "fertig" || o.status === "fehler" || o.status === "gestoppt") && !!o.text;
  // Besteht ein Paket im Kern aus einem Dokument (HTML, Markdown, Text), gibt es das direkt als PDF, Word usw.
  const dokumente = o?.paket?.dateien.filter((f) => istDokument(f.pfad)) ?? [];
  return { step, teil, teilText, fertig, einDokument: dokumente.length === 1 ? dokumente[0] : null };
}

/** Download-Knöpfe eines Ergebnisses: Datei (Hauptformat plus Menü) oder ZIP */
function Downloads({ app, stepId, o, pfad, kompakt }: { app: App; stepId: string; o: OutState; pfad: string; kompakt?: string }) {
  const { step, teilText, fertig, einDokument } = downloadStand(app, stepId, o, pfad);
  if (!fertig) return null;
  return (
    <>
      {o.paket && einDokument && <DateiKnoepfe app={app} kompakt={kompakt} vorlage={step?.vorlage?.docx || undefined} text={einDokument.inhalt} titel={dateiTitel(einDokument.pfad)} haupt={o.req?.ergebnisDatei ?? "pdf"} roh={{ name: dateiTitel(einDokument.pfad), endung: einDokument.pfad.split(".").pop() ?? "txt" }} />}
      {o.paket && <ZipKnopf haupt={!einDokument} text={kompakt ? "ZIP" : o.req?.ergebnisDatei ? `ZIP mit ${DATEI_ART[o.req.ergebnisDatei].label}-Dateien` : "ZIP herunterladen"} label={kompakt ? `${kompakt}: ZIP herunterladen` : undefined}
        onLaden={async (onStand) => saveFile(paketName(app.name, o.paket!), await zipPaket(o.paket!, app.name, o.req?.ergebnisDatei ?? undefined, onStand, step?.vorlage?.docx || undefined))} />}
      {!o.paket && step && <DateiKnoepfe app={app} kompakt={kompakt} vorlage={step.vorlage?.docx || undefined} text={teilText ?? o.text ?? ""} titel={step.name} haupt={o.req?.ergebnisDatei ?? null} roh={{ name: slug(step.name), endung: teilText !== null ? "md" : step.format === "json" ? "json" : step.format === "text" ? "txt" : "md" }} />}
    </>
  );
}

/** Feste Leiste unten mit den Downloads aller fertigen Ergebnisse einer Seite, nebeneinander */
export function DownloadLeiste({ app, ausgaben }: { app: App; ausgaben: { stepId: string; titel: string; pfad: string }[] }) {
  const run = useRun();
  const fertige = ausgaben.filter((a) => downloadStand(app, a.stepId, run?.outs[a.stepId], a.pfad).fertig);
  if (!fertige.length) return null;
  return (
    <div className="o-downloads" role="region" aria-label="Downloads">
      <span className="o-downloads-t">Downloads</span>
      {fertige.map((a) => (
        <div key={`${a.stepId}:${a.pfad}`} className="o-downloads-g" role="group" aria-label={a.titel}>
          <span className="o-downloads-n">{a.titel}</span>
          <Downloads app={app} stepId={a.stepId} o={run!.outs[a.stepId]!} pfad={a.pfad} kompakt={a.titel} />
        </div>
      ))}
    </div>
  );
}

export function OutputView({ app, titel, stepId, stil, mode, pfad = "" }: { app: App; titel: string; stepId: string; stil: "card" | "plain"; mode: Mode; /** bei JSON: nur dieser Teil */ pfad?: string }) {
  const run = useRun();
  const step = app.steps.find((s) => s.id === stepId);
  const o = run?.outs[stepId];
  const team = step?.art === "team";
  // Teil eines JSON-Ergebnisses (Prüfseite: z. B. der lesbare Bericht neben den vorbelegten Feldern)
  const { teil, teilText, fertig, einDokument } = downloadStand(app, stepId, o, pfad);
  const gesammelt = useContext(SammelDownloads);
  // Diagramme (Mermaid, SVG, draw.io) im fertigen Ergebnis zeichnen und zum Herunterladen anbieten
  const inhalt = useRef<HTMLDivElement>(null);
  useEffect(() => { if (o?.status !== "laeuft") void diagrammeZeichnen(inhalt.current, titel); }, [o?.status, o?.text, titel, teilText]);
  // Agenten-Team: Das fertige Ergebnis ins Bild holen, es steht über dem (dann eingeklappten) Verlauf
  const ergebnisRef = useRef<HTMLDivElement>(null);
  const warLaeuft = useRef(false);
  useEffect(() => {
    if (!team) return;
    if (o?.status === "laeuft") warLaeuft.current = true;
    else if (warLaeuft.current && o?.text) { warLaeuft.current = false; ergebnisRef.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  }, [team, o?.status, o?.text]);
  let body: React.ReactNode;
  if (mode === "edit") body = <p className="o-muted">{step ? `Zeigt das Ergebnis von „${step.name}“.` : "Noch kein KI-Schritt gewählt."}</p>;
  else if (!o) {
    let knopf = "";
    walk(app.blocks, (b) => { if (!knopf && b.type === "button" && step && stepsFor(app, b.props.aktion).includes(step)) knopf = b.props.text; });
    body = <p className="o-muted">{knopf ? `Das Ergebnis erscheint hier, sobald du „${knopf}“ startest.` : "Das Ergebnis erscheint hier."}</p>;
  }
  else if (o.status === "wartet") body = <p className="o-muted">{run?.laeuft ? "Wartet, bis die vorherigen Schritte fertig sind\u00a0…" : "Noch nicht erstellt."}</p>;
  else if (o.status === "laeuft" && !team && !o.text) body = <p className="o-muted">KI arbeitet\u00a0…</p>;
  else if (o.status === "simuliert") body = <><p className="o-muted" style={{ color: "var(--tool-text)" }}>Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p>{o.req && <pre className="code o-sim">{o.req.nachricht}</pre>}<p className="o-muted">Den vollständigen Aufbau zeigen die technischen Details.</p></>;
  else if (o.status === "uebersprungen") body = <p className="o-muted">{o.meldung}</p>;
  else body = (
    <>
      {team && o.text && <div ref={ergebnisRef} className="team-erg-kopf"><h3 className="o-h o-h3">Ergebnis</h3>{o.status === "fertig" && o.meldung && <p className="o-muted">{o.meldung}</p>}</div>}
      {o.text && (o.paket ? (
        <div className={team ? "team-result" : undefined}>
          {o.paket.hinweis && <p>{o.paket.hinweis}</p>}
          <p className="o-muted">{[`${o.paket.dateien.length} ${o.paket.dateien.length === 1 ? "Datei" : "Dateien"}`, o.paket.kopien.length ? `${o.paket.kopien.length} ${o.paket.kopien.length === 1 ? "Vorlage" : "Vorlagen"} aus SharePoint` : "", o.paket.ordner.length ? `${o.paket.ordner.length} Ordner` : ""].filter(Boolean).join(", ")} im Paket</p>
          <pre className="code">{treeText(paketPfade(o.paket))}</pre>
          {o.paket.kopien.length > 0 && (
            <details className="paket-file"><summary>Kopierte Vorlagen ({o.paket.kopien.length})</summary>
              <ul>{o.paket.kopien.map((k) => <li key={k.ziel}>{k.ziel} ← {k.quelle}</li>)}</ul>
              {!o.paket.vorlagenUrl && <p className="o-err">Ohne Copilot-Anmeldung können die Vorlagen nicht geladen werden; das ZIP enthält dann eine Hinweisdatei.</p>}
            </details>
          )}
          {o.paket.dateien.map((f) => (
            <details key={f.pfad} className="paket-file"><summary>{f.pfad}</summary>
              {istDokument(f.pfad) && o.status === "fertig" && o.paket!.dateien.length > 1 && (
                <div className="o-foot" style={{ marginBottom: 8 }}>
                  <DateiKnoepfe app={app} text={f.inhalt} titel={dateiTitel(f.pfad)} haupt={null} roh={{ name: dateiTitel(f.pfad), endung: f.pfad.split(".").pop() ?? "txt" }} />
                </div>
              )}
              {/\.md$/i.test(f.pfad) ? <div className="o-body" dangerouslySetInnerHTML={{ __html: markdown(f.inhalt) }} /> : <pre className="code">{f.inhalt}</pre>}
            </details>
          ))}
        </div>
      ) : teil !== undefined ? <JsonTeil wert={teil} /> : step?.format !== "dateien" && (
        <div className={`o-body ${team ? "team-result" : ""}`} dangerouslySetInnerHTML={{ __html: renderResult(o.text, step?.format ?? "markdown") }} />
      ))}
      {o.status === "laeuft" && !team && <p className="o-muted">KI schreibt\u00a0…</p>}
      {o.status === "fehler" && o.meldung && <p className="o-err" role="alert">{o.meldung}</p>}
      {o.status === "gestoppt" && <p className="o-muted">Gestoppt.</p>}
      {team && o.status === "laeuft" && <p className="o-muted">Das Team arbeitet\u00a0…</p>}
      {team && !!o.team?.length && (() => { const n = o.team.filter((e) => e.art === "beitrag").length; return (
        <details className="team-verlauf" open={o.status === "laeuft"}>
          <summary>Verlauf ({n} {n === 1 ? "Beitrag" : "Beiträge"})</summary>
          <TeamLogView o={o} app={app} stepId={stepId} />
        </details>
      ); })()}
    </>
  );

  return (
    <div className={`o-out ${stil === "card" ? "card" : ""}`} data-src={stepId} data-status={o?.status}>
      <div className="o-out-head">
        <span className="o-out-t">{titel}</span>
        {o && <span className="status-pill" data-s={o.status}>{STATUS_LABEL[o.status]}</span>}
        {/* Nur der Status wird angesagt, nicht jedes Stück des entstehenden Texts */}
        <span className="sr-only" aria-live="polite">{o && mode === "run" ? `${titel}: ${STATUS_LABEL[o.status]}` : ""}</span>
      </div>
      <motion.div key={o ? "da" : "leer"} ref={inhalt} className="o-body"
        initial={o ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }} aria-busy={o?.status === "laeuft"}>
        {body}
      </motion.div>
      {mode === "run" && o && (fertig || o.req) && (
        <div className="o-foot" data-gesammelt={gesammelt ? "" : undefined}>
          {(o.status === "fehler" || o.status === "gestoppt") && step && (
            <Button size="sm" className="rounded-full" disabled={!!run?.laeuft} onClick={() => run?.starten(`wiederholen:${stepId}`, stepId)}><RotateCcw aria-hidden="true" />Erneut versuchen</Button>
          )}
          {fertig && (!o.paket || einDokument) && <KopierKnopf text={einDokument ? einDokument.inhalt : teilText ?? o.text ?? ""} format={einDokument || teilText !== null ? "markdown" : step?.format ?? "markdown"} teil={o.status !== "fertig"} />}
          {!gesammelt && <Downloads app={app} stepId={stepId} o={o} pfad={pfad} />}
          {o.req && step && Array.isArray(o.req.dateien) && (
            <details>
              <summary>Technische Details</summary>
              <p className="o-muted" style={{ margin: "8px 0 4px" }}>Anfrage an die zentrale KI-Anbindung</p>
              <pre className="code">{JSON.stringify(o.req, null, 2)}</pre>
              <p className="o-muted" style={{ margin: "12px 0 4px" }}>So geht sie über Microsoft Graph an Copilot</p>
              <pre className="code">{graphPreview(step, o.req)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
