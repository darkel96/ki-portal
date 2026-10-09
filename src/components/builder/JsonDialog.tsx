import { useState } from "react";
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
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setText(JSON.stringify(b.app, null, 2)); setFehler(""); } }}>
      <DialogTrigger asChild><Button variant="ghost">Als Datei</Button></DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Applikation als JSON</DialogTitle>
          <DialogDescription>Kopieren oder speichern, um die Applikation weiterzugeben. Oder eine bearbeitete Fassung einfügen und übernehmen.</DialogDescription>
        </DialogHeader>
        <label htmlFor="json-text" className="sr-only">JSON der Applikation</label>
        <Textarea id="json-text" rows={16} className="mono-ta max-h-[55vh]" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!fehler || undefined} aria-describedby={fehler ? "json-fehler" : undefined} />
        {fehler && <p id="json-fehler" role="alert" className="text-sm text-destructive">{fehler}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success("In die Zwischenablage kopiert."))}>Kopieren</Button>
            <Button variant="outline" onClick={() => saveFile(`${slug(b.app.name)}.json`, text, "application/json")}>Als Datei speichern</Button>
          </div>
          <Button onClick={() => {
            let raw: unknown;
            try { raw = JSON.parse(text); } catch (e) { setFehler(`Das ist kein gültiges JSON: ${e instanceof Error ? e.message : ""}`); return; }
            const next = sanitizeApp(raw, b.app);
            b.replace(next);
            b.setSel(null);
            setOpen(false);
            toast.success("JSON übernommen. Mit Rückgängig kommst du zur vorherigen Fassung zurück.");
          }}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
