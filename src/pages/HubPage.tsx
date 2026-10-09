import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Input } from "@/components/ui/input";
import { useApps } from "@/state/apps";
import { areaIdx, areaList, fieldsOf, inkFor, initials } from "@/lib/model";
import type { HubApp } from "@/lib/schema";
import { Blatt, Pager, blaetterTaste } from "@/components/layout/Pager";
import { useRaster } from "@/components/layout/useRaster";

const STATUS: Record<HubApp["status"], string> = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Freigegeben" };

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

export function Tile({ a, mono }: { a: HubApp; mono: string }) {
  const ci = areaIdx(a.bereich);
  const ac = a.theme.accent || `var(--a${ci})`;
  const aci = a.theme.accent ? inkFor(a.theme.accent) ?? "#fff" : `var(--a${ci}i)`;
  const nf = fieldsOf(a).length;
  const team = a.steps.some((s) => s.art === "team");
  const tag = a._src === "vorlage" ? null
    : a.status !== "freigegeben" ? <span className="tag draft">{STATUS[a.status]}</span>
    : <span className="tag own">Eigene</span>;
  return (
    <Link to={`/app/${a.id}`} viewTransition className="tile" style={{ "--ac": ac, "--aci": aci } as React.CSSProperties}>
      <span className="tile-top">
        <span className="mono" aria-hidden="true">{mono}</span>
        <span className="area" style={{ "--ac": `var(--a${ci})` } as React.CSSProperties}><i aria-hidden="true" />{a.bereich}</span>
      </span>
      <span className="tile-name">{a.name}</span>
      <span className="tile-desc">{a.beschreibung || "Noch keine Beschreibung."}</span>
      <span className="tile-foot">
        <span className="meta">{nf === 0 ? "Ohne Eingaben" : `${nf} ${nf === 1 ? "Feld" : "Felder"} zum Ausfüllen`}{team ? ", mit Agenten-Team" : ""}</span>
        {tag}
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
  const { spalten, zeilen, hoehe } = useRaster(feld);
  const [seite, setSeite] = useState(0);

  const liste = apps.filter((a) => (aktiv === "Alle" || a.bereich === aktiv) && (!query || [a.name, a.beschreibung, a.bereich].join(" ").toLowerCase().includes(query)));
  const proSeite = spalten * zeilen;
  const eintraege: (HubApp | "neu")[] = [...liste, "neu"];
  const seiten = Math.max(1, Math.ceil(eintraege.length / proSeite));
  const akt = Math.min(seite, seiten - 1);
  const sichtbar = eintraege.slice(akt * proSeite, (akt + 1) * proSeite);

  // Neuer Filter oder neue Suche: wieder vorn anfangen.
  useEffect(() => setSeite(0), [aktiv, query]);
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
  }, [akt, seiten]);

  return (
    <>
      <section className="intro">
        <h1>Welche Aufgabe soll die KI für dich erledigen?</h1>
        <div className="search">
          <p className="lede">Wähl eine Applikation aus oder lass dir von der KI eine eigene bauen.</p>
          <label>
            <span className="sr-only">Applikationen durchsuchen</span>
            <Input ref={suche} type="search" aria-keyshortcuts="/" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen, z. B. Protokoll  ( / )" autoComplete="off" />
          </label>
        </div>
      </section>
      {fehler && <p role="alert" className="hint" style={{ color: "var(--danger)" }}>{fehler}</p>}
      <div className="hub">
        <nav className="dir" aria-label="Bereiche">
          <span className="rubrik">Bereiche</span>
          {[["Alle", apps.length, "var(--ink)"] as const, ...bereiche.map((b) => [b, apps.filter((x) => x.bereich === b).length, `var(--a${areaIdx(b)})`] as const)].map(([name, n, ac]) => (
            <button key={name} type="button" className="dir-row" aria-pressed={aktiv === name} onClick={() => setBereich(name)} style={{ "--ac": ac } as React.CSSProperties}>
              <i aria-hidden="true" /><span>{name === "Alle" ? "Alle Bereiche" : name}</span><small>{n}</small>
            </button>
          ))}
        </nav>
        <section className="hub-liste" aria-labelledby="liste-titel">
          <div className="grid-head">
            <h2 id="liste-titel">{aktiv === "Alle" ? "Alle Applikationen" : aktiv}</h2>
            <label className="dir-wahl">
              <span className="sr-only">Bereich</span>
              <select value={aktiv} onChange={(e) => setBereich(e.target.value)}>
                <option value="Alle">Alle Bereiche ({apps.length})</option>
                {bereiche.map((b) => <option key={b} value={b}>{b} ({apps.filter((x) => x.bereich === b).length})</option>)}
              </select>
            </label>
            <span className="hint" aria-live="polite">{query ? `${liste.length} Treffer für „${q.trim()}“` : `${liste.length} ${liste.length === 1 ? "Applikation" : "Applikationen"}`}</span>
          </div>
          {!geladen && <p className="empty">Applikationen werden geladen …</p>}
          {geladen && !liste.length && <p className="empty">Keine Applikation passt zu „{q.trim() || aktiv}“. Lass dir eine passende bauen.</p>}
          <div className="tiles-feld" ref={feld}>
            <Blatt id={`${aktiv}|${query}|${akt}|${proSeite}`} className="tiles-blatt">
              <div className="tiles-raster" style={{ gridTemplateColumns: `repeat(${spalten}, minmax(0, 1fr))`, gridAutoRows: `${hoehe}px` }}>
                {sichtbar.map((a) => a === "neu" ? (
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
      </div>
    </>
  );
}
