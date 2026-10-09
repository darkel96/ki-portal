import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { App } from "@/lib/schema";
import { renderResult, markdown } from "@/lib/markdown";
import { STATUS_LABEL, type OutState } from "@/lib/runner";
import { graphPreview } from "@/lib/request";
import { paketName, treeText, zipPaket } from "@/lib/paket";
import { saveFile } from "@/lib/files";
import { DATEI_ART, DATEI_ARTEN, dateiErzeugen, dateiName, type DateiArt } from "@/lib/dokument";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { initials, slug } from "@/lib/model";
import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";

const EASE_OUT = [0.2, 0, 0, 1] as const;
const AV = ["var(--a0)", "var(--a2)", "var(--a1)", "var(--a6)", "var(--a4)", "var(--a5)"];
const AVI = ["var(--a0i)", "var(--a2i)", "var(--a1i)", "var(--a6i)", "var(--a4i)", "var(--a5i)"];

/** Ergebnis als fertige Datei herunterladen: die eingestellte bzw. gewünschte Datei als Hauptknopf, alle anderen im Menü. */
function DateiKnoepfe({ app, text, titel, haupt, roh }: { app: App; text: string; titel: string; haupt: DateiArt | null; roh: { name: string; endung: string } }) {
  const [baut, setBaut] = useState<DateiArt | null>(null);
  const laden = async (art: DateiArt) => {
    setBaut(art);
    try {
      const blob = await dateiErzeugen(art, text, { titel, app: app.name, akzent: app.theme.accent });
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
        <Button size="sm" className="rounded-full" disabled={!!baut} onClick={() => void laden(haupt)}>
          <Download aria-hidden="true" />{baut === haupt ? `${DATEI_ART[haupt].label} wird erstellt …` : `${DATEI_ART[haupt].label} herunterladen`}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="rounded-full" disabled={!!baut}>
            {baut && baut !== haupt ? `${DATEI_ART[baut].label} wird erstellt …` : haupt ? "Andere Datei" : "Als Datei herunterladen"}<ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Fertige Datei</DropdownMenuLabel>
          {DATEI_ARTEN.map((a) => <DropdownMenuItem key={a} onSelect={() => void laden(a)}>{DATEI_ART[a].label} (.{DATEI_ART[a].endung})</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void saveFile(`${roh.name}.${roh.endung}`, text)}>Original (.{roh.endung})</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
            <span>Runde {e.runde}: Moderation gibt das Wort an <b>{e.naechster}</b>. {e.begruendung}</span>
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

export function OutputView({ app, titel, stepId, stil, mode }: { app: App; titel: string; stepId: string; stil: "card" | "plain"; mode: Mode }) {
  const run = useRun();
  const step = app.steps.find((s) => s.id === stepId);
  const o = run?.outs[stepId];
  let body: React.ReactNode;
  if (mode === "edit") body = <p className="o-muted">{step ? `Zeigt das Ergebnis von „${step.name}“.` : "Noch kein KI-Schritt gewählt."}</p>;
  else if (!o) body = <p className="o-muted">Das Ergebnis erscheint hier.</p>;
  else if (o.status === "laeuft" && step?.art !== "team") body = <p className="o-muted">KI arbeitet …</p>;
  else if (o.status === "simuliert") body = <><p className="o-muted" style={{ color: "var(--tool-text)" }}>Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p>{o.req && <pre className="code o-sim">{o.req.nachricht}</pre>}<p className="o-muted">Den vollständigen Aufbau zeigen die technischen Details.</p></>;
  else if (o.status === "uebersprungen") body = <p className="o-muted">{o.meldung}</p>;
  else body = (
    <>
      {step?.art === "team" && <TeamLogView o={o} app={app} stepId={stepId} />}
      {step?.art === "team" && o.status === "laeuft" && <p className="o-muted">Das Team arbeitet …</p>}
      {o.text && (o.paket ? (
        <div className={step?.art === "team" ? "team-result" : undefined}>
          {o.paket.hinweis && <p>{o.paket.hinweis}</p>}
          <p className="o-muted">{o.paket.dateien.length} Dateien im Paket</p>
          <pre className="code">{treeText(o.paket.dateien.map((f) => f.pfad))}</pre>
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
      ) : step?.format !== "dateien" && (
        <div className={`o-body ${step?.art === "team" ? "team-result" : ""}`} dangerouslySetInnerHTML={{ __html: renderResult(o.text, step?.format ?? "markdown") }} />
      ))}
      {o.status === "fehler" && o.meldung && <p className="o-err" role="alert">{o.meldung}</p>}
      {o.status === "gestoppt" && <p className="o-muted">Gestoppt.</p>}
    </>
  );

  const fertig = o && (o.status === "fertig" || o.status === "fehler" || o.status === "gestoppt") && o.text;
  // Besteht ein Paket im Kern aus einem Dokument (HTML, Markdown, Text), gibt es das direkt als PDF, Word usw.
  const dokumente = o?.paket?.dateien.filter((f) => istDokument(f.pfad)) ?? [];
  const einDokument = dokumente.length === 1 ? dokumente[0] : null;
  return (
    <div className={`o-out ${stil === "card" ? "card" : ""}`} data-src={stepId} data-status={o?.status}>
      <div className="o-out-head">
        <span className="o-out-t">{titel}</span>
        {o && <span className="status-pill" data-s={o.status}>{STATUS_LABEL[o.status]}</span>}
      </div>
      <motion.div key={o?.status === "laeuft" ? "laeuft" : o?.status ?? "leer"} className="o-body"
        initial={o ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }} aria-live="polite">
        {body}
      </motion.div>
      {mode === "run" && o && (fertig || o.req) && (
        <div className="o-foot">
          {fertig && <Button size="sm" variant="outline" className="rounded-full" onClick={() => { void navigator.clipboard?.writeText(o.text ?? "").then(() => toast.success("In die Zwischenablage kopiert.")); }}>Kopieren</Button>}
          {fertig && o.paket && einDokument && <DateiKnoepfe app={app} text={einDokument.inhalt} titel={dateiTitel(einDokument.pfad)} haupt={o.req?.ergebnisDatei ?? "pdf"} roh={{ name: dateiTitel(einDokument.pfad), endung: einDokument.pfad.split(".").pop() ?? "txt" }} />}
          {fertig && o.paket && <Button size="sm" variant={einDokument ? "outline" : "default"} className="rounded-full" onClick={async () => saveFile(paketName(app.name, o.paket!), await zipPaket(o.paket!, app.name, o.req?.ergebnisDatei ?? undefined))}>{o.req?.ergebnisDatei ? `ZIP herunterladen (Dokumente als ${DATEI_ART[o.req.ergebnisDatei].label})` : "ZIP herunterladen"}</Button>}
          {fertig && !o.paket && step && <DateiKnoepfe app={app} text={o.text ?? ""} titel={step.name} haupt={o.req?.ergebnisDatei ?? null} roh={{ name: slug(step.name), endung: step.format === "json" ? "json" : step.format === "text" ? "txt" : "md" }} />}
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
