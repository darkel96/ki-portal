import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { kiModus } from "@/lib/ki";
import { apiSchluessel, apiSchluesselGemerkt, apiSchluesselSetzen } from "@/lib/ki/claudeApi";

const EREIGNIS = "kihub-ki-modus";
const abonnieren = (cb: () => void) => { window.addEventListener(EREIGNIS, cb); window.addEventListener("storage", cb); return () => { window.removeEventListener(EREIGNIS, cb); window.removeEventListener("storage", cb); }; };

/** Aktueller KI-Modus; aktualisiert sich, sobald ein API-Schlüssel eingetragen oder entfernt wird. */
export const useKiModus = () => useSyncExternalStore(abonnieren, kiModus, kiModus);

/** Eigener Anthropic-API-Schlüssel für die öffentliche Testseite. */
export function KiSchluessel() {
  const [wert, setWert] = useState("");
  const [merken, setMerken] = useState(true);
  const vorhanden = !!apiSchluessel();
  const speichern = () => {
    if (!/^sk-ant-/.test(wert.trim())) { toast.error("Das sieht nicht nach einem Anthropic-API-Schlüssel aus (beginnt mit „sk-ant-“)."); return; }
    apiSchluesselSetzen(wert, merken);
    setWert("");
    window.dispatchEvent(new Event(EREIGNIS));
    toast.success("Claude ist verbunden. KI-Schritte laufen jetzt über deinen Schlüssel.");
  };
  const entfernen = () => {
    apiSchluesselSetzen("", false);
    window.dispatchEvent(new Event(EREIGNIS));
    toast.success("Schlüssel entfernt. Der Hub läuft wieder als Simulation.");
  };
  if (vorhanden) return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <p className="text-muted-foreground">Dein Schlüssel ist {apiSchluesselGemerkt() ? "in diesem Browser gespeichert" : "nur für diese Sitzung hinterlegt"}. Anfragen gehen direkt an Anthropic und werden über dein Konto abgerechnet.</p>
      <div><Button size="sm" variant="outline" className="rounded-full" onClick={entfernen}>Schlüssel entfernen</Button></div>
    </div>
  );
  return (
    <form className="mt-3 flex flex-col gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); speichern(); }}>
      <p className="font-semibold">Mit Claude testen</p>
      <p className="text-muted-foreground">Trag deinen eigenen Anthropic-API-Schlüssel ein (aus console.anthropic.com). Er bleibt in diesem Browser und geht nur an Anthropic; die Kosten laufen über dein Konto.</p>
      <label htmlFor="ki-schluessel" className="sr-only">Anthropic-API-Schlüssel</label>
      <Input id="ki-schluessel" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={wert} onChange={(e) => setWert(e.target.value)} />
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox checked={merken} onCheckedChange={(v) => setMerken(v === true)} />
        In diesem Browser merken (sonst nur bis zum Schließen)
      </label>
      <div><Button size="sm" type="submit" className="rounded-full" disabled={!wert.trim()}>Verbinden</Button></div>
      <p className="text-[12px] text-muted-foreground">Nur für Tests. Auf gemeinsam genutzten Rechnern den Schlüssel nicht merken.</p>
    </form>
  );
}
