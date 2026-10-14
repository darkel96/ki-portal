import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRechte } from "@/state/rechte";
import { RECHTE, RECHT_LABEL, istFesterAdmin, type Nutzer, type Recht } from "@/lib/rechte";

/** Verwaltung: angemeldete Personen und ihre Rechte im Portal (nur für die Verwaltung sichtbar). */
export function VerwaltungPage() {
  const r = useRechte();
  const [nutzer, setNutzer] = useState<Nutzer[]>(r.stand.nutzer);
  const [neu, setNeu] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => { document.title = "Verwaltung – KI-Hub"; }, []);
  useEffect(() => { setNutzer(r.stand.nutzer); }, [r.stand]);

  if (!r.geladen) return <main className="wrap page"><p className="hint">Wird geladen …</p></main>;
  if (!r.istAdmin) return <KeineRechte was="die Verwaltung" />;

  const geaendert = JSON.stringify(nutzer) !== JSON.stringify(r.stand.nutzer);
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
    <main className="wrap page rv">
      <section className="hero hero-meldung rv-hero">
        <div className="hero-text">
          <p className="eyebrow">KI-Hub · Verwaltung</p>
          <h1>Personen und Rechte</h1>
          <p className="lede">Wer sich einmal anmeldet, erscheint hier. Hier legst du fest, wer Applikationen bauen, den KI-Assistenten nutzen und freigeben darf. Rechte an einzelnen Applikationen stehen im Baukasten unter „Freigabe“.</p>
        </div>
      </section>
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
        <span className="hint">Gespeichert in: {r.speicherName}{r.speicherName === "Dieser Browser" ? " (für alle gemeinsam braucht es den SharePoint-Speicher)" : ""}</span>
        <Button className="rounded-full" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{laeuft ? "Speichert …" : "Rechte speichern"}</Button>
      </div>
    </main>
  );
}

/** Hinweisseite ohne Berechtigung */
export function KeineRechte({ was }: { was: string }) {
  return (
    <main className="wrap page">
      <section className="hero hero-meldung">
        <div className="hero-text">
          <p className="eyebrow">Keine Berechtigung</p>
          <h1>Dafür fehlt dir das Recht.</h1>
          <p className="lede">Für {was} brauchst du eine Berechtigung von der Verwaltung des KI-Hubs. Wende dich an die Pilotleitung.</p>
          <p className="hero-links"><Link className="link-back" to="/" viewTransition>Zur Übersicht</Link></p>
        </div>
      </section>
    </main>
  );
}
