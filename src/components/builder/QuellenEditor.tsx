import { useEffect, useState } from "react";
import { BookmarkPlus, Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { M365_QUELLEN, type Quelle } from "@/lib/schema";
import { QUELL_TYP } from "@/lib/request";
import { bibliothek, merken } from "@/lib/wissensbibliothek";

/**
 * Liste von Wissensquellen bearbeiten: Art, Bezeichnung, Adresse; aus der Wissensbibliothek übernehmen oder dort merken.
 * Wird für das Wissen der App und das Wissen je KI-Schritt verwendet.
 */
export function QuellenEditor({ quellen, onChange, id }: { quellen: Quelle[]; onChange: (q: Quelle[]) => void; id: string }) {
  const [stand, setStand] = useState(0);   // Bibliothek nach „merken“ neu lesen
  // Netzlaufwerk: freigegebene Ordner des Hub-Dienstes (zum Auswählen), erst wenn eine solche Quelle da ist
  const [freigaben, setFreigaben] = useState<{ pfad: string; notiz: string }[] | null>(null);
  const mitLaufwerk = quellen.some((q) => q.typ === "laufwerk");
  useEffect(() => {
    if (!mitLaufwerk || freigaben) return;
    void import("@/lib/dienst").then(async (d) => ((await d.dienstAktiv()) ? (await d.laufwerkInfo()).freigaben : [])).then(setFreigaben, () => setFreigaben([]));
  }, [mitLaufwerk, freigaben]);
  const lib = bibliothek();
  const frei = lib.filter((e) => !quellen.some((q) => q.url.trim().toLowerCase() === e.url.trim().toLowerCase()));
  const set = (i: number, patch: Partial<Quelle>) => onChange(quellen.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  return (
    <div className="flex flex-col gap-2">
      {quellen.map((q, qi) => (
        <div className="qkarte" key={qi}>
          <select aria-label="Art der Quelle" className="h-9 min-w-0 rounded-[4px] border border-input bg-background px-2 text-sm" value={q.typ} onChange={(e) => set(qi, { typ: e.target.value as Quelle["typ"] })}>
            {Object.entries(QUELL_TYP).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          {!M365_QUELLEN.has(q.typ) && <Button variant="outline" size="icon-sm" aria-label="In der Wissensbibliothek merken" title="In der Wissensbibliothek merken" disabled={!q.url.trim()} onClick={() => { merken(q); setStand(stand + 1); toast.success(`„${q.titel || q.url}“ in der Wissensbibliothek gemerkt.`); }}><BookmarkPlus /></Button>}
          <Button variant="outline" size="icon-sm" aria-label="Quelle entfernen" title="Quelle entfernen" onClick={() => onChange(quellen.filter((_, k) => k !== qi))}><Trash /></Button>
          <Input className="qkarte-voll" aria-label="Bezeichnung der Quelle" placeholder={M365_QUELLEN.has(q.typ) ? "Bezeichnung (optional), z. B. Mails zum Projekt" : "Bezeichnung, z. B. QM-Handbuch"} value={q.titel} onChange={(e) => set(qi, { titel: e.target.value })} />
          {M365_QUELLEN.has(q.typ) ? (
            // Eigene E-Mails, Teams, Kalender: statt Adresse ein Zeitraum und (außer Kalender) ein Filter
            <div className="qkarte-voll flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-sm">Letzte
                <Input type="number" min={1} max={90} className="w-16" aria-label="Zeitraum in Tagen" value={q.tage} onChange={(e) => set(qi, { tage: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })} />
                Tage{q.typ === "kalender" ? " zurück und voraus" : ""}</label>
              {q.typ !== "kalender" && <Input className="min-w-[200px] flex-1" aria-label="Filter (Wörter, Komma getrennt)" placeholder="Filter: Wörter, Komma getrennt; leer = alle; Platzhalter wie {{thema}}" value={q.filter} onChange={(e) => set(qi, { filter: e.target.value })} />}
            </div>
          ) : q.typ === "laufwerk" ? (
            // Netzlaufwerk über den Hub-Dienst: ein freigegebener Ordner (oder ein Unterordner davon)
            <div className="qkarte-voll flex flex-wrap items-center gap-2">
              <Input className="min-w-[220px] flex-1" list={`${id}-lw-${qi}`} aria-label="Ordner auf dem Netzlaufwerk" placeholder="Freigegebener Ordner, z. B. Projekte/KTE" value={q.url} onChange={(e) => set(qi, { url: e.target.value })} />
              <datalist id={`${id}-lw-${qi}`}>{(freigaben ?? []).map((f) => <option key={f.pfad} value={f.pfad}>{f.notiz}</option>)}</datalist>
              <span className="hint w-full">{freigaben === null ? "Lädt die freigegebenen Ordner …" : freigaben.length ? `Freigegeben: ${freigaben.map((f) => f.pfad || "/").join(", ")}. Auch Unterordner davon gehen.` : "Keine freigegebenen Ordner (oder kein Hub-Dienst). Die Verwaltung gibt Ordner unter „Netzlaufwerk“ frei."}</span>
            </div>
          ) : q.typ === "connector" ? (
            // Netzlaufwerk über einen Graph-Connector: Verbindungs-ID und optional ein Ordner
            <div className="qkarte-voll flex flex-wrap items-center gap-2">
              <Input className="min-w-[180px] flex-1" aria-label="Verbindungs-ID des Connectors" placeholder="Verbindungs-ID aus dem Microsoft 365 Admin Center, z. B. laufwerky" value={q.url} onChange={(e) => set(qi, { url: e.target.value.trim() })} />
              <Input className="min-w-[220px] flex-[2]" aria-label="Nur dieser Ordner (optional)" placeholder="Nur Ordner (optional), z. B. \\server\freigabe\Projekte\KTE" value={q.filter} onChange={(e) => set(qi, { filter: e.target.value })} />
              <span className="hint w-full">Gefunden wird nur, was die angemeldete Person auf dem Laufwerk lesen darf.</span>
            </div>
          ) : (
            <Input className="qkarte-voll" aria-label="Adresse der Quelle" placeholder="https://firma.sharepoint.com/sites/QM/Freigegebene Dokumente" value={q.url} onChange={(e) => set(qi, { url: e.target.value })} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange([...quellen, { typ: "sharepoint", titel: "", url: "", tage: 7, filter: "" }])}><Plus />Wissensquelle</Button>
        <Button variant="outline" size="sm" onClick={() => onChange([...quellen, { typ: "mail", titel: "", url: "", tage: 7, filter: "" }])}><Plus />Meine E-Mails</Button>
        <Button variant="outline" size="sm" onClick={() => onChange([...quellen, { typ: "laufwerk", titel: "Laufwerk Y", url: "", tage: 7, filter: "" }])}><Plus />Netzlaufwerk</Button>
        {frei.length > 0 && (
          <select aria-label="Aus der Wissensbibliothek übernehmen" className="h-8 min-w-0 max-w-full rounded-full border border-input bg-background px-3 text-sm" value="" id={`${id}-lib`}
            onChange={(e) => { const x = frei.find((f) => f.id === e.target.value); if (x) onChange([...quellen, { typ: x.typ, titel: x.titel, url: x.url, tage: 7, filter: "" }]); }}>
            <option value="">Aus der Wissensbibliothek …</option>
            {frei.map((e) => <option key={e.id} value={e.id} title={e.beschreibung}>{e.titel}{e.beschreibung ? ` – ${e.beschreibung.slice(0, 60)}` : ""}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
