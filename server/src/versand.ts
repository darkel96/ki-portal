/** Ergebnis eines Auftrags an sein Ziel bringen: E-Mail über Microsoft Graph (Berechtigung Mail.Send). */
import { KI_CONFIG } from "@/lib/ki/config";
import { emailVon, graphTokenFuer } from "./anmeldung";
import type { DienstLauf } from "./laeufe";
import type { DateiSpeicher } from "./speicher";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function ergebnisHtml(l: DienstLauf): string {
  const teile = l.app.steps.filter((s) => l.outs[s.id]).map((s) => {
    const o = l.outs[s.id]!;
    const text = o.status === "fertig" ? o.text ?? "" : `(${o.status}${o.meldung ? `: ${o.meldung}` : ""})`;
    return `<h2 style="font:600 16px Segoe UI,Arial,sans-serif;margin:20px 0 6px">${esc(s.name)}</h2><pre style="font:13px/1.5 Segoe UI,Arial,sans-serif;white-space:pre-wrap;margin:0">${esc(text)}</pre>`;
  }).join("");
  const stand = l.status === "fertig" ? "Fertig" : l.status === "fehler" ? `Fehler: ${l.meldung}` : "Abgebrochen";
  return `<div style="font:14px Segoe UI,Arial,sans-serif;color:#1f2328"><p><b>${esc(l.titel)}</b> · ${esc(l.appName)} · ${stand}</p>${teile}<p style="margin-top:24px;color:#6b7280">Automatisch erstellt vom KI-Hub. Das Ergebnis liegt auch im Verlauf von Mein Hub.</p></div>`;
}

export async function perEmail(speicher: DateiSpeicher, l: DienstLauf): Promise<void> {
  const an = l.ziel?.adresse?.trim() || (await emailVon(speicher, l.nutzer));
  if (!an) throw new Error("Keine E-Mail-Adresse für den Versand bekannt.");
  const token = await graphTokenFuer(speicher, l.nutzer);
  const r = await fetch(`${KI_CONFIG.graph}/v1.0/me/sendMail`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: { subject: `KI-Hub: ${l.titel}`, body: { contentType: "HTML", content: ergebnisHtml(l) }, toRecipients: [{ emailAddress: { address: an } }] }, saveToSentItems: false }),
  });
  if (!r.ok) throw new Error(`E-Mail konnte nicht gesendet werden (${r.status}). ${r.status === 403 ? "Fehlt die Berechtigung Mail.Send?" : ""}`.trim());
}
