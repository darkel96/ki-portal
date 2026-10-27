import { Loader2 } from "lucide-react";

/**
 * Knopf- oder Statustext, solange etwas läuft: drehendes Zeichen plus Text („Sucht …“), damit man sieht, dass noch
 * gearbeitet wird. Bei reduzierter Bewegung steht das Zeichen still.
 */
export function Arbeitet({ text }: { text: string }) {
  return (
    <span className="arbeitet">
      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {text}&nbsp;…
    </span>
  );
}
