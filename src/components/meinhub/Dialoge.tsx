import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Fld, Seg, Sel } from "@/components/builder/controls";
import { useMeinHub } from "@/state/meinhub";
import type { FileInfo } from "@/lib/request";
import type { Werte } from "@/lib/runner";
import {
  WOCHENTAG, ZIEL_LABEL, ZIEL_SPAETER, ZeitplanSchema, datumZeit, naechsterLauf, zeitplanText,
  type Auftrag, type Voreinstellung, type Zeitplan, type Ziel,
} from "@/lib/meinhub";

type Stand = () => { werte: Werte; dateien: Record<string, FileInfo> };

/** Aktuelle Eingaben einer App als Voreinstellung speichern (neu oder eine bestehende überschreiben). */
export function VorlageDialog({ offen, onOffen, appId, appName, stand, aktiv, onGespeichert }: {
  offen: boolean; onOffen: (o: boolean) => void; appId: string; appName: string; stand: Stand;
  /** Gerade geladene Voreinstellung: wird zum Überschreiben angeboten */
  aktiv?: Voreinstellung | null; onGespeichert?: (v: Voreinstellung) => void;
}) {
  const { vorlageSpeichern } = useMeinHub();
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eingaben als Voreinstellung speichern</DialogTitle>
          <DialogDescription>Alle ausgefüllten Felder und hochgeladenen Dateien werden gespeichert. Beim nächsten Öffnen ist die App damit schon ausgefüllt; Aufträge nutzen sie für regelmäßige Läufe.</DialogDescription>
        </DialogHeader>
        <Fld label="Name der Voreinstellung" htmlFor="vl-name">
          <Input id="vl-name" value={name} placeholder="z. B. Jour fixe Kundenportal" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") speichern(); }} />
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
  const { vorlagenFuer, vorlageSpeichern, auftragSpeichern } = useMeinHub();
  const vorlagen = vorlagenFuer(appId);
  const [name, setName] = useState("");
  const [vorlage, setVorlage] = useState<string>(AKTUELL);
  const [zeitplan, setZeitplan] = useState<Zeitplan>(ZeitplanSchema.parse({}));
  const [ziel, setZiel] = useState<Ziel["art"]>("hub");
  const [aktiv, setAktiv] = useState(true);

  useEffect(() => {
    if (!offen) return;
    setName(auftrag?.name ?? appName);
    setVorlage(auftrag?.voreinstellungId ?? vorlageVorschlag ?? (stand ? AKTUELL : vorlagen[0]?.id ?? ""));
    setZeitplan(auftrag?.zeitplan ?? ZeitplanSchema.parse({}));
    setZiel(auftrag?.ziel.art ?? "hub");
    setAktiv(auftrag?.aktiv ?? true);
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps

  const z = (k: keyof Zeitplan, v: unknown) => setZeitplan((alt) => ({ ...alt, [k]: v }));
  const speichern = () => {
    let vid: string | null = vorlage || null;
    if (vorlage === AKTUELL) {
      if (!stand) return;
      const { werte, dateien } = stand();
      vid = vorlageSpeichern({ appId, name: (name.trim() || appName).slice(0, 80), werte, dateien }).id;
    }
    const a = auftragSpeichern({ id: auftrag?.id, name: (name.trim() || appName).slice(0, 80), appId, voreinstellungId: vid, zeitplan, ziel: { art: ziel, adresse: "" }, aktiv });
    toast.success(`Auftrag „${a.name}“ gespeichert. Nächster Lauf: ${datumZeit(a.naechsterLauf)}.`);
    onOffen(false);
  };
  const optionen: [string, string][] = [
    ...(stand ? [[AKTUELL, "Aktuelle Eingaben (als neue Voreinstellung)"] as [string, string]] : []),
    ...vorlagen.map((v) => [v.id, v.name] as [string, string]),
  ];

  return (
    <Dialog open={offen} onOpenChange={onOffen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{auftrag ? "Auftrag bearbeiten" : "Regelmäßig ausführen"}</DialogTitle>
          <DialogDescription>„{appName}“ läuft dann automatisch mit festen Eingaben. Das Ergebnis liegt im Verlauf von Mein Hub.</DialogDescription>
        </DialogHeader>
        <Fld label="Name des Auftrags" htmlFor="af-name">
          <Input id="af-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Fld>
        {optionen.length ? <Sel label="Eingaben" value={vorlage} options={optionen} onChange={setVorlage} />
          : <p className="hint" style={{ margin: 0, color: "var(--danger)" }}>Für diese App gibt es noch keine Voreinstellung. Öffne die App, füll sie aus und speichere die Eingaben als Voreinstellung.</p>}
        <Seg label="Wie oft" value={zeitplan.art} options={[["taeglich", "Täglich"], ["werktags", "Werktags"], ["woechentlich", "Wöchentlich"], ["monatlich", "Monatlich"]]} onChange={(v) => z("art", v)} />
        <div className="flex flex-wrap gap-3">
          {zeitplan.art === "woechentlich" && <Sel label="Wochentag" value={String(zeitplan.wochentag)} options={WOCHENTAG.map((t, i) => [String(i + 1), t] as [string, string])} onChange={(v) => z("wochentag", Number(v))} />}
          {zeitplan.art === "monatlich" && <Sel label="Tag im Monat" value={String(zeitplan.tag)} options={Array.from({ length: 28 }, (_, i) => [String(i + 1), `${i + 1}.`] as [string, string])} onChange={(v) => z("tag", Number(v))} />}
          <Fld label="Uhrzeit" htmlFor="af-zeit">
            <Input id="af-zeit" type="time" value={zeitplan.uhrzeit} onChange={(e) => e.target.value && z("uhrzeit", e.target.value)} className="w-32" />
          </Fld>
        </div>
        <Sel label="Ergebnis" value={ziel} options={(Object.keys(ZIEL_LABEL) as Ziel["art"][]).map((k) => [k, ZIEL_SPAETER.has(k) ? `${ZIEL_LABEL[k]} (folgt mit der Azure-Anbindung)` : ZIEL_LABEL[k]] as [Ziel["art"], string])}
          onChange={(v) => { if (ZIEL_SPAETER.has(v)) { toast.info("Dieses Ziel folgt mit der zentralen Azure-Anbindung. Bis dahin landet das Ergebnis im Verlauf."); return; } setZiel(v); }} />
        <Check label="Auftrag ist aktiv" checked={aktiv} onChange={setAktiv} />
        <p className="hint" style={{ margin: 0 }}>Läuft {zeitplanText(zeitplan)}, zuerst am {datumZeit(naechsterLauf(zeitplan).toISOString())}. In dieser Testfassung laufen Aufträge, solange der KI-Hub in einem Browserfenster geöffnet ist; verpasste Termine werden beim nächsten Öffnen einmal nachgeholt.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOffen(false)}>Abbrechen</Button>
          <Button onClick={speichern} disabled={!optionen.length}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Voreinstellungen einer App umbenennen oder löschen. */
export function VorlagenVerwalten({ offen, onOffen, appId, appName }: { offen: boolean; onOffen: (o: boolean) => void; appId: string; appName: string }) {
  const { vorlagenFuer, vorlageUmbenennen, vorlageLoeschen, daten } = useMeinHub();
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
      <DialogContent className="sm:max-w-lg">
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
                    <Input aria-label={`Name der Voreinstellung ${v.name}`} value={namen[v.id] ?? v.name} onChange={(e) => setNamen((x) => ({ ...x, [v.id]: e.target.value }))}
                      onBlur={() => umbenennen(v)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                    {fragen === v.id ? (
                      <>
                        <Button size="sm" variant="destructive" onClick={() => { vorlageLoeschen(v.id); setFragen(null); toast.success(`„${v.name}“ gelöscht.`); }}>Wirklich löschen</Button>
                        <Button size="sm" variant="ghost" onClick={() => setFragen(null)}>Behalten</Button>
                      </>
                    ) : <Button size="sm" variant="ghost" onClick={() => setFragen(v.id)}>Löschen</Button>}
                  </div>
                  <span className="hint">
                    Gespeichert {datumZeit(v.geaendert || v.erstellt)}, {Object.keys(v.werte).length} Eingaben{Object.keys(v.dateien).length ? `, ${Object.keys(v.dateien).length} Datei(en)` : ""}
                    {auftraege.length ? `. Genutzt von ${auftraege.map((a) => `„${a.name}“`).join(", ")}${fragen === v.id ? "; der Auftrag wird beim Löschen pausiert" : ""}.` : "."}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="hint" style={{ margin: 0 }}>Für diese App gibt es keine Voreinstellungen.</p>}
        <DialogFooter><Button onClick={() => onOffen(false)}>Fertig</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
