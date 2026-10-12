import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { Input } from "@/components/ui/input";
import { useApps } from "@/state/apps";
import { ArrowRight } from "lucide-react";
import { areaList, fieldsOf, initials } from "@/lib/model";
import type { HubApp } from "@/lib/schema";
import { Blatt, Pager, blaetterTaste } from "@/components/layout/Pager";
import { useRaster } from "@/components/layout/useRaster";

/** Kürzel je App, bei Gleichstand eindeutig gemacht (z. B. AN und AG). */
export function kuerzel(apps: HubApp[]): Map<string, string> {
  const out = new Map<string, string>(), vergeben = new Set<string>();
  for (const a of apps) {
    let k = initials(a.name);
    if (vergeben.has(k)) {
      const buchst = a.name.replace(/[^A-Za-zÄÖÜäöüß]/g, "").toUpperCase();
      for (let i = 1; i < buchst.length && vergeben.has(k); i++) k = buchst[0] + buchst[i];
    }
    vergeben.add(k);
    out.set(a.id ?? a.name, k);
  }
  return out;
}

const STATUS_TILE: Record<HubApp["status"], string> = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Bereit" };

export function Tile({ a, mono }: { a: HubApp; mono: string }) {
  const nf = fieldsOf(a).length;
  const team = a.steps.some((s) => s.art === "team");
  const status = a._src === "vorlage" ? "freigegeben" : a.status;
  return (
    <Link to={`/app/${a.id}`} viewTransition className="tile">
      <span className="tile-kopf">
        <span className="mono" aria-hidden="true">{mono}</span>
        <span>
          <span className="tile-name">{a.name}</span>
          <span className="eyebrow">{a.bereich}{team ? " · Agenten-Team" : ""}</span>
        </span>
      </span>
      <span className="tile-desc">{a.beschreibung || "Noch keine Beschreibung."}</span>
      <span className="tile-foot">
        {/* Vorlagen sind immer bereit; ein Status erscheint nur, wenn er etwas aussagt */}
        {a._src === "vorlage" ? <span /> : <span className="status" data-s={status}>{status === "freigegeben" ? "Eigene" : STATUS_TILE[status]}</span>}
        <span className="tile-go">{nf === 0 ? "Ohne Eingaben" : `${nf} ${nf === 1 ? "Feld" : "Felder"} zum Ausfüllen`}<ArrowRight size={16} aria-hidden="true" /></span>
      </span>
    </Link>
  );
}
export function HubPage() {
  const { apps, geladen, fehler } = useApps();
  // Filter und Suche stehen in der Adresse: teilbar, Zurück-Taste funktioniert.
  const [sp, setSp] = useSearchParams();
  const bereich = sp.get("bereich") ?? "Alle";
  const q = sp.get("q") ?? "";
  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== "Alle") n.set(k, v); else n.delete(k); return n; }, { replace: k === "q" });
  const setBereich = (v: string) => setParam("bereich", v);
  const setQ = (v: string) => setParam("q", v);
  const bereiche = useMemo(() => areaList(apps), [apps]);
  const aktiv = bereich !== "Alle" && !bereiche.includes(bereich) ? "Alle" : bereich;
  const query = q.trim().toLowerCase();
  const monos = useMemo(() => kuerzel(apps), [apps]);
  const suche = useRef<HTMLInputElement>(null);
  const feld = useRef<HTMLDivElement>(null);
  const { spalten, zeilen, hoehe, abstand } = useRaster(feld, { breite: 300, hoehe: 196, maxHoehe: 236, hoeheSchmal: 112, abstand: 20, abstandSchmal: 10 });
  // Seite steht in der Adresse: Nach dem Öffnen einer App führt „Zurück“ wieder hierher
  const seite = Math.max(0, Number(sp.get("seite") ?? 1) - 1) || 0;
  const setSeite = (i: number | ((alt: number) => number)) => {
    const n = typeof i === "function" ? i(seite) : i;
    setSp((p) => { const x = new URLSearchParams(p); if (n > 0) x.set("seite", String(n + 1)); else x.delete("seite"); return x; }, { replace: true });
  };

  const liste = apps.filter((a) => (aktiv === "Alle" || a.bereich === aktiv) && (!query || [a.name, a.beschreibung, a.bereich].join(" ").toLowerCase().includes(query)));
  const proSeite = spalten * zeilen;
  const eintraege: (HubApp | "neu")[] = [...liste, "neu"];
  const seiten = Math.max(1, Math.ceil(eintraege.length / proSeite));
  const akt = Math.min(seite, seiten - 1);
  const sichtbar = eintraege.slice(akt * proSeite, (akt + 1) * proSeite);

  // Neuer Filter oder neue Suche: wieder vorn anfangen (nicht beim ersten Laden, sonst ginge die gemerkte Seite verloren).
  const ersterFilter = useRef(true);
  useEffect(() => { if (ersterFilter.current) { ersterFilter.current = false; return; } setSeite(0); }, [aktiv, query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) {
        e.preventDefault();
        suche.current?.focus();
        return;
      }
      blaetterTaste(e, akt, seiten, setSeite);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [akt, seiten]); // eslint-disable-line react-hooks/exhaustive-deps

  const eigene = apps.filter((a) => a._src !== "vorlage").length;
  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">KI-Hub · Applikationen</p>
          <h1>Welche Aufgabe soll die KI für dich erledigen?</h1>
          <p className="lede">Der gemeinsame Einstieg für alle Bereiche. Eine Kachel wählen und direkt arbeiten, oder dir von der KI eine eigene Applikation bauen lassen.</p>
        </div>
        <dl className="zahlen">
          <div><dt>Applikationen</dt><dd>{geladen ? apps.length : "–"}</dd></div>
          <div><dt>Bereiche</dt><dd>{geladen ? bereiche.length : "–"}</dd></div>
          <div className="blau"><dt>Eigene</dt><dd>{geladen ? eigene : "–"}</dd></div>
        </dl>
      </section>
      {fehler && <p role="alert" className="hint" style={{ color: "var(--danger)" }}>{fehler}</p>}
      <section className="hub-liste" aria-labelledby="liste-titel">
        <h2 id="liste-titel" className="sr-only">{aktiv === "Alle" ? "Alle Applikationen" : aktiv}</h2>
        <div className="filter">
          <div className="pills" role="group" aria-label="Bereiche">
            {[["Alle", apps.length] as const, ...bereiche.map((b) => [b, apps.filter((x) => x.bereich === b).length] as const)].map(([name, n]) => (
              <button key={name} type="button" className="pill" aria-pressed={aktiv === name} onClick={() => setBereich(name)}>
                {name === "Alle" ? "Alle Bereiche" : name}<small>{n}</small>
              </button>
            ))}
          </div>
          <label className="dir-wahl">
            <span className="sr-only">Bereich</span>
            <select value={aktiv} onChange={(e) => setBereich(e.target.value)}>
              <option value="Alle">Alle Bereiche ({apps.length})</option>
              {bereiche.map((b) => <option key={b} value={b}>{b} ({apps.filter((x) => x.bereich === b).length})</option>)}
            </select>
          </label>
          <div className="search">
            <span className="hint" aria-live="polite">{!geladen ? "" : query ? `${liste.length} Treffer für „${q.trim()}“` : `${liste.length} ${liste.length === 1 ? "Applikation" : "Applikationen"}`}</span>
            <label>
              <span className="sr-only">Applikationen durchsuchen</span>
              <Input ref={suche} type="search" aria-keyshortcuts="/" value={q} onChange={(e) => setQ(e.target.value)} name="q" placeholder="Suchen, z. B. Protokoll …" autoComplete="off" />
            </label>
            <kbd className="kbd nur-breit" aria-hidden="true" title="Taste / springt in die Suche">/</kbd>
          </div>
        </div>
        {!geladen && <p className="empty">Applikationen werden geladen\u00a0…</p>}
        {geladen && !liste.length && (
          <p className="empty">Keine Applikation passt zu „{q.trim() || aktiv}“.{" "}
            <button type="button" className="link-back" onClick={() => setSp(new URLSearchParams())}>Suche und Filter zurücksetzen</button>
            {" "}oder <Link to="/neu" viewTransition className="link-back">lass dir eine passende bauen</Link>.
          </p>
        )}
        <div className="tiles-feld" ref={feld}>
          <Blatt id={`${aktiv}|${query}|${akt}|${proSeite}`} className="tiles-blatt">
            <div className="tiles-raster" style={{ gridTemplateColumns: `repeat(${spalten}, minmax(0, 1fr))`, gridAutoRows: `${hoehe}px`, gap: abstand }}>
              {geladen && sichtbar.map((a) => a === "neu" ? (
                <div key="neu">
                  <Link to="/neu" viewTransition className="tile tile-new">
                    <span className="plus" aria-hidden="true">+</span>
                    <span className="tile-name">Neue Applikation</span>
                    <span className="tile-desc">Beschreib, was du brauchst. Die KI baut einen Entwurf, den du testen und anpassen kannst.</span>
                  </Link>
                </div>
              ) : (
                <div key={a.id}><Tile a={a} mono={monos.get(a.id ?? a.name) ?? initials(a.name)} /></div>
              ))}
            </div>
          </Blatt>
        </div>
        <Pager seite={akt} anzahl={seiten} onWechsel={setSeite} label="Seite" />
      </section>
    </>
  );
}
