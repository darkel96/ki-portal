/**
 * Zustellung eines Auftragsergebnisses: per E-Mail (Microsoft Graph, Mail.Send), als Teams-Nachricht an mich
 * selbst oder eine Person (Chat.ReadWrite, ChatMessage.Send) oder in einen Teams-Kanal über eine Webhook-Adresse
 * (Workflows „Beim Empfang einer Webhook-Anforderung in einem Kanal posten“). Ohne DOM, damit Browser und Hub-Dienst
 * dasselbe tun; wer aufruft, bringt den Graph-Aufruf samt Token mit.
 */
import type { Ziel } from "./meinhub";

export type ZustellTeil = { name: string; text: string; status: string; meldung?: string };
export type ZustellInhalt = { titel: string; appName: string; stand: "fertig" | "fehler" | "abgebrochen" | "test"; meldung?: string; teile: ZustellTeil[] };
/** Graph-Aufruf mit Token: Pfad wie „/v1.0/me/sendMail“ */
export type GraphRuf = (pfad: string, init?: { method?: string; body?: unknown }) => Promise<Response>;

const GRAPH = "https://graph.microsoft.com";
const SCOPES: Record<Ziel["art"], string[]> = { hub: [], email: ["Mail.Send"], teams: ["Chat.ReadWrite", "ChatMessage.Send"], sharepoint: [] };

export const istWebhook = (adresse: string) => /^https:\/\//i.test(adresse.trim());

/** Graph-Berechtigungen, die ein Ziel braucht (Webhook: keine) */
export function zustellScopes(ziel: Ziel): string[] {
  if (ziel.art === "teams" && istWebhook(ziel.adresse)) return [];
  return SCOPES[ziel.art].map((s) => `${GRAPH}/${s}`);
}

/** Kurzform für Listen und Hinweise („per E-Mail an mich“) */
export function zielText(ziel: Ziel): string {
  const an = ziel.adresse.trim();
  if (ziel.art === "email") return an ? `per E-Mail an ${an}` : "per E-Mail an mich";
  if (ziel.art === "teams") return istWebhook(an) ? "in einen Teams-Kanal (Webhook)" : an ? `als Teams-Nachricht an ${an}` : "als Teams-Nachricht an mich";
  if (ziel.art === "sharepoint") return "in einen SharePoint-Ordner";
  return "im Verlauf von Mein Hub";
}

/** Prüft die Adresse zum Ziel; gibt den Fehlertext zurück oder null */
export function zielPruefen(ziel: Ziel): string | null {
  const an = ziel.adresse.trim();
  if (!an || ziel.art === "hub") return null;
  if (ziel.art === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an) ? null : "Die E-Mail-Adresse sieht nicht vollständig aus.";
  if (ziel.art === "teams") return istWebhook(an) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an) ? null : "Für Teams brauchst du die E-Mail-Adresse einer Person oder die Webhook-Adresse (https://…) eines Kanals.";
  return null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Einfaches Markdown (Überschriften, Listen, Tabellen, fett, Links) in schlichtes HTML für Mail und Teams */
export function markdownSchlicht(md: string): string {
  const zeilen = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let liste: "ul" | "ol" | null = null, tabelle: string[][] | null = null, code: string[] | null = null, absatz: string[] = [];
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+(?: [^)\s]+)*)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/ /g, "%20")}">${t}</a>`);
  const absatzEnde = () => { if (absatz.length) { out.push(`<p>${absatz.map(inline).join("<br>")}</p>`); absatz = []; } };
  const listeEnde = () => { if (liste) { out.push(`</${liste}>`); liste = null; } };
  const tabelleEnde = () => {
    if (!tabelle) return;
    const [kopf, ...rest] = tabelle;
    out.push(`<table border="1" cellpadding="4" style="border-collapse:collapse">` +
      (kopf ? `<tr>${kopf.map((z) => `<th align="left">${inline(z)}</th>`).join("")}</tr>` : "") +
      rest.map((r) => `<tr>${r.map((z) => `<td>${inline(z)}</td>`).join("")}</tr>`).join("") + "</table>");
    tabelle = null;
  };
  for (const z of zeilen) {
    if (code) { if (/^```/.test(z)) { out.push(`<pre>${esc(code.join("\n"))}</pre>`); code = null; } else code.push(z); continue; }
    if (/^```/.test(z)) { absatzEnde(); listeEnde(); tabelleEnde(); code = []; continue; }
    const t = z.trim();
    if (/^\|.*\|$/.test(t)) {
      absatzEnde(); listeEnde();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(t)) continue;
      (tabelle ??= []).push(t.slice(1, -1).split("|").map((s) => s.trim()));
      continue;
    }
    tabelleEnde();
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { absatzEnde(); listeEnde(); out.push(`<p><b>${inline(h[2]!)}</b></p>`); continue; }
    const li = /^[-*•]\s+(.*)$/.exec(t), oli = /^\d+[.)]\s+(.*)$/.exec(t);
    if (li || oli) {
      absatzEnde();
      const art = li ? "ul" : "ol";
      if (liste !== art) { listeEnde(); out.push(`<${art}>`); liste = art; }
      out.push(`<li>${inline((li ?? oli)![1]!)}</li>`);
      continue;
    }
    if (!t) { absatzEnde(); listeEnde(); continue; }
    listeEnde();
    absatz.push(t);
  }
  absatzEnde(); listeEnde(); tabelleEnde();
  if (code) out.push(`<pre>${esc(code.join("\n"))}</pre>`);
  return out.join("");
}

const standText = (i: ZustellInhalt) => i.stand === "fertig" ? "Fertig" : i.stand === "fehler" ? `Fehler: ${i.meldung ?? ""}` : i.stand === "test" ? "Testnachricht" : "Abgebrochen";

/** Ergebnis als HTML (E-Mail und Teams-Chat) */
export function ergebnisHtml(i: ZustellInhalt): string {
  const teile = i.teile.map((t) => {
    const inhalt = t.status === "fertig" ? markdownSchlicht(t.text) : `<p><i>(${esc(t.status)}${t.meldung ? `: ${esc(t.meldung)}` : ""})</i></p>`;
    return `<h2 style="font:600 16px Segoe UI,Arial,sans-serif;margin:20px 0 6px">${esc(t.name)}</h2><div style="font:14px/1.5 Segoe UI,Arial,sans-serif">${inhalt}</div>`;
  }).join("");
  return `<div style="font:14px Segoe UI,Arial,sans-serif;color:#1f2328"><p><b>${esc(i.titel)}</b> · ${esc(i.appName)} · ${esc(standText(i))}</p>${teile}<p style="margin-top:24px;color:#6b7280">Automatisch erstellt vom KI-Hub. Das Ergebnis liegt auch im Verlauf von Mein Hub.</p></div>`;
}

/** Ergebnis als Markdown für eine Adaptive Card (Teams-Webhook): Überschriften fett, auf 8.000 Zeichen begrenzt */
export function ergebnisMarkdown(i: ZustellInhalt): string {
  const teile = i.teile.map((t) => `**${t.name}**\n\n${t.status === "fertig" ? t.text.replace(/^#{1,6}\s+(.*)$/gm, "**$1**") : `_(${t.status}${t.meldung ? `: ${t.meldung}` : ""})_`}`).join("\n\n");
  const ganz = `**${i.titel}** · ${i.appName} · ${standText(i)}\n\n${teile}`;
  return ganz.length > 8000 ? `${ganz.slice(0, 7900)}\n\n_(gekürzt; vollständig im Verlauf von Mein Hub)_` : ganz;
}

type GraphPerson = { id?: string; mail?: string | null; userPrincipalName?: string };
type GraphChat = { id: string; chatType?: string; webUrl?: string; members?: { email?: string | null; userId?: string | null }[] };

async function fehlerText(r: Response, was: string): Promise<string> {
  const t = await r.text().catch(() => "");
  const code = /"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
  const grund = r.status === 403 ? " Vermutlich fehlt die Berechtigung oder die Zustimmung dazu." : r.status === 401 ? " Die Anmeldung wurde nicht akzeptiert." : "";
  return `${was}: Graph antwortet mit Fehler ${r.status}${code ? ` (${code})` : ""}.${grund}`;
}
async function graphJson<T>(graph: GraphRuf, pfad: string, was: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await graph(pfad, init);
  if (!r.ok) throw new Error(await fehlerText(r, was));
  if (r.status === 202 || r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

const gleich = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Stellt das Ergebnis zu und gibt einen Satz für den Verlauf zurück („Per E-Mail an … gesendet.“).
 * `graph` ruft Microsoft Graph mit Token auf (Browser: graphToken, Dienst: gespeicherte Anmeldung).
 */
export async function zustellen(ziel: Ziel, inhalt: ZustellInhalt, graph: GraphRuf): Promise<string> {
  const adresse = ziel.adresse.trim();
  const betreff = `KI-Hub: ${inhalt.titel}`;
  if (ziel.art === "hub") return "";
  if (ziel.art === "sharepoint") throw new Error("Die Ablage in einen SharePoint-Ordner gibt es noch nicht.");
  if (ziel.art === "email") {
    let an = adresse;
    if (!an) { const ich = await graphJson<GraphPerson>(graph, "/v1.0/me?$select=id,mail,userPrincipalName", "E-Mail"); an = ich.mail || ich.userPrincipalName || ""; }
    if (!an) throw new Error("Keine E-Mail-Adresse für den Versand bekannt.");
    await graphJson(graph, "/v1.0/me/sendMail", "E-Mail senden", { method: "POST", body: { message: { subject: betreff, body: { contentType: "HTML", content: ergebnisHtml(inhalt) }, toRecipients: [{ emailAddress: { address: an } }] }, saveToSentItems: false } });
    return `Per E-Mail an ${an} gesendet.`;
  }
  // Teams
  if (istWebhook(adresse)) {
    const r = await fetch(adresse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
        body: [{ type: "TextBlock", text: ergebnisMarkdown(inhalt), wrap: true }],
      } }],
    }) });
    if (!r.ok) throw new Error(`Der Teams-Kanal hat die Nachricht nicht angenommen (Fehler ${r.status}). Stimmt die Webhook-Adresse noch?`);
    return "In den Teams-Kanal gepostet.";
  }
  const ich = await graphJson<GraphPerson>(graph, "/v1.0/me?$select=id,mail,userPrincipalName", "Teams");
  const meine = [ich.mail, ich.userPrincipalName].filter(Boolean) as string[];
  const anMich = !adresse || meine.some((m) => gleich(m, adresse));
  let chatId: string;
  let chatUrl = "";
  if (anMich) {
    // Der Chat mit sich selbst lässt sich über Graph nicht anlegen, nur finden. Er hat die feste Kennung „48:notes“
    // (ältere Mandanten: die eigene Benutzer-ID zweimal in der ID). Erst direkt abfragen, sonst die Chatliste seitenweise
    // durchgehen (höchstens 50 je Seite, ohne Reihenfolge). Ein Chat mit nur einem Mitglied reicht nicht als Kennzeichen:
    // Den gibt es auch mit Personen, die das Unternehmen verlassen haben.
    const kennung = `${ich.id}_${ich.id}`;
    const istSelbst = (c: GraphChat) => c.id === "48:notes" || c.id.includes(kennung);
    let selbst: GraphChat | undefined;
    for (const id of ["48:notes", `19:${kennung}@unq.gbl.spaces`]) {
      if (selbst) break;
      try { selbst = await graphJson<GraphChat>(graph, `/v1.0/me/chats/${encodeURIComponent(id)}`, "Teams"); } catch { /* nicht vorhanden: weiter */ }
    }
    let pfad: string | null = selbst ? null : "/v1.0/me/chats?$filter=chatType eq 'oneOnOne'&$top=50";
    for (let seite = 0; pfad && !selbst && seite < 40; seite++) {
      const chats: { value: GraphChat[]; "@odata.nextLink"?: string } = await graphJson(graph, pfad, "Teams");
      selbst = chats.value.find(istSelbst);
      pfad = chats["@odata.nextLink"] ? chats["@odata.nextLink"].replace(/^https:\/\/graph\.microsoft\.com/, "") : null;
    }
    if (!selbst) throw new Error("Den Teams-Chat mit dir selbst gibt es noch nicht. Öffne ihn einmal in Teams (deinen Namen in der Suche wählen, eine Nachricht an dich schicken), dann klappt die Zustellung.");
    chatId = selbst.id;
    chatUrl = selbst.webUrl ?? "";
  } else {
    const chat = await graphJson<GraphChat>(graph, "/v1.0/chats", "Teams-Chat anlegen", { method: "POST", body: {
      chatType: "oneOnOne",
      members: [
        { "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `${GRAPH}/v1.0/users('${ich.id}')` },
        { "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `${GRAPH}/v1.0/users('${encodeURIComponent(adresse)}')` },
      ],
    } });
    chatId = chat.id;
  }
  await graphJson(graph, `/v1.0/chats/${encodeURIComponent(chatId)}/messages`, "Teams-Nachricht senden", { method: "POST", body: { body: { contentType: "html", content: ergebnisHtml(inhalt) } } });
  return anMich ? `Als Teams-Nachricht an dich gesendet${chatUrl ? ` (Chat: ${chatUrl})` : ""}.` : `Als Teams-Nachricht an ${adresse} gesendet.`;
}
