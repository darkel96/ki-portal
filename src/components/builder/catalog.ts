import {
  Square, Columns2, FileText, MoveVertical, Minus, Heading, Pilcrow, Info, Image, Type, TextAlignStart, ChevronDown, CircleDot,
  SquareCheck, Hash, Calendar, Upload, Play, Sparkles, type LucideIcon,
} from "lucide-react";
import type { BlockType } from "@/lib/schema";

export const BT: Record<BlockType, { label: string; icon: LucideIcon; group: "Layout" | "Inhalt" | "Eingaben" | "KI" | "Seite" }> = {
  seite: { label: "Seite", icon: FileText, group: "Seite" },
  section: { label: "Bereich", icon: Square, group: "Layout" },
  columns: { label: "Spalten", icon: Columns2, group: "Layout" },
  spacer: { label: "Abstand", icon: MoveVertical, group: "Layout" },
  divider: { label: "Trennlinie", icon: Minus, group: "Layout" },
  heading: { label: "Überschrift", icon: Heading, group: "Inhalt" },
  text: { label: "Text", icon: Pilcrow, group: "Inhalt" },
  callout: { label: "Hinweis", icon: Info, group: "Inhalt" },
  image: { label: "Bild / Logo", icon: Image, group: "Inhalt" },
  input: { label: "Textzeile", icon: Type, group: "Eingaben" },
  textarea: { label: "Textfeld", icon: TextAlignStart, group: "Eingaben" },
  select: { label: "Auswahlliste", icon: ChevronDown, group: "Eingaben" },
  radio: { label: "Auswahlknöpfe", icon: CircleDot, group: "Eingaben" },
  checkbox: { label: "Ankreuzfeld", icon: SquareCheck, group: "Eingaben" },
  number: { label: "Zahl", icon: Hash, group: "Eingaben" },
  date: { label: "Datum", icon: Calendar, group: "Eingaben" },
  file: { label: "Datei", icon: Upload, group: "Eingaben" },
  button: { label: "KI-Button", icon: Play, group: "KI" },
  output: { label: "Ergebnis", icon: Sparkles, group: "KI" },
};
export const GROUPS = ["Layout", "Inhalt", "Eingaben", "KI"] as const;
