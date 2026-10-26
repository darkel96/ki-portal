import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { Input } from "@/components/ui/input";
import { useApps } from "@/state/apps";
import { appsNurImBrowser } from "@/lib/store";
import { toast } from "sonner";
import { useRechte } from "@/state/rechte";
import { ArrowRight, Plus } from "lucide-react";
import { areaList, fieldsOf, initials } from "@/lib/model";
import type { App, HubApp } from "@/lib/schema";
import { Blatt, Pager, blaetterTaste } from "@/components/layout/Pager";
import { useRaster } from "@/components/layout/useRaster";
import { useGleiten } from "@/components/layout/useGleiten";

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

const STATUS_TILE: Record<HubApp["status"], string> = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Bereit", gesperrt: "Gesperrt" };
/** Die Eintrittsanimation läuft nur beim ersten Besuch der Startseite, nicht nach jedem Zurückkommen. */
let schonAnimiert = false;
const SCHMAL = "(max-width: 560px)";
const schmalAbo = (cb: () => void) => { const m = matchMedia(SCHMAL); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** Handy-Breite? Reagiert auf Drehen des Geräts. */
const useSchmal = () => useSyncExternalStore(schmalAbo, () => matchMedia(SCHMAL).matches, () => false);

export function Tile({ a, mono }: { a: HubApp; mono: string }) {
  const nf = fieldsOf(a).length;
  const team = a.steps.some((s) => s.art === "team");
  const status = a._src === "vorlage" ? "freigegeben" : a.status;
  const { pfad } = useApps();
  return (
    <Link to={pfad(a)} viewTransition className="tile">
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
  const { apps: alleApps, geladen, fehler } = useApps();
  const rechte = useRechte();
  // Nur Applikationen, die die angemeldete Person nutzen darf
  const apps = useMemo(() => alleApps.filter((a) => rechte.darfApp(a, "nutzen")), [alleApps, rechte]);
  const darfNeu = rechte.darf("assistent") || rechte.darf("bauen");
  // Filter und Suche stehen in der Adresse: teilbar, Zurück-Taste funktioniert.
  const [sp, setSp] = useSearchParams();
  const bereich = sp.get("bereich") ?? "Alle";
  const q = sp.get("q") ?? "";
  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== "Alle") n.set(k, v); else n.delete(k); return n; }, { replace: k === "q" });
  const setBereich = (v: string) => setParam("bereich", v);
  // Das Suchfeld hält seinen Text selbst; die Adresse folgt mit kurzer Verzögerung (sonst gehen bei schnellem Tippen Zeichen verloren).
  const [eingabe, setEingabe] = useState(q);
  const geschrieben = useRef(q);
  const tippTimer = useRef(0);
  useEffect(() => { if (q !== geschrieben.current) { geschrieben.current = q; setEingabe(q); } }, [q]);
  useEffect(() => () => window.clearTimeout(tippTimer.current), []);
  const tippen = (v: string) => {
    setEingabe(v);
    window.clearTimeout(tippTimer.current);
    tippTimer.current = window.setTimeout(() => { geschrieben.current = v; setParam("q", v); }, 200);
  };
  const bereiche = useMemo(() => areaList(apps), [apps]);
  const aktiv = bereich !== "Alle" && !bereiche.includes(bereich) ? "Alle" : bereich;
  const query = eingabe.trim().toLowerCase();
  const schmal = useSchmal();
  // Unbekannter Bereich oder leeres q: aus der Adresse nehmen
  useEffect(() => {
    if (!geladen) return;
    const leerQ = sp.has("q") && !sp.get("q"), falschB = sp.has("bereich") && aktiv !== bereich;
    if (leerQ || falschB) setSp((p) => { const n = new URLSearchParams(p); if (leerQ) n.delete("q"); if (falschB) n.delete("bereich"); return n; }, { replace: true });
  }, [geladen, sp, aktiv, bereich]); // eslint-disable-line react-hooks/exhaustive-deps
  const monos = useMemo(() => kuerzel(apps), [apps]);
  const suche = useRef<HTMLInputElement>(null);
  const feld = useRef<HTMLDivElement>(null);
  const { spalten, zeilen, hoehe, abstand } = useRaster(feld, { breite: 300, hoehe: 170, maxHoehe: 236, hoeheSchmal: 96, abstand: 20, abstandSchmal: 10 });
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
  // Animationen wie im KSCA-Portal: beim ersten Laden tauchen die Kacheln nacheinander auf, beim Filtern gleiten sie
  const raster = useRef<HTMLDivElement>(null);
  useGleiten(raster, sichtbar.map((a) => (a === "neu" ? "neu" : a.id)).join("|"), aktiv);
  const [erst, setErst] = useState(!schonAnimiert);
  useEffect(() => {
    if (!geladen || schonAnimiert) return;
    const t = setTimeout(() => { schonAnimiert = true; setErst(false); }, 450 + 70 * proSeite);
    return () => clearTimeout(t);
  }, [geladen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Neuer Filter oder neue Suche: wieder vorn anfangen. Nur bei echter Änderung, damit die Seite aus der Adresse erhalten bleibt (auch unter StrictMode).
  const letzterFilter = useRef({ aktiv, query });
  useEffect(() => {
    if (letzterFilter.current.aktiv === aktiv && letzterFilter.current.query === query) return;
    letzterFilter.current = { aktiv, query };
    setSeite(0);
  }, [aktiv, query]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bereichs-Pills: eine Tab-Station, Pfeiltasten wandern (Pos1/Ende an den Rand)
  const pillTaste = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const pills = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = pills.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    const ziel = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % pills.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + pills.length) % pills.length : e.key === "Home" ? 0 : e.key === "End" ? pills.length - 1 : -1;
    if (ziel < 0) return;
    e.preventDefault();
    pills[ziel].focus();
  };
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
        <div className="hero-seite">
          <dl className="zahlen">
            <div><dt>Applikationen</dt><dd>{geladen ? apps.length : "–"}</dd></div>
            <div><dt>Bereiche</dt><dd>{geladen ? bereiche.length : "–"}</dd></div>
            <div className="blau"><dt>Eigene</dt><dd>{geladen ? eigene : "–"}</dd></div>
          </dl>
          {darfNeu && <Link to="/neu" viewTransition className="knopf-neu"><Plus size={16} aria-hidden="true" />Neue Applikation</Link>}
        </div>
      </section>
      {fehler && <p role="alert" className="hint" style={{ color: "var(--danger)" }}>{fehler}</p>}
      <NurImBrowser />
      <section className="hub-liste" aria-labelledby="liste-titel">
        <h2 id="liste-titel" className="sr-only">{aktiv === "Alle" ? "Alle Applikationen" : aktiv}</h2>
        <div className="filter">
          <div className="pills" role="group" aria-label="Bereiche" onKeyDown={pillTaste}>
            {[["Alle", apps.length] as const, ...bereiche.map((b) => [b, apps.filter((x) => x.bereich === b).length] as const)].map(([name, n]) => (
              <button key={name} type="button" className="pill" aria-pressed={aktiv === name} tabIndex={aktiv === name ? 0 : -1} onClick={() => setBereich(name)}>
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
            <span className="hint" aria-live="polite">{!geladen ? "" : query ? `${liste.length} Treffer für „${eingabe.trim()}“` : `${liste.length} ${liste.length === 1 ? "Applikation" : "Applikationen"}`}</span>
            <label>
              <span className="sr-only">Applikationen durchsuchen</span>
              <Input ref={suche} type="search" aria-keyshortcuts="/" value={eingabe} onChange={(e) => tippen(e.target.value)} name="q" placeholder={schmal ? "Suchen …" : "Suchen, z. B. Protokoll …"} autoComplete="off" />
            </label>
            <kbd className="kbd nur-breit" aria-hidden="true" title="Taste / springt in die Suche">/</kbd>
          </div>
        </div>
        {!geladen && <p className="empty">{"Applikationen werden geladen\u00a0…"}</p>}
        {geladen && !liste.length && (
          <p className="empty">Keine Applikation passt zu „{eingabe.trim() || aktiv}“.{" "}
            <button type="button" className="link-back" onClick={() => { window.clearTimeout(tippTimer.current); geschrieben.current = ""; setEingabe(""); setSp(new URLSearchParams()); suche.current?.focus(); }}>Suche und Filter zurücksetzen</button>
            {" "}oder <Link to="/neu" viewTransition className="link-back">lass dir eine passende bauen</Link>.
          </p>
        )}
        <div className="tiles-feld" ref={feld}>
          <Blatt id={`${akt}|${proSeite}`} className="tiles-blatt">
            <div ref={raster} className={`tiles-raster ${erst ? "erst" : ""}`} style={{ gridTemplateColumns: `repeat(${spalten}, minmax(0, 1fr))`, gridAutoRows: `${hoehe}px`, gap: abstand }}>
              {geladen && sichtbar.map((a, i) => a === "neu" ? (
                <div key="neu" data-gleiten="neu" style={{ "--i": i } as React.CSSProperties}>
                  <Link to="/neu" viewTransition className="tile tile-new">
                    <span className="plus" aria-hidden="true">+</span>
                    <span className="tile-name">Neue Applikation</span>
                    <span className="tile-desc">Beschreib, was du brauchst. Die KI baut einen Entwurf, den du testen und anpassen kannst.</span>
                  </Link>
                </div>
              ) : (
                <div key={a.id} data-gleiten={a.id ?? a.name} style={{ "--i": i } as React.CSSProperties}><Tile a={a} mono={monos.get(a.id ?? a.name) ?? initials(a.name)} /></div>
              ))}
            </div>
          </Blatt>
        </div>
        <Pager seite={akt} anzahl={seiten} onWechsel={setSeite} label="Seite" />
      </section>
    </>
  );
}

/**
 * Apps, die noch aus der Zeit ohne Schreibzugang nur in diesem Browser liegen, obwohl der gemeinsame Speicher jetzt
 * beschreibbar ist (Token oder Hub-Dienst): ein Hinweis mit „Für alle speichern“.
 */
function NurImBrowser() {
  const { save, geladen } = useApps();
  const [liste, setListe] = useState<App[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => { if (geladen) void appsNurImBrowser().then(setListe).catch(() => setListe([])); }, [geladen]);
  if (!liste.length) return null;
  const namen = liste.map((a) => `„${a.name}“`);
  const teilen = async () => {
    setLaeuft(true);
    let ok = 0;
    for (const a of liste) {
      try { await save(a); ok++; } catch (e) { toast.error(`„${a.name}“: ${e instanceof Error ? e.message : "Speichern fehlgeschlagen."}`); }
    }
    setLaeuft(false);
    if (ok) toast.success(ok === 1 ? `${namen[0]} ist jetzt für alle gespeichert.` : `${ok} Applikationen sind jetzt für alle gespeichert.`);
    setListe(await appsNurImBrowser().catch(() => []));
  };
  return (
    <p className="hub-nurbrowser" role="status">
      <span>{namen.length === 1 ? `${namen[0]} liegt` : `${namen.slice(0, 3).join(", ")}${namen.length > 3 ? ` und ${namen.length - 3} weitere` : ""} liegen`} nur in diesem Browser, andere sehen sie noch nicht.</span>
      <button type="button" className="pg-btn" disabled={laeuft} onClick={() => void teilen()}>{laeuft ? "Speichert …" : "Für alle speichern"}</button>
    </p>
  );
}
