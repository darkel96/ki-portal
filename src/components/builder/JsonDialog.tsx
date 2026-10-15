import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { sanitizeApp } from "@/lib/sanitize";
import { saveFile } from "@/lib/files";
import { slug } from "@/lib/model";
import type { Builder } from "./useBuilder";

export function JsonDialog({ b }: { b: Builder }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState("");
  const datei = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setText(JSON.stringify(b.app, null, 2)); setFehler(""); } }}>
      <DialogTrigger asChild><Button variant="ghost">Exportieren / Importieren …</Button></DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Applikation exportieren oder einfügen (für Fachleute)</DialogTitle>
          <DialogDescription>Kopieren oder speichern, um die Applikation weiterzugeben. Oder eine bearbeitete Fassung einfügen und übernehmen.</DialogDescription>
        </DialogHeader>
        <label htmlFor="json-text" className="sr-only">JSON der Applikation</label>
        <Textarea id="json-text" rows={16} className="mono-ta max-h-[55vh]" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!fehler || undefined} aria-describedby={fehler ? "json-fehler" : undefined} />
        {fehler && <p id="json-fehler" role="alert" className="text-sm text-destructive">{fehler}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => {
              if (!navigator.clipboard) { toast.error("Kopieren geht hier nicht. Markier den Text und kopier ihn mit Strg+C."); return; }
              navigator.clipboard.writeText(text).then(() => toast.success("In die Zwischenablage kopiert."))
                .catch(() => toast.error("Kopieren ist fehlgeschlagen. Markier den Text und kopier ihn mit Strg+C."));
            }}>Kopieren</Button>
            <Button variant="outline" onClick={() => saveFile(`${slug(b.app.name)}.json`, text, "application/json")}>Als Datei speichern</Button>
            <input ref={datei} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Exportierte Applikation auswählen"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setText(await f.text()); setFehler(""); toast.info(`„${f.name}“ geladen. Mit „Übernehmen“ ersetzt sie diese Applikation.`); } }} />
            <Button variant="outline" onClick={() => datei.current?.click()}>Datei öffnen …</Button>
          </div>
          <Button onClick={() => {
            let raw: unknown;
            try { raw = JSON.parse(text); } catch { setFehler("Der Text ist beschädigt oder unvollständig. Füg die exportierte Fassung unverändert ein."); return; }
            // „123“ oder „[]“ sind gültiges JSON, aber keine Applikation.
            if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("blocks" in raw || "steps" in raw || "name" in raw)) { setFehler("Das ist keine exportierte Applikation. Erwartet wird ein Objekt mit name, blocks und steps."); return; }
            const next = sanitizeApp(raw, b.app);
            b.replace(next);
            b.setSel(null);
            setOpen(false);
            toast.success("Fassung übernommen. Mit Rückgängig kommst du zur vorherigen zurück.");
          }}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
