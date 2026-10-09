import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export function Fld({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="fld">
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <span className="lbl">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextFld({ label, value, onChange, placeholder, hint, multiline, rows = 3, mono, id: idIn, inputRef }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; multiline?: boolean; rows?: number; mono?: boolean; id?: string;
  inputRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
}) {
  const auto = useId();
  const id = idIn ?? auto;
  return (
    <Fld label={label} hint={hint} htmlFor={id}>
      {multiline
        ? <Textarea id={id} ref={inputRef as React.Ref<HTMLTextAreaElement>} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={mono ? "mono-ta" : undefined} />
        : <Input id={id} ref={inputRef as React.Ref<HTMLInputElement>} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={mono ? "font-mono text-[13px]" : undefined} />}
    </Fld>
  );
}

export function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <Fld label={label}>
      <ToggleGroup type="single" variant="outline" size="sm" value={String(value)} aria-label={label}
        onValueChange={(v) => { if (!v) return; const o = options.find(([k]) => String(k) === v); if (o) onChange(o[0]); }} className="flex-wrap justify-start">
        {options.map(([k, t]) => <ToggleGroupItem key={String(k)} value={String(k)} className="rounded-full px-3 text-[13px]">{t}</ToggleGroupItem>)}
      </ToggleGroup>
    </Fld>
  );
}

export function Sel<T extends string>({ label, value, options, onChange, id: idIn }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; id?: string }) {
  const auto = useId();
  const id = idIn ?? auto;
  return (
    <Fld label={label} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([k, t]) => <SelectItem key={k} value={k}>{t}</SelectItem>)}</SelectContent>
      </Select>
    </Fld>
  );
}

export function Check({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="font-normal leading-snug">{label}{hint && <span className="hint block">{hint}</span>}</Label>
    </div>
  );
}

const ACCENTS = ["", "#0060ff", "#004ccc", "#001c4c", "#4c8fff", "#fe8623", "#fec037", "#5c5a58", "#00050d", "#c4281c"];
const BGS = ["", "#ffffff", "#fbfaf9", "#f5f3f1", "#f0eeea", "#e5efff", "#fffcea", "#001c4c", "#00050d"];
const TEXTS = ["", "#00050d", "#5c5a58", "#0060ff", "#001c4c", "#a64b00", "#c4281c", "#ffffff"];
export const PALETTES = { akzent: ACCENTS, grund: BGS, text: TEXTS };

export function Swatches({ label, value, colors, onChange }: { label: string; value: string; colors: string[]; onChange: (v: string) => void }) {
  return (
    <Fld label={label}>
      <div className="sws" role="group" aria-label={label}>
        {colors.map((c) => (
          <button key={c || "std"} type="button" className={`sw ${c ? "" : "sw-def"}`} aria-pressed={(value || "") === c} aria-label={c ? `Farbe ${c}` : "Standardfarbe"} title={c || "Standard"} style={c ? { background: c } : undefined} onClick={() => onChange(c)} />
        ))}
        <label className="sw-pick" title="Eigene Farbe">
          <span className="sr-only">Eigene Farbe für {label}</span>
          <span aria-hidden="true">+</span>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </Fld>
  );
}
