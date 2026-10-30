import { LaufwerkBereich } from "@/components/verwaltung/LaufwerkBereich";
import { Arbeitet } from "@/components/layout/Arbeitet";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRechte } from "@/state/rechte";
import { RECHTE, RECHT_LABEL, istFesterAdmin, lokalerRechteStore, rechteStore, type Nutzer, type Recht } from "@/lib/rechte";
import { browserGit, browserGitSetzen, browserOrdner, browserOrdnerSetzen, gitPruefen, gitToken, gitTokenSetzen, ordnerPruefen, speicherKonfig, speicherSchreibbar, speichertUeberDienst, type GitKonfig, type SpeicherKonfig } from "@/lib/speicher";
import { agentSpeichern, agentenLaden } from "@/lib/agenten";
import { appStore, lokalerAppStore, PAPIERKORB_TAGE, type Geloescht } from "@/lib/store";
import { useApps } from "@/state/apps";
import { SEED_APPS } from "@/lib/seeds";
import type { HubApp } from "@/lib/schema";

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
    try { await r.speichern({ ...r.stand, nutzer }); toast.success("Rechte gespeichert."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); }
    finally { setLaeuft(false); }
  };
  const datum = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "noch nie");

  return (
    <>
      <section className="hero hero-meldung rv-hero">
        <div className="hero-text">
          <p className="eyebrow">KI-Hub · Verwaltung</p>
          <h1>Verwaltung</h1>
          <p className="lede">Personen und Rechte, Applikationen und der gemeinsame Speicher an einem Ort. Rechte an einzelnen Applikationen stehen im Baukasten unter „Freigabe“.</p>
        </div>
      </section>
      <div className="rv">
      <section className="rv-personen" aria-labelledby="personen-titel">
      <h2 id="personen-titel">Personen und Rechte</h2>
      <p className="hint" style={{ margin: 0 }}>Wer sich einmal am Hub anmeldet, erscheint hier. Jede Person kann alle Applikationen nutzen, außer eine Applikation ist im Baukasten unter „Freigabe“ auf bestimmte Personen beschränkt. Weitere Rechte (Verwaltung, Baukasten, KI-Assistent, Freigeben) setzt du hier.</p>
      <div className="rv-tabelle" role="region" aria-label="Tabelle der Personen">
        <table>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Zuletzt angemeldet</th>
              <th scope="col" title="Alle Applikationen nutzen (außer sie sind unter „Freigabe“ beschränkt)">Nutzen</th>
              {RECHTE.map((x) => <th key={x} scope="col" title={RECHT_LABEL[x][1]}>{RECHT_LABEL[x][0]}</th>)}
              <th scope="col"><span className="sr-only">Entfernen</span></th>
            </tr>
          </thead>
          <tbody>
            {nutzer.length === 0 && <tr><td colSpan={RECHTE.length + 4} className="hint">Noch keine Person angemeldet. Trag unten eine E-Mail-Adresse ein, um Rechte schon vorher zu vergeben.</td></tr>}
            {nutzer.map((n, i) => {
              const fest = istFesterAdmin(n.email);
              const ausKonfig = r.fest[n.email.trim().toLowerCase()] ?? [];
              const ichSelbst = !!r.ich && n.email.toLowerCase() === r.ich.email.toLowerCase();
              return (
                <tr key={n.id || n.email}>
                  <td>
                    <span className="rv-name">{n.name || n.email}{ichSelbst ? " (du)" : ""}</span>
                    {n.name && <span className="hint">{n.email}</span>}
                    {fest && <span className="hint">Feste Verwaltung (in der Konfiguration eingetragen)</span>}
                    {!fest && ausKonfig.length > 0 && <span className="hint">Fest in der Hub-Konfiguration: {ausKonfig.map((x) => RECHT_LABEL[x][0]).join(", ")}</span>}
                  </td>
                  <td className="hint">{datum(n.zuletzt)}</td>
                  <td><input type="checkbox" checked disabled aria-label={`Applikationen nutzen für ${n.name || n.email} (gilt für alle)`} /></td>
                  {RECHTE.map((x) => (
                    <td key={x}>
                      <input type="checkbox" aria-label={`${RECHT_LABEL[x][0]} für ${n.name || n.email}`} checked={fest || ausKonfig.includes(x) || n.rechte.includes(x) || (x !== "admin" && n.rechte.includes("admin"))}
                        disabled={fest || ausKonfig.includes(x) || (x !== "admin" && n.rechte.includes("admin"))} onChange={() => umschalten(i, x)} />
                    </td>
                  ))}
                  <td>{!fest && !ausKonfig.length && !n.zuletzt && <button type="button" className="rv-x" aria-label={`${n.email} entfernen`} onClick={() => entfernen(i)}>×</button>}</td>
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
        <Button className="rounded-full" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{laeuft ? <Arbeitet text="Speichert" /> : "Rechte speichern"}</Button>
      </div>
      </section>
      <AppsBereich />
      <SpeicherBereich />
      <LaufwerkBereich />
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
const STATUS_TEXT: Record<HubApp["status"], string> = { entwurf: "Entwurf", pruefung: "In Prüfung", freigegeben: "Freigegeben", gesperrt: "Gesperrt" };

/** Alle Applikationen an einem Ort: öffnen, bearbeiten, sperren, löschen; mitgelieferte Vorlagen übernehmen, ausblenden und wieder einblenden */
function AppsBereich() {
  const r = useRechte();
  const { apps, save, remove, wiederherstellen, pfad } = useApps();
  const [bestaetigen, setBestaetigen] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState("");
  const [korb, setKorb] = useState<Geloescht[]>([]);
  const korbLaden = () => appStore.papierkorb().then(setKorb, () => setKorb([]));
  useEffect(() => { void korbLaden(); }, []);
  const tun = async (id: string, was: () => Promise<unknown>, meldung: string) => {
    setLaeuft(id);
    try { await was(); toast.success(meldung); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Das hat nicht geklappt."); }
    finally { setLaeuft(""); setBestaetigen(null); }
  };
  const sperren = (a: HubApp, zu: boolean) => tun(a.id!, () => save({ ...a, status: zu ? "gesperrt" : "freigegeben" }), zu ? `„${a.name}“ gesperrt.` : `„${a.name}“ freigegeben.`);
  const loeschen = (a: HubApp) => tun(a.id!, async () => { await remove(a.id!); await korbLaden(); }, `„${a.name}“ in den Papierkorb verschoben.`);
  const zurueck = (g: Geloescht) => tun(g.app.id!, async () => { await wiederherstellen(g.app.id!); await korbLaden(); }, `„${g.app.name}“ wiederhergestellt.`);
  const entsorgen = (g: Geloescht) => tun(g.app.id!, async () => { await appStore.entsorgen(g.app.id!); await korbLaden(); }, `„${g.app.name}“ endgültig gelöscht.`);
  const ausblenden = (a: HubApp) => tun(a.id!, () => r.speichern({ ...r.stand, ausgeblendet: [...new Set([...r.stand.ausgeblendet, a.id!])] }), `„${a.name}“ aus dem Hub genommen.`);
  const einblenden = (id: string, name: string) => tun(id, () => r.speichern({ ...r.stand, ausgeblendet: r.stand.ausgeblendet.filter((x) => x !== id) }), `„${name}“ ist wieder im Hub.`);
  const versteckt = SEED_APPS.filter((a) => r.stand.ausgeblendet.includes(a.id ?? "") && !apps.some((x) => x.id === a.id && x._src === "eigene"));
  const liste = [...apps].sort((a, b) => (a._src === b._src ? a.name.localeCompare(b.name, "de") : a._src === "eigene" ? -1 : 1));
  return (
    <section className="rv-apps" aria-labelledby="apps-titel">
      <h2 id="apps-titel">Applikationen</h2>
      <p className="hint" style={{ margin: 0 }}>Eigene Applikationen lassen sich hier bearbeiten, sperren und löschen. Mitgelieferte Vorlagen übernimmst du unter ihrem Namen (die bearbeitete Fassung ersetzt dann das Original) oder nimmst sie aus dem Hub.</p>
      <div className="rv-tabelle" role="region" aria-label="Tabelle der Applikationen"><table>
        <thead><tr><th>Applikation</th><th>Bereich</th><th>Herkunft</th><th>Status</th><th>Aktionen</th></tr></thead>
        <tbody>
          {liste.map((a) => {
            const eigene = a._src === "eigene", gesperrt = a.status === "gesperrt", id = a.id ?? "";
            return (
              <tr key={id} data-status={a.status}>
                <td><Link to={pfad(a)}>{a.name}</Link></td>
                <td>{a.bereich}</td>
                <td>{eigene ? "Eigene" : "Vorlage"}</td>
                <td><span className="status" data-s={eigene ? a.status : "freigegeben"}>{eigene ? STATUS_TEXT[a.status] : STATUS_TEXT.freigegeben}</span></td>
                <td className="rv-aktionen">
                  <Button asChild variant="outline" size="sm" className="rounded-full"><Link to={`/baukasten/${id}`}>{eigene ? "Bearbeiten" : "Übernehmen und bearbeiten"}</Link></Button>
                  {eigene && <Button variant="outline" size="sm" className="rounded-full" disabled={laeuft === id} onClick={() => void sperren(a, !gesperrt)}>{gesperrt ? "Entsperren" : "Sperren"}</Button>}
                  {bestaetigen === id
                    ? <><Button variant="destructive" size="sm" className="rounded-full" disabled={laeuft === id} onClick={() => void (eigene ? loeschen(a) : ausblenden(a))}>{eigene ? "Wirklich löschen" : "Wirklich aus dem Hub nehmen"}</Button><Button variant="ghost" size="sm" className="rounded-full" onClick={() => setBestaetigen(null)}>Abbrechen</Button></>
                    : <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setBestaetigen(id)}>{eigene ? "Löschen" : "Aus dem Hub nehmen"}</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {korb.length > 0 && (
        <div className="rv-korb" role="region" aria-label="Papierkorb">
          <span className="lbl">Papierkorb</span>
          <p className="hint" style={{ margin: 0 }}>Gelöschte Applikationen bleiben {PAPIERKORB_TAGE} Tage hier und lassen sich wiederherstellen.</p>
          {korb.map((g) => (
            <div key={g.app.id} className="rv-speicher-zeile">
              <span><b>{g.app.name}</b> <span className="hint">gelöscht am {g.geloescht ? new Date(g.geloescht).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "unbekannt"}</span></span>
              <Button variant="outline" size="sm" className="rounded-full" disabled={laeuft === g.app.id} onClick={() => void zurueck(g)}>Wiederherstellen</Button>
              <Button variant="ghost" size="sm" className="rounded-full" disabled={laeuft === g.app.id} onClick={() => void entsorgen(g)}>Endgültig löschen</Button>
            </div>
          ))}
        </div>
      )}
      {versteckt.length > 0 && (
        <div className="rv-speicher-zeile">
          <span className="hint">Aus dem Hub genommene Vorlagen:</span>
          {versteckt.map((a) => <Button key={a.id} variant="outline" size="sm" className="rounded-full" disabled={laeuft === a.id} onClick={() => void einblenden(a.id!, a.name)}>{a.name}: wieder einblenden</Button>)}
        </div>
      )}
    </section>
  );
}

function SpeicherBereich() {
  const r = useRechte();
  const apps = useApps();
  const [k, setK] = useState<SpeicherKonfig | null>(null);
  const [ordner, setOrdner] = useState(browserOrdner());
  const [pruefung, setPruefung] = useState<{ lesen: boolean; schreiben: boolean; meldung: string } | null>(null);
  const [laeuft, setLaeuft] = useState("");
  const [lokal, setLokal] = useState({ apps: 0, personen: 0 });
  const [schreibbar, setSchreibbar] = useState(false);
  const [ueberDienst, setUeberDienst] = useState(false);
  // Git-Speicher (GitHub-Repository)
  const [git, setGit] = useState<GitKonfig>(browserGit() ?? { repo: "", branch: "main", pfad: "public/hub-daten" });
  const [token, setToken] = useState(gitToken());
  const [gitPr, setGitPr] = useState<{ lesen: boolean; schreiben: boolean; meldung: string } | null>(null);
  const aktualisieren = async () => {
    const kk = await speicherKonfig();
    setK(kk);
    if (kk.art === "github" && !browserGit()) setGit({ repo: kk.repo, branch: kk.branch, pfad: kk.pfad });
    setSchreibbar(await speicherSchreibbar());
    setUeberDienst(await speichertUeberDienst());
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
  const gitPruefenJetzt = async () => {
    setLaeuft("gitpruefen"); setGitPr(null);
    try { setGitPr(await gitPruefen(git, token)); } finally { setLaeuft(""); }
  };
  const gitVerwenden = async (an: boolean) => {
    browserGitSetzen(an ? git : null); gitTokenSetzen(an ? token : null); setGitPr(null);
    await neuLaden();
    toast.success(an ? "Dieser Browser nutzt jetzt den Git-Speicher." : "Dieser Browser speichert wieder lokal.");
  };
  const tokenSpeichern = async () => {
    gitTokenSetzen(token || null);
    await neuLaden();
    toast.success(token.trim() ? "GitHub-Token in diesem Browser hinterlegt. Speichern geht jetzt in das Repository." : "GitHub-Token entfernt. Der Git-Speicher ist in diesem Browser nur lesbar.");
  };
  const uebernehmen = async () => {
    setLaeuft("uebernehmen");
    try {
      const liste = await lokalerAppStore.list();
      for (const a of liste) await appStore.save(a);
      // Agenten aus dem Browser mitnehmen
      for (const ag of await agentenLaden(true)) await agentSpeichern(ag);
      // Rechte zusammenführen: Rechte aus beiden Ständen vereinigen
      const lok = await lokalerRechteStore.laden();
      const sp = await rechteStore.laden();
      const nutzer = [...sp.nutzer];
      for (const n of lok.nutzer) {
        const i = nutzer.findIndex((x) => x.email.toLowerCase() === n.email.toLowerCase());
        if (i < 0) nutzer.push(n); else nutzer[i] = { ...nutzer[i], rechte: [...new Set([...nutzer[i].rechte, ...n.rechte])] };
      }
      await rechteStore.speichern({ ...sp, nutzer });
      await neuLaden();
      toast.success(`${liste.length} Applikation${liste.length === 1 ? "" : "en"} und ${lok.nutzer.length} Rechte-Einträge übernommen.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Übernehmen fehlgeschlagen."); }
    finally { setLaeuft(""); }
  };

  const sp = k?.art === "sharepoint" ? k : null;
  const gh = k?.art === "github" ? k : null;
  return (
    <section className="rv-speicher" aria-labelledby="speicher-titel">
      <h2 id="speicher-titel">Gemeinsamer Speicher</h2>
      <p className="hint" style={{ margin: 0 }}>
        {!k ? "Wird geprüft …" : gh ? <>{gh.quelle === "browser" ? "Dieser Browser nutzt" : "Alle nutzen"} den Git-Speicher <b>{gh.repo}</b> (Branch {gh.branch}, Ordner {gh.pfad}). Lesen geht für alle von der veröffentlichten Seite; {ueberDienst ? "gespeichert wird über den Hub-Dienst mit seinem eigenen Token, für alle mit Baukasten-Recht; ein Token im Browser ist nicht nötig." : schreibbar ? "dieser Browser schreibt mit seinem GitHub-Token direkt ins Repository." : "zum Schreiben braucht dieser Browser einen GitHub-Token, bis dahin bleiben eigene Änderungen hier im Browser. Einfacher: dem Hub-Dienst einen Token geben (HUB_GIT_TOKEN, siehe SERVER.md), dann speichern alle ohne eigenen Token."}</>
          : !sp ? "Applikationen und Rechte liegen nur in diesem Browser. Damit alle dasselbe sehen, braucht der Hub einen gemeinsamen Speicher: ein SharePoint-Ordner oder der Git-Speicher (Repository des Hubs)."
          : sp.quelle === "browser" ? <>Dieser Browser nutzt zum Testen den SharePoint-Ordner <b>{sp.ordner}</b>. Für alle gilt er erst, wenn er in der Konfiguration des Hubs (hub-config.json) steht.</>
          : <>Alle nutzen den SharePoint-Ordner <b>{sp.ordner}</b>.</>}
      </p>
      <div className="rv-git" role="group" aria-label="Git-Speicher">
        <span className="lbl">Git-Speicher (GitHub-Repository)</span>
        <p className="hint" style={{ margin: 0 }}>Apps, Agenten, Rechte und Papierkorb liegen als JSON-Dateien im Repository und werden mit der Seite veröffentlicht. Schreiben kann, wer hier einen persönlichen GitHub-Token mit „Contents: Read and write“ für das Repository hinterlegt (bleibt nur in diesem Browser). Jedes Speichern ist ein Commit; andere Geräte sehen den Stand nach der Veröffentlichung, etwa eine Minute später.</p>
        <div className="rv-speicher-zeile">
          <Input value={git.repo} onChange={(e) => { setGit({ ...git, repo: e.target.value }); setGitPr(null); }} placeholder="owner/repository, z. B. darkel96/ki-portal" aria-label="Repository" />
          <Input value={git.branch} onChange={(e) => { setGit({ ...git, branch: e.target.value }); setGitPr(null); }} placeholder="main" aria-label="Branch" className="w-32" />
          <Input value={git.pfad} onChange={(e) => { setGit({ ...git, pfad: e.target.value }); setGitPr(null); }} placeholder="public/hub-daten" aria-label="Ordner im Repository" className="w-48" />
        </div>
        <div className="rv-speicher-zeile">
          <Input type="password" value={token} onChange={(e) => { setToken(e.target.value); setGitPr(null); }} placeholder="GitHub-Token (github_pat_… oder ghp_…), optional zum Schreiben" aria-label="GitHub-Token" autoComplete="off" />
          <Button variant="outline" className="rounded-full" disabled={!git.repo.trim() || !!laeuft} onClick={() => void gitPruefenJetzt()}>{laeuft === "gitpruefen" ? <Arbeitet text="Prüft" /> : "Git prüfen"}</Button>
          {gh?.quelle === "datei"
            ? <Button className="rounded-full" disabled={!!laeuft || token === gitToken()} onClick={() => void tokenSpeichern()}>{token.trim() || !gitToken() ? "Token in diesem Browser hinterlegen" : "Token entfernen"}</Button>
            : <Button className="rounded-full" disabled={!gitPr?.lesen || !!laeuft} onClick={() => void gitVerwenden(true)}>Git-Speicher hier nutzen</Button>}
          {gh?.quelle === "browser" && <Button variant="ghost" className="rounded-full" onClick={() => void gitVerwenden(false)}>Zurück auf diesen Browser</Button>}
        </div>
        {gitPr && <p className="hint" role="status" style={{ margin: 0, color: gitPr.schreiben ? "var(--ok)" : gitPr.lesen ? "var(--tool-text)" : "var(--danger)" }}>{gitPr.lesen ? "Lesen ✓" : "Lesen ✗"} · {gitPr.schreiben ? "Schreiben ✓" : "Schreiben ✗"} · {gitPr.meldung}</p>}
      </div>
      <span className="lbl">SharePoint-Ordner</span>
      <div className="rv-speicher-zeile">
        <Input value={ordner} onChange={(e) => { setOrdner(e.target.value); setPruefung(null); }} placeholder="https://koerbergroup.sharepoint.com/sites/…/Freigegebene Dokumente/KI-Hub" aria-label="Adresse des SharePoint-Ordners" />
        <Button variant="outline" className="rounded-full" disabled={!ordner.trim() || !!laeuft} onClick={() => void pruefen()}>{laeuft === "pruefen" ? <Arbeitet text="Prüft" /> : "Verbindung prüfen"}</Button>
        <Button className="rounded-full" disabled={!pruefung?.schreiben || !!laeuft} onClick={() => void verwenden(ordner)}>In diesem Browser verwenden</Button>
        {sp?.quelle === "browser" && <Button variant="ghost" className="rounded-full" onClick={() => void verwenden(null)}>Zurück auf diesen Browser</Button>}
      </div>
      {pruefung && <p className="hint" role="status" style={{ margin: 0, color: pruefung.schreiben ? "var(--ok)" : "var(--danger)" }}>{pruefung.lesen ? "Lesen ✓" : "Lesen ✗"} · {pruefung.schreiben ? "Schreiben ✓" : "Schreiben ✗"} · {pruefung.meldung}</p>}
      {(sp || (gh && schreibbar)) && (lokal.apps > 0 || lokal.personen > 0) && (
        <div className="rv-speicher-zeile">
          <span className="hint">In diesem Browser liegen noch {lokal.apps} Applikation{lokal.apps === 1 ? "" : "en"} und {lokal.personen} Rechte-Einträge.</span>
          <Button variant="outline" className="rounded-full" disabled={!!laeuft} onClick={() => void uebernehmen()}>{laeuft === "uebernehmen" ? <Arbeitet text="Übernimmt" /> : gh ? "In den Git-Speicher übernehmen" : "In den SharePoint-Ordner übernehmen"}</Button>
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>Im Ordner legt der Hub „apps/“, „rechte.json“ und „anmeldungen/“ an. Rechte in SharePoint: alle lesen; Schreiben in „apps/“ nur, wer bauen darf; „rechte.json“ nur die Verwaltung; in „anmeldungen/“ alle. Der Hub braucht dafür zusätzlich die Berechtigung Sites.ReadWrite.All mit Administratorzustimmung.</p>
    </section>
  );
}
