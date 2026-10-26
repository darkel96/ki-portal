import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Fld, Seg, Sel } from "@/components/builder/controls";
import { useMeinHub } from "@/state/meinhub";
import type { FileInfo } from "@/lib/request";
import type { Werte } from "@/lib/runner";
import {
  WOCHENTAG, ZIEL_GRAPH, ZIEL_LABEL, ZIEL_SPAETER, ZeitplanSchema, datumZeit, naechsterLauf, zeitplanText,
  type Auftrag, type Voreinstellung, type Zeitplan, type Ziel,
} from "@/lib/meinhub";
import { istWebhook, zielPruefen, zielText } from "@/lib/versand";
import { testInhalt, zustellenImBrowser, zustellungMoeglich } from "@/lib/ki/zustellung";
import { useApps } from "@/state/apps";

type Stand = () => { werte: Werte; dateien: Record<string, FileInfo> };

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

/**
 * Merkt sich beim Öffnen das auslösende Element und gibt ihm beim Schließen den Fokus zurück.
 * Kam der Klick aus einem Menü (das sich dabei schließt), zählt der Menüknopf; ist der Auslöser inzwischen weg, greift `ersatz`.
 */
export function useAusloeser(offen: boolean, ersatz?: () => HTMLElement | null | undefined) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!offen) return;
    let el = document.activeElement as HTMLElement | null;
    const menue = el?.closest<HTMLElement>("[role=menu]");
    if (menue) el = document.getElementById(menue.getAttribute("aria-labelledby") ?? "") ?? el;
    ref.current = el && el !== document.body ? el : null;
  }, [offen]);
  return (e: Event) => {
    const el = ref.current && document.contains(ref.current) ? ref.current : ersatz?.();
    if (!el) return;
    e.preventDefault();
    el.focus();
  };
}

/** Wie Sel aus dem Baukasten, aber einzelne Optionen lassen sich sperren (z. B. Ziele, die erst später kommen). */
function SelMitSperre<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, boolean?][]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <Fld label={label} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([k, t, aus]) => <SelectItem key={k} value={k} disabled={aus}>{t}</SelectItem>)}</SelectContent>
      </Select>
    </Fld>
  );
}

/** Aktuelle Eingaben einer Applikation als Voreinstellung speichern (neu oder eine bestehende überschreiben). */
export function VorlageDialog({ offen, onOffen, appId, appName, stand, aktiv, onGespeichert }: {
  offen: boolean; onOffen: (o: boolean) => void; appId: string; appName: string; stand: Stand;
  /** Gerade geladene Voreinstellung: wird zum Überschreiben angeboten */
  aktiv?: Voreinstellung | null; onGespeichert?: (v: Voreinstellung) => void;
}) {
  const { vorlageSpeichern } = useMeinHub();
  const fokusZurueck = useAusloeser(offen);
  const [name, setName] = useState("");
  const [ueberschreiben, setUeberschreiben] = useState(false);
  useEffect(() => { if (offen) { setName(aktiv?.name ?? ""); setUeberschreiben(!!aktiv); } }, [offen, aktiv]);
  const speichern = () => {
    const { werte, dateien } = stand();
    const n = name.trim() || `${appName} (Voreinstellung)`;
    const v = vorlageSpeichern({ id: ueberschreiben && aktiv ? aktiv.id : undefined, appId, name: n.slice(0, 80), werte, dateien });
    toast.success(`Voreinstellung „${v.name}“ gespeichert. Du findest sie in Mein Hub.`);
    onGespeichert?.(v);
    onOffen(false);
  };
  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={fokusZurueck}>
        <DialogHeader>
          <DialogTitle>Eingaben als Voreinstellung speichern</DialogTitle>
          <DialogDescription>Alle ausgefüllten Felder und hochgeladenen Dateien werden gespeichert. Beim nächsten Öffnen ist die Applikation damit schon ausgefüllt; Aufträge nutzen sie für regelmäßige Läufe.</DialogDescription>
        </DialogHeader>
        <Fld label="Name der Voreinstellung" htmlFor="vl-name">
          <Input id="vl-name" value={name} autoComplete="off" maxLength={80} placeholder="z. B. Jour fixe Kundenportal …" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") speichern(); }} />
        </Fld>
        {aktiv && <Check label={`„${aktiv.name}“ überschreiben`} hint="Ohne Häkchen entsteht eine neue Voreinstellung." checked={ueberschreiben} onChange={setUeberschreiben} />}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOffen(false)}>Abbrechen</Button>
          <Button onClick={speichern}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AKTUELL = "__aktuell";

/** Regelmäßigen Auftrag anlegen oder bearbeiten. */
export function AuftragDialog({ offen, onOffen, appId, appName, auftrag, stand, vorlageVorschlag }: {
  offen: boolean; onOffen: (o: boolean) => void; appId: string; appName: string;
  auftrag?: Auftrag | null;
  /** Nur in der App-Ansicht: aktuelle Eingaben als neue Voreinstellung übernehmen */
  stand?: Stand;
  vorlageVorschlag?: string | null;
}) {
  const { vorlagenFuer, vorlageSpeichern, auftragSpeichern, dienstAn } = useMeinHub();
  const { find } = useApps();
  // Empfehlung der App (z. B. „montags 07:00 per E-Mail“) als Vorschlag für einen neuen Auftrag
  const empfehlung = find(appId)?.auftrag;
  const fokusZurueck = useAusloeser(offen);
  const vorlagen = vorlagenFuer(appId);
  const [name, setName] = useState("");
  const [vorlage, setVorlage] = useState<string>(AKTUELL);
  const [zeitplan, setZeitplan] = useState<Zeitplan>(ZeitplanSchema.parse({}));
  const [ziel, setZiel] = useState<Ziel>({ art: "hub", adresse: "" });
  const [aktiv, setAktiv] = useState(true);
  const [testet, setTestet] = useState(false);
  const graphDa = zustellungMoeglich();

  useEffect(() => {
    if (!offen) return;
    setName(auftrag?.name ?? appName);
    setVorlage(auftrag?.voreinstellungId ?? vorlageVorschlag ?? (stand ? AKTUELL : vorlagen[0]?.id ?? ""));
    setZeitplan(auftrag?.zeitplan ?? (empfehlung ? ZeitplanSchema.parse({ art: empfehlung.art, uhrzeit: empfehlung.uhrzeit, wochentag: empfehlung.wochentag, tag: empfehlung.tag }) : ZeitplanSchema.parse({})));
    setZiel(auftrag?.ziel ?? { art: empfehlung?.ziel ?? "hub", adresse: "" });
    setAktiv(auftrag?.aktiv ?? true);
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps

  const z = (k: keyof Zeitplan, v: unknown) => setZeitplan((alt) => ({ ...alt, [k]: v }));
  const adressFehler = zielPruefen(ziel);
  const speichern = (e: FormEvent) => {
    e.preventDefault();
    if (!optionen.length || adressFehler) return;
    let vid: string | null = vorlage || null;
    if (vorlage === AKTUELL) {
      if (!stand) return;
      const { werte, dateien } = stand();
      vid = vorlageSpeichern({ appId, name: (name.trim() || appName).slice(0, 80), werte, dateien }).id;
    }
    const a = auftragSpeichern({ id: auftrag?.id, name: (name.trim() || appName).slice(0, 80), appId, voreinstellungId: vid, zeitplan, ziel: { art: ziel.art, adresse: ziel.adresse.trim() }, aktiv });
    toast.success(`Auftrag „${a.name}“ gespeichert. Nächster Lauf: ${datumZeit(a.naechsterLauf)}${a.ziel.art !== "hub" ? `, Ergebnis ${zielText(a.ziel)}` : ""}.`);
    onOffen(false);
  };
  const zustellungTesten = async () => {
    if (adressFehler) { toast.error(adressFehler); return; }
    setTestet(true);
    try { toast.success(`Testnachricht ${zielText(ziel)}: ${await zustellenImBrowser(ziel, testInhalt(appName))}`); }
    catch (e) { toast.error(`Testnachricht ${zielText(ziel)} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setTestet(false); }
  };
  const zielHinweis = ziel.art === "email"
    ? "Leer lassen heißt: an dich. Mehrere Empfänger trennst du mit Komma oder Semikolon, „ich“ steht für dich selbst (z. B. „ich, anna.berger@koerber.com“). Alle Empfänger stehen gemeinsam im An-Feld; die Testnachricht geht an alle."
    : ziel.art === "teams"
      ? "Leer lassen heißt: in deinen Teams-Chat mit dir selbst. Die Nachricht geht in deinem Namen raus, deshalb zeigt Teams dafür kein Hinweisfenster und keine Zahl am Chat. Soll Teams dich benachrichtigen, nimm eine Webhook-Adresse: im Chat oder Kanal → Workflows → „Beim Empfang einer Webhook-Anforderung posten“; dann schreibt der Workflows-Bot und Teams meldet die Nachricht. Sonst die E-Mail-Adresse einer Person (Einzelchat)."
      : "";
  const optionen: [string, string][] = [
    ...(stand ? [[AKTUELL, "Aktuelle Eingaben (als neue Voreinstellung)"] as [string, string]] : []),
    ...vorlagen.map((v) => [v.id, v.name] as [string, string]),
  ];

  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={fokusZurueck}>
        <DialogHeader>
          <DialogTitle>{auftrag ? "Auftrag bearbeiten" : "Regelmäßig ausführen"}</DialogTitle>
          <DialogDescription>„{appName}“ läuft dann automatisch mit festen Eingaben. Das Ergebnis liegt im Verlauf von Mein Hub.</DialogDescription>
        </DialogHeader>
        <form className="mh-form" onSubmit={speichern}>
        <Fld label="Name des Auftrags" htmlFor="af-name">
          <Input id="af-name" value={name} autoComplete="off" maxLength={80} placeholder="z. B. Wöchentliches Protokoll …" onChange={(e) => setName(e.target.value)} />
        </Fld>
        {optionen.length ? <Sel label="Eingaben" value={vorlage} options={optionen} onChange={setVorlage} />
          : <p className="hint" style={{ margin: 0 }}>Für diese Applikation gibt es noch keine Voreinstellung. Öffne sie, füll sie aus und speichere die Eingaben als Voreinstellung.</p>}
        <Seg label="Wie oft" value={zeitplan.art} options={[["taeglich", "Täglich"], ["werktags", "Werktags"], ["woechentlich", "Wöchentlich"], ["monatlich", "Monatlich"]]} onChange={(v) => z("art", v)} />
        <div className="flex flex-wrap gap-3">
          {zeitplan.art === "woechentlich" && <Sel label="Wochentag" value={String(zeitplan.wochentag)} options={WOCHENTAG.map((t, i) => [String(i + 1), t] as [string, string])} onChange={(v) => z("wochentag", Number(v))} />}
          {zeitplan.art === "monatlich" && <Sel label="Tag im Monat" value={String(zeitplan.tag)} options={Array.from({ length: 28 }, (_, i) => [String(i + 1), `${i + 1}.`] as [string, string])} onChange={(v) => z("tag", Number(v))} />}
          <Fld label="Uhrzeit" htmlFor="af-zeit">
            <Input id="af-zeit" type="time" value={zeitplan.uhrzeit} onChange={(e) => e.target.value && z("uhrzeit", e.target.value)} className="w-32" />
          </Fld>
        </div>
        <SelMitSperre label="Ergebnis" value={ziel.art} onChange={(art) => setZiel((alt) => ({ ...alt, art }))}
          options={(Object.keys(ZIEL_LABEL) as Ziel["art"][]).map((k) => (
            ZIEL_SPAETER.has(k) ? [k, `${ZIEL_LABEL[k]} (folgt)`, true]
              : ZIEL_GRAPH.has(k) && !graphDa && !dienstAn ? [k, `${ZIEL_LABEL[k]} (braucht die Copilot-Anmeldung)`, true]
                : [k, ZIEL_LABEL[k]]) as [Ziel["art"], string, boolean?])} />
        {ZIEL_GRAPH.has(ziel.art) && (
          <Fld label={ziel.art === "email" ? "Empfänger (optional, auch mehrere)" : "Empfänger oder Kanal (optional)"} htmlFor="af-adresse">
            <div className="flex flex-wrap items-center gap-2">
              <Input id="af-adresse" className="min-w-0 flex-1" value={ziel.adresse} autoComplete="off" maxLength={2000} aria-invalid={!!adressFehler || undefined}
                placeholder={ziel.art === "email" ? "leer = an mich; mehrere mit Komma trennen" : "leer = an mich; E-Mail einer Person oder https://… (Webhook)"} onChange={(e) => setZiel((alt) => ({ ...alt, adresse: e.target.value }))} />
              <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={testet || !graphDa && !istWebhook(ziel.adresse)} title={!graphDa && !istWebhook(ziel.adresse) ? "Zum Testen aus dem Browser braucht es die Copilot-Anmeldung" : undefined} onClick={() => void zustellungTesten()}>{testet ? "Sendet …" : "Zustellung testen"}</Button>
            </div>
            <p className="hint" style={{ margin: "4px 0 0", color: adressFehler ? "var(--danger)" : undefined }}>{adressFehler ?? zielHinweis}</p>
          </Fld>
        )}
        <Check label="Auftrag ist aktiv" checked={aktiv} onChange={setAktiv} />
        <p className="hint" style={{ margin: 0 }}>Läuft {zeitplanText(zeitplan)}, zuerst am {datumZeit(naechsterLauf(zeitplan).toISOString())}{ziel.art !== "hub" ? `, Ergebnis ${zielText(ziel)}` : ""}. {dienstAn ? "Der Hub-Dienst führt den Auftrag aus, auch wenn der KI-Hub geschlossen ist." : "Ohne Hub-Dienst laufen Aufträge, solange der KI-Hub in einem Browserfenster geöffnet ist; verpasste Termine werden beim nächsten Öffnen einmal nachgeholt."}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOffen(false)}>Abbrechen</Button>
          <Button type="submit" disabled={!optionen.length || !!adressFehler}>Speichern</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Voreinstellungen einer Applikation umbenennen oder löschen. */
export function VorlagenVerwalten({ offen, onOffen, appId, appName, ersatz }: { offen: boolean; onOffen: (o: boolean) => void; appId: string; appName: string; /** Fokusziel nach dem Schließen, falls der Auslöser verschwunden ist (z. B. letzte Voreinstellung gelöscht) */ ersatz?: () => HTMLElement | null | undefined }) {
  const { vorlagenFuer, vorlageUmbenennen, vorlageLoeschen, daten } = useMeinHub();
  const fokusZurueck = useAusloeser(offen, ersatz);
  const vorlagen = vorlagenFuer(appId);
  const [namen, setNamen] = useState<Record<string, string>>({});
  const [fragen, setFragen] = useState<string | null>(null);
  useEffect(() => { if (offen) { setNamen(Object.fromEntries(vorlagen.map((v) => [v.id, v.name]))); setFragen(null); } }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps
  const umbenennen = (v: Voreinstellung) => {
    const n = (namen[v.id] ?? "").trim();
    if (!n) { setNamen((x) => ({ ...x, [v.id]: v.name })); return; }
    if (n !== v.name) { vorlageUmbenennen(v.id, n); toast.success(`Umbenannt in „${n}“.`); }
  };
  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={fokusZurueck}>
        <DialogHeader>
          <DialogTitle>Voreinstellungen verwalten</DialogTitle>
          <DialogDescription>Gespeicherte Eingaben für „{appName}“. Namen direkt im Feld ändern.</DialogDescription>
        </DialogHeader>
        {vorlagen.length ? (
          <ul className="vl-liste">
            {vorlagen.map((v) => {
              const auftraege = daten.auftraege.filter((a) => a.voreinstellungId === v.id);
              return (
                <li key={v.id}>
                  <div className="vl-zeile">
                    <Input aria-label={`Name der Voreinstellung ${v.name}`} autoComplete="off" maxLength={80} value={namen[v.id] ?? v.name} onChange={(e) => setNamen((x) => ({ ...x, [v.id]: e.target.value }))}
                      onBlur={() => umbenennen(v)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                    {fragen === v.id ? (
                      <>
                        <Button size="sm" variant="destructive" onClick={() => { vorlageLoeschen(v.id); setFragen(null); toast.success(`„${v.name}“ gelöscht.`); }}>Wirklich löschen</Button>
                        <Button size="sm" variant="ghost" onClick={() => setFragen(null)}>Behalten</Button>
                      </>
                    ) : <Button size="sm" variant="ghost" onClick={() => setFragen(v.id)}>Löschen</Button>}
                  </div>
                  <span className="hint">
                    Gespeichert {datumZeit(v.geaendert || v.erstellt)}, {anzahl(Object.keys(v.werte).length, "Eingabe", "Eingaben")}{Object.keys(v.dateien).length ? `, ${anzahl(Object.keys(v.dateien).length, "Datei", "Dateien")}` : ""}
                    {auftraege.length ? `. Genutzt von ${auftraege.map((a) => `„${a.name}“`).join(", ")}${fragen === v.id ? "; der Auftrag wird beim Löschen pausiert" : ""}.` : "."}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="hint" style={{ margin: 0 }}>Für diese Applikation gibt es keine Voreinstellungen.</p>}
        <DialogFooter><Button onClick={() => onOffen(false)}>Fertig</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
