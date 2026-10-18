import { useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prüft eine exportierte Applikation (JSON) und macht daraus einen neuen, ungespeicherten Entwurf */
export function importEntwurf(text: string): Record<string, unknown> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Die Datei ist beschädigt oder keine exportierte Applikation."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("blocks" in raw || "steps" in raw)) throw new Error("Das ist keine exportierte Applikation. Erwartet wird eine Datei aus „Export / Import …“ im Baukasten.");
  // Neue App: eigene ID beim Speichern, wer importiert, wird Besitzer
  return { ...(raw as Record<string, unknown>), id: null, status: "entwurf", version: 0, geaendert: "", erstelltVon: "" };
}

/** „Aus Datei importieren“: öffnet eine exportierte Applikation als neuen Entwurf im Baukasten */
export function ImportKnopf({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const ref = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  return (
    <>
      <input ref={ref} type="file" accept=".json,application/json" className="sr-only" aria-label="Exportierte Applikation auswählen" tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { nav("/baukasten", { state: { entwurf: importEntwurf(await f.text()) }, viewTransition: true }); toast.success(`„${f.name}“ geöffnet. Prüfen und speichern.`); }
          catch (err) { toast.error(err instanceof Error ? err.message : "Import fehlgeschlagen."); }
        }} />
      <Button variant={variant} onClick={() => ref.current?.click()}><Upload aria-hidden="true" />Aus Datei importieren</Button>
    </>
  );
}
