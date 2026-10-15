import { useRef, useState } from "react";
import { FileText, Trash, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractText, UnsupportedFormatError } from "@/lib/files";
import type { Step } from "@/lib/schema";
import { TextFld } from "./controls";

/** Größte Word-Vorlage, deren Design gespeichert wird (die App liegt samt Vorlage im Browser bzw. in SharePoint) */
export const VORLAGE_MAX_BYTES = 1_000_000;
export const VORLAGE_ACCEPT = ".docx,.dotx,.pdf,.md,.txt";

type Vorlage = NonNullable<Step["vorlage"]>;

function alsBase64(daten: ArrayBuffer): string {
  const b = new Uint8Array(daten);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Word-Vorlage als Markdown-Gerüst (Überschriften, Listen, Tabellen); Bilder fallen weg. Sonst reiner Text. */
async function wordAufbau(daten: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: daten }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    const [{ dokumentAus }, { alsMarkdown }] = await Promise.all([import("@/lib/dokument"), import("@/lib/vorlage")]);
    const md = alsMarkdown(dokumentAus(`<html><body>${value}</body></html>`));
    if (md.trim()) return md;
  } catch { /* unten der einfache Leser */ }
  return (await import("@/lib/docx")).docxAlsText(daten);
}

/** Datei als Vorlage lesen: Text für Aufbau und Stil, bei Word zusätzlich die Datei selbst fürs Design */
export async function vorlageLesen(file: File): Promise<Vorlage> {
  const n = file.name.toLowerCase();
  const word = n.endsWith(".docx") || n.endsWith(".dotx");
  const daten = word ? await file.arrayBuffer() : null;
  const text = word ? await wordAufbau(daten!) : await extractText(file);
  return { name: file.name, text: text.trim().slice(0, 20_000), docx: daten && daten.byteLength <= VORLAGE_MAX_BYTES ? alsBase64(daten) : "" };
}

/** Einstellung „Vorlage für Aufbau und Design“ eines KI-Schritts */
export function VorlageFeld({ step, datei, onChange }: { step: Step; datei: Step["datei"]; onChange: (v: Vorlage | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [liest, setLiest] = useState(false);
  const v = step.vorlage;
  const id = `vl-${step.id}`;
  const hochladen = async (file: File) => {
    setLiest(true);
    try {
      const neu = await vorlageLesen(file);
      if (!neu.text && !neu.docx) { toast.error("In der Datei steht kein lesbarer Text."); return; }
      onChange(neu);
      const n = file.name.toLowerCase();
      if ((n.endsWith(".docx") || n.endsWith(".dotx")) && !neu.docx) toast.warning(`Die Word-Datei ist größer als ${VORLAGE_MAX_BYTES / 1_000_000} MB. Ihr Aufbau wird genutzt, ihr Design nicht. Bilder aus dem Textteil entfernen hilft.`);
    } catch (e) {
      toast.error(e instanceof UnsupportedFormatError ? "Dieses Format geht nicht als Vorlage. Möglich sind Word, PDF, Markdown und Text." : `Die Vorlage konnte nicht gelesen werden.${e instanceof Error ? " " + e.message : ""}`);
    } finally {
      setLiest(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="lbl text-[13px] font-semibold">Vorlage für Aufbau und Design (optional)</span>
      <input ref={ref} id={id} type="file" accept={VORLAGE_ACCEPT} className="sr-only" aria-label="Vorlage hochladen" onChange={(e) => { const f = e.target.files?.[0]; if (f) void hochladen(f); }} />
      {!v ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={liest} onClick={() => ref.current?.click()}><Upload />{liest ? "Wird gelesen …" : "Beispieldatei hochladen"}</Button>
          <Button variant="ghost" size="sm" onClick={() => onChange({ name: "", text: "# Titel\n\n## Abschnitt 1\n\n…", docx: "" })}>Aufbau selbst schreiben</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FileText aria-hidden="true" size={16} />
            <b className="text-sm">{v.name || "Eigener Aufbau"}</b>
            <span className="hint">{v.docx ? "Aufbau und Word-Design" : "Aufbau"}</span>
            <Button variant="outline" size="sm" disabled={liest} onClick={() => ref.current?.click()}><Upload />Ersetzen</Button>
            <Button variant="outline" size="icon-sm" aria-label="Vorlage entfernen" onClick={() => onChange(null)}><Trash /></Button>
          </div>
          <TextFld label="Aufbau, den die KI übernimmt" multiline rows={6} value={v.text} onChange={(t) => onChange({ ...v, text: t })}
            hint="Aus der Datei gelesen. Beispielinhalte dürfen stehen bleiben, die KI übernimmt nur Gliederung, Tabellen und Stil. Platzhalter wie [Kunde] machen es noch klarer." />
        </>
      )}
      <p className="hint" style={{ margin: 0 }}>
        {v?.docx
          ? datei === "docx" || datei === "wunsch" || step.format === "dateien"
            ? "Word-Dateien aus diesem Schritt bekommen Formatvorlagen, Seitenränder, Kopf- und Fußzeile (mit Logo) der Vorlage. Steht dort ein Absatz {{inhalt}}, kommt das Ergebnis genau dorthin; {{titel}} und {{datum}} werden ersetzt."
            : "Das Word-Design wirkt beim Herunterladen als Word-Datei. Stell dafür oben „Ergebnis als fertige Datei“ auf Word."
          : "Eine Beispieldatei (z. B. ein gutes altes Protokoll oder Angebot) gibt Gliederung, Tabellen und Tonfall vor. Mit einer Word-Datei übernimmt auch die erzeugte Word-Datei ihr Design."}
      </p>
    </div>
  );
}
