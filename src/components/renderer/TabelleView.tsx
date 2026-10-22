import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import type { Block } from "@/lib/schema";
import { alleSpalten, summeVon, tabelleLesen, tabelleSchreiben, zahlText, zusatzKey, type Spalte, type TabWert } from "@/lib/tabelle";
import { useRun } from "./runContext";
import type { Mode } from "./BlockContent";

/**
 * Tabelle mit Zeilen aus einem KI-Ergebnis und Spalten zum Eintragen. Kopfzeile und Summenzeile bleiben stehen,
 * die Zeilen scrollen in sich. Enter springt in dieselbe Spalte der nächsten Zeile.
 */
export function TabelleView({ b, mode }: { b: Extract<Block, { type: "tabelle" }>; mode: Mode }) {
  const run = useRun();
  const P = b.props;
  const id = `in-${P.key}`;
  const aktiv = mode === "run" && !!run;
  const w: TabWert = aktiv ? tabelleLesen(run!.werte[P.key]) : { zeilen: [{}, {}], zusatz: [] };
  const spalten = alleSpalten(P, w);
  const err = run?.fehler.has(P.key);
  const [neueSpalte, setNeueSpalte] = useState<string | null>(null);
  const setzen = (n: TabWert) => run?.setWert(P.key, tabelleSchreiben(n));
  const zelle = (zi: number, key: string, v: string) => setzen({ ...w, zeilen: w.zeilen.map((z, i) => (i === zi ? { ...z, [key]: v } : z)) });
  const bearbeitbar = (s: Spalte) => aktiv && (s.art === "eingabe" || P.kiBearbeitbar);
  const summen = spalten.some((s) => s.summe && s.typ === "zahl");
  const spalteAnlegen = () => {
    const t = (neueSpalte ?? "").trim().slice(0, 60);
    if (t && !spalten.some((s) => s.key === zusatzKey(t))) setzen({ ...w, zusatz: [...w.zusatz, t] });
    setNeueSpalte(null);
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>, zi: number, si: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const tabelle = e.currentTarget.closest("table");
    tabelle?.querySelector<HTMLInputElement>(`input[data-zelle="${zi + (e.shiftKey ? -1 : 1)}:${si}"]`)?.focus();
  };
  const hilfe = P.hilfe ? <span className="o-help" id={`${id}-hilfe`}>{P.hilfe}</span> : null;
  return (
    <div className={`o-field o-tab ${err ? "err" : ""}`} data-key={P.key}>
      <span className="o-lbl" id={`${id}-titel`}>{P.label}{P.pflicht && <em aria-hidden="true">*</em>}</span>
      {aktiv && !w.zeilen.length ? (
        <p className="o-muted o-tab-leer">{P.aus.trim() ? "Noch keine Zeilen. Sie kommen aus der eingelesenen Datei, sobald der KI-Schritt gelaufen ist." : "Noch keine Zeilen."}</p>
      ) : (
        <div className="o-tab-rahmen innen-scroll" role="region" aria-labelledby={`${id}-titel`} tabIndex={-1}>
          <table className="o-tab-tabelle" aria-describedby={hilfe ? `${id}-hilfe` : undefined}>
            <thead>
              <tr>
                {spalten.map((s) => (
                  <th key={s.key} scope="col" data-typ={s.typ} data-art={s.art}>
                    <span>{s.titel}</span>
                    {aktiv && s.key.startsWith("z_") && w.zusatz.some((t) => zusatzKey(t) === s.key) && (
                      <button type="button" className="o-tab-weg" aria-label={`Spalte „${s.titel}“ entfernen`}
                        onClick={() => setzen({ zeilen: w.zeilen.map((z) => { const { [s.key]: _, ...rest } = z; return rest; }), zusatz: w.zusatz.filter((t) => zusatzKey(t) !== s.key) })}><X size={12} aria-hidden="true" /></button>
                    )}
                  </th>
                ))}
                {aktiv && P.zeilenHinzufuegen && <th className="o-tab-aktion"><span className="sr-only">Zeile entfernen</span></th>}
              </tr>
            </thead>
            <tbody>
              {w.zeilen.map((z, zi) => (
                <tr key={zi}>
                  {spalten.map((s, si) => (
                    <td key={s.key} data-typ={s.typ} data-art={s.art}>
                      {bearbeitbar(s) ? (
                        <input type={s.typ === "datum" ? "date" : "text"} inputMode={s.typ === "zahl" ? "decimal" : undefined} value={z[s.key] ?? ""}
                          aria-label={`${s.titel}, Zeile ${zi + 1}`} data-zelle={`${zi}:${si}`} autoComplete="off"
                          onChange={(e) => zelle(zi, s.key, e.target.value)} onKeyDown={(e) => enter(e, zi, si)} />
                      ) : <span>{z[s.key] ?? ""}</span>}
                    </td>
                  ))}
                  {aktiv && P.zeilenHinzufuegen && (
                    <td className="o-tab-aktion">
                      <button type="button" className="o-tab-weg" aria-label={`Zeile ${zi + 1} entfernen`} onClick={() => setzen({ ...w, zeilen: w.zeilen.filter((_, i) => i !== zi) })}><X size={13} aria-hidden="true" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {summen && (
              <tfoot>
                <tr>
                  {spalten.map((s, si) => <td key={s.key} data-typ={s.typ}>{s.summe && s.typ === "zahl" ? zahlText(summeVon(w.zeilen, s.key)) : si === 0 ? "Summe" : ""}</td>)}
                  {aktiv && P.zeilenHinzufuegen && <td className="o-tab-aktion" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {aktiv && (P.zeilenHinzufuegen || P.spaltenHinzufuegen) && (
        <div className="o-tab-knoepfe">
          {P.zeilenHinzufuegen && <button type="button" className="o-chat-knopf" onClick={() => setzen({ ...w, zeilen: [...w.zeilen, {}] })}><Plus size={13} aria-hidden="true" />Zeile hinzufügen</button>}
          {P.spaltenHinzufuegen && (neueSpalte === null
            ? <button type="button" className="o-chat-knopf" onClick={() => setNeueSpalte("")}><Plus size={13} aria-hidden="true" />Spalte hinzufügen</button>
            : <form className="o-tab-neu" onSubmit={(e) => { e.preventDefault(); spalteAnlegen(); }}>
                <input autoFocus value={neueSpalte} maxLength={60} placeholder="Titel, z. B. Name des Mitarbeiters" aria-label="Titel der neuen Spalte"
                  onChange={(e) => setNeueSpalte(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setNeueSpalte(null); }} />
                <button type="submit" className="o-chat-knopf">Anlegen</button>
                <button type="button" className="o-chat-knopf" onClick={() => setNeueSpalte(null)}>Abbrechen</button>
              </form>)}
        </div>
      )}
      {hilfe}
      {err && <span className="o-err" id={`${id}-fehler`}>Die Tabelle braucht mindestens eine Zeile.</span>}
    </div>
  );
}
