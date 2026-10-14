import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRechte } from "@/state/rechte";
import { RECHTE, RECHT_LABEL, istFesterAdmin, lokalerRechteStore, rechteStore, type Nutzer, type Recht } from "@/lib/rechte";
import { browserOrdner, browserOrdnerSetzen, ordnerPruefen, speicherKonfig, type SpeicherKonfig } from "@/lib/speicher";
import { appStore, lokalerAppStore } from "@/lib/store";
import { useApps } from "@/state/apps";

/** Verwaltung: angemeldete Personen und ihre Rechte im Portal (nur für die Verwaltung sichtbar). */
export function VerwaltungPage() {
  const r = useRechte();
  const [nutzer, setNutzer] = useState<Nutzer[]>(r.personen);
  const [neu, setNeu] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => { document.title = "Verwaltung – KI-Hub"; }, []);
  useEffect(() => { setNutzer(r.personen); }, [r.personen]);

  if (!r.geladen) return <p className="hint">Wird geladen …</p>;
  if (!r.istAdmin) return <KeineRechte was="die Verwaltung" />;

  const geaendert = JSON.stringify(nutzer) !== JSON.stringify(r.personen);
  const umschalten = (i: number, recht: Recht) => setNutzer((v) => v.map((n, k) => (k !== i ? n : { ...n, rechte: n.rechte.includes(recht) ? n.rechte.filter((x) => x !== recht) : [...n.rechte, recht] })));
  const hinzufuegen = () => {
    const email = neu.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Bitte eine E-Mail-Adresse eintragen."); return; }
    if (nutzer.some((n) => n.email.toLowerCase() === email)) { toast.error("Diese Person steht schon in der Liste."); return; }
    setNutzer((v) => [...v, { id: "", name: "", email, zuletzt: "", rechte: [] }]);
    setNeu("");
  };
  const entfernen = (i: number) => setNutzer((v) => v.filter((_, k) => k !== i));
  const speichern = async () => {
    setLaeuft(true);
    try { await r.speichern({ nutzer }); toast.success("Rechte gespeichert."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); }
    finally { setLaeuft(false); }
  };
  const datum = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "noch nie");

  return (
    <>
      <section className="hero hero-meldung rv-hero">
        <div className="hero-text">
          <p className="eyebrow">KI-Hub · Verwaltung</p>
          <h1>Personen und Rechte</h1>
          <p className="lede">Wer sich einmal anmeldet, erscheint hier. Hier legst du fest, wer Applikationen bauen, den KI-Assistenten nutzen und freigeben darf. Rechte an einzelnen Applikationen stehen im Baukasten unter „Freigabe“.</p>
        </div>
      </section>
      <div className="rv">
      <div className="rv-tabelle" role="region" aria-label="Personen und Rechte">
        <table>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Zuletzt angemeldet</th>
              {RECHTE.map((x) => <th key={x} scope="col" title={RECHT_LABEL[x][1]}>{RECHT_LABEL[x][0]}</th>)}
              <th scope="col"><span className="sr-only">Entfernen</span></th>
            </tr>
          </thead>
          <tbody>
            {nutzer.length === 0 && <tr><td colSpan={RECHTE.length + 3} className="hint">Noch keine Person angemeldet. Trag unten eine E-Mail-Adresse ein, um Rechte schon vorher zu vergeben.</td></tr>}
            {nutzer.map((n, i) => {
              const fest = istFesterAdmin(n.email);
              const ichSelbst = !!r.ich && n.email.toLowerCase() === r.ich.email.toLowerCase();
              return (
                <tr key={n.id || n.email}>
                  <td>
                    <span className="rv-name">{n.name || n.email}{ichSelbst ? " (du)" : ""}</span>
                    {n.name && <span className="hint">{n.email}</span>}
                    {fest && <span className="hint">Feste Verwaltung (in der Konfiguration eingetragen)</span>}
                  </td>
                  <td className="hint">{datum(n.zuletzt)}</td>
                  {RECHTE.map((x) => (
                    <td key={x}>
                      <input type="checkbox" aria-label={`${RECHT_LABEL[x][0]} für ${n.name || n.email}`} checked={fest || n.rechte.includes(x) || (x !== "admin" && n.rechte.includes("admin"))}
                        disabled={fest || (x !== "admin" && n.rechte.includes("admin"))} onChange={() => umschalten(i, x)} />
                    </td>
                  ))}
                  <td>{!fest && !n.zuletzt && <button type="button" className="rv-x" aria-label={`${n.email} entfernen`} onClick={() => entfernen(i)}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rv-fuss">
        <form className="rv-neu" onSubmit={(e) => { e.preventDefault(); hinzufuegen(); }}>
          <Input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="vorname.nachname@koerber.com" aria-label="E-Mail-Adresse einer Person" />
          <Button type="submit" variant="outline" className="rounded-full">Person vormerken</Button>
        </form>
        <span className="flex-1" />
        <span className="hint">Gespeichert in: {r.speicherName}</span>
        <Button className="rounded-full" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{laeuft ? "Speichert …" : "Rechte speichern"}</Button>
      </div>
      <SpeicherBereich />
      </div>
    </>
  );
}

/** Hinweisseite ohne Berechtigung */
export function KeineRechte({ was }: { was: string }) {
  return (
    <section className="hero hero-meldung">
        <div className="hero-text">
          <p className="eyebrow">Keine Berechtigung</p>
          <h1>Dafür fehlt dir das Recht.</h1>
          <p className="lede">Für {was} brauchst du eine Berechtigung von der Verwaltung des KI-Hubs. Wende dich an die Pilotleitung.</p>
          <p className="hero-links"><Link className="link-back" to="/" viewTransition>Zur Übersicht</Link></p>
        </div>
    </section>
  );
}

/** Gemeinsamer Speicher: SharePoint-Ordner prüfen, im eigenen Browser verwenden, Daten aus dem Browser übernehmen */
function SpeicherBereich() {
  const r = useRechte();
  const apps = useApps();
  const [k, setK] = useState<SpeicherKonfig | null>(null);
  const [ordner, setOrdner] = useState(browserOrdner());
  const [pruefung, setPruefung] = useState<{ lesen: boolean; schreiben: boolean; meldung: string } | null>(null);
  const [laeuft, setLaeuft] = useState("");
  const [lokal, setLokal] = useState({ apps: 0, personen: 0 });
  const aktualisieren = async () => {
    setK(await speicherKonfig());
    setLokal({ apps: (await lokalerAppStore.list()).length, personen: (await lokalerRechteStore.laden()).nutzer.length });
  };
  useEffect(() => { void aktualisieren(); }, []);
  const neuLaden = async () => { await Promise.all([apps.reload(), r.neuLaden()]); await aktualisieren(); };

  const pruefen = async () => {
    setLaeuft("pruefen"); setPruefung(null);
    try { setPruefung(await ordnerPruefen(ordner)); } finally { setLaeuft(""); }
  };
  const verwenden = async (o: string | null) => {
    browserOrdnerSetzen(o); setPruefung(null);
    await neuLaden();
    toast.success(o ? "Dieser Browser nutzt jetzt den SharePoint-Ordner." : "Dieser Browser speichert wieder lokal.");
  };
  const uebernehmen = async () => {
    setLaeuft("uebernehmen");
    try {
      const liste = await lokalerAppStore.list();
      for (const a of liste) await appStore.save(a);
      // Rechte zusammenführen: Rechte aus beiden Ständen vereinigen
      const lok = await lokalerRechteStore.laden();
      const sp = await rechteStore.laden();
      const nutzer = [...sp.nutzer];
      for (const n of lok.nutzer) {
        const i = nutzer.findIndex((x) => x.email.toLowerCase() === n.email.toLowerCase());
        if (i < 0) nutzer.push(n); else nutzer[i] = { ...nutzer[i], rechte: [...new Set([...nutzer[i].rechte, ...n.rechte])] };
      }
      await rechteStore.speichern({ nutzer });
      await neuLaden();
      toast.success(`${liste.length} Applikation${liste.length === 1 ? "" : "en"} und ${lok.nutzer.length} Rechte-Einträge übernommen.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Übernehmen fehlgeschlagen."); }
    finally { setLaeuft(""); }
  };

  const sp = k?.art === "sharepoint" ? k : null;
  return (
    <section className="rv-speicher" aria-labelledby="speicher-titel">
      <h2 id="speicher-titel">Gemeinsamer Speicher</h2>
      <p className="hint" style={{ margin: 0 }}>
        {!k ? "Wird geprüft …" : !sp ? "Applikationen und Rechte liegen nur in diesem Browser. Damit alle dasselbe sehen, braucht der Hub einen SharePoint-Ordner."
          : sp.quelle === "browser" ? <>Dieser Browser nutzt zum Testen den SharePoint-Ordner <b>{sp.ordner}</b>. Für alle gilt er erst, wenn er in der Konfiguration des Hubs (hub-config.json) steht.</>
          : <>Alle nutzen den SharePoint-Ordner <b>{sp.ordner}</b>.</>}
      </p>
      <div className="rv-speicher-zeile">
        <Input value={ordner} onChange={(e) => { setOrdner(e.target.value); setPruefung(null); }} placeholder="https://koerbergroup.sharepoint.com/sites/…/Freigegebene Dokumente/KI-Hub" aria-label="Adresse des SharePoint-Ordners" />
        <Button variant="outline" className="rounded-full" disabled={!ordner.trim() || !!laeuft} onClick={() => void pruefen()}>{laeuft === "pruefen" ? "Prüft …" : "Verbindung prüfen"}</Button>
        <Button className="rounded-full" disabled={!pruefung?.schreiben || !!laeuft} onClick={() => void verwenden(ordner)}>In diesem Browser verwenden</Button>
        {sp?.quelle === "browser" && <Button variant="ghost" className="rounded-full" onClick={() => void verwenden(null)}>Zurück auf diesen Browser</Button>}
      </div>
      {pruefung && <p className="hint" role="status" style={{ margin: 0, color: pruefung.schreiben ? "var(--ok)" : "var(--danger)" }}>{pruefung.lesen ? "Lesen ✓" : "Lesen ✗"} · {pruefung.schreiben ? "Schreiben ✓" : "Schreiben ✗"} · {pruefung.meldung}</p>}
      {sp && (lokal.apps > 0 || lokal.personen > 0) && (
        <div className="rv-speicher-zeile">
          <span className="hint">In diesem Browser liegen noch {lokal.apps} Applikation{lokal.apps === 1 ? "" : "en"} und {lokal.personen} Rechte-Einträge.</span>
          <Button variant="outline" className="rounded-full" disabled={!!laeuft} onClick={() => void uebernehmen()}>{laeuft === "uebernehmen" ? "Übernimmt …" : "In den SharePoint-Ordner übernehmen"}</Button>
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>Im Ordner legt der Hub „apps/“, „rechte.json“ und „anmeldungen/“ an. Rechte in SharePoint: alle lesen; Schreiben in „apps/“ nur, wer bauen darf; „rechte.json“ nur die Verwaltung; in „anmeldungen/“ alle. Der Hub braucht dafür zusätzlich die Berechtigung Sites.ReadWrite.All mit Administratorzustimmung.</p>
    </section>
  );
}
