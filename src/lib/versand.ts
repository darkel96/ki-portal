/**
 * Zustellung eines Auftragsergebnisses: per E-Mail (Microsoft Graph, Mail.Send), als Teams-Nachricht an mich
 * selbst oder eine Person (Chat.ReadWrite, ChatMessage.Send) oder in einen Teams-Kanal über eine Webhook-Adresse
 * (Workflows „Beim Empfang einer Webhook-Anforderung in einem Kanal posten“). Ohne DOM, damit Browser und Hub-Dienst
 * dasselbe tun; wer aufruft, bringt den Graph-Aufruf samt Token mit.
 */
import type { Ziel } from "./meinhub";
import { diagrammQuelle } from "./diagrammquelle";
import { linksBenennen } from "./verweise";

export type ZustellTeil = { name: string; text: string; status: string; meldung?: string };
export type ZustellInhalt = { titel: string; appName: string; stand: "fertig" | "fehler" | "abgebrochen" | "test"; meldung?: string; teile: ZustellTeil[] };
/** Diagramm als PNG (Base64) mit seiner Größe in Pixeln (ohne Vergrößerung) */
export type DiagrammBild = { png: string; breite: number; hoehe: number };
/** Zeichnet ein Diagramm aus seinem Quelltext; null oder Fehler = als Quelltext zustellen */
export type DiagrammMaler = (code: string, art: "mermaid" | "svg") => Promise<DiagrammBild | null>;
/** Gibt für einen Codeblock das HTML eines Bildes zurück, oder null für den Quelltext */
type BildHtml = (sprache: string, code: string) => string | null;
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
export function markdownSchlicht(md: string, bild?: BildHtml): string {
  const zeilen = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let liste: "ul" | "ol" | null = null, tabelle: string[][] | null = null, code: string[] | null = null, absatz: string[] = [], sprache = "";
  const codeEnde = (c: string[]) => out.push(bild?.(sprache, c.join("\n")) ?? `<pre>${esc(c.join("\n"))}</pre>`);
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
    if (code) { if (/^```/.test(z)) { codeEnde(code); code = null; } else code.push(z); continue; }
    if (/^```/.test(z)) { absatzEnde(); listeEnde(); tabelleEnde(); code = []; sprache = /^```\s*([\w-]*)/.exec(z)?.[1]?.toLowerCase() ?? ""; continue; }
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
  if (code) codeEnde(code);
  return out.join("");
}

const standText = (i: ZustellInhalt) => i.stand === "fertig" ? "Fertig" : i.stand === "fehler" ? `Fehler: ${i.meldung ?? ""}` : i.stand === "test" ? "Testnachricht" : "Abgebrochen";

/** Ergebnis als HTML (E-Mail und Teams-Chat) */
export function ergebnisHtml(i: ZustellInhalt, bild?: BildHtml): string {
  const teile = i.teile.map((t) => {
    // Jeder Link mit sprechendem Text, auch nackte Adressen (in Outlook sonst lange Kennungen)
    const inhalt = t.status === "fertig" ? markdownSchlicht(linksBenennen(t.text), bild) : `<p><i>(${esc(t.status)}${t.meldung ? `: ${esc(t.meldung)}` : ""})</i></p>`;
    return `<h2 style="font:600 16px Segoe UI,Arial,sans-serif;margin:20px 0 6px">${esc(t.name)}</h2><div style="font:14px/1.5 Segoe UI,Arial,sans-serif">${inhalt}</div>`;
  }).join("");
  return `<div style="font:14px Segoe UI,Arial,sans-serif;color:#1f2328"><p><b>${esc(i.titel)}</b> · ${esc(i.appName)} · ${esc(standText(i))}</p>${teile}<p style="margin-top:24px;color:#6b7280">Automatisch erstellt vom KI-Hub. Das Ergebnis liegt auch im Verlauf von Mein Hub.</p></div>`;
}

/** Ergebnis als Markdown für eine Adaptive Card (Teams-Webhook): Überschriften fett, auf 8.000 Zeichen begrenzt */
export function ergebnisMarkdown(i: ZustellInhalt): string {
  // Adaptive Cards zeigen keine Diagramme: statt des Quelltexts ein Hinweis
  const ohneDiagramme = (text: string) => text.replace(/^```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (ganz, sprache: string, code: string) => {
    const q = diagrammQuelle(sprache.toLowerCase(), code.replace(/\n$/, ""));
    return q && q.art !== "drawio" ? "_(Diagramm: im Verlauf von Mein Hub als Bild)_" : ganz;
  });
  const teile = i.teile.map((t) => `**${t.name}**\n\n${t.status === "fertig" ? ohneDiagramme(linksBenennen(t.text)).replace(/^#{1,6}\s+(.*)$/gm, "**$1**") : `_(${t.status}${t.meldung ? `: ${t.meldung}` : ""})_`}`).join("\n\n");
  const ganz = `**${i.titel}** · ${i.appName} · ${standText(i)}\n\n${teile}`;
  return ganz.length > 8000 ? `${ganz.slice(0, 7900)}\n\n_(gekürzt; vollständig im Verlauf von Mein Hub)_` : ganz;
}

type GraphPerson = { id?: string; mail?: string | null; userPrincipalName?: string };
type GraphChat = { id: string; chatType?: string; webUrl?: string; members?: { email?: string | null; userId?: string | null }[]; lastMessagePreview?: { createdDateTime?: string } | null };

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

/** Diagramme (Mermaid, SVG) aus den fertigen Teilen, je Quelltext einmal; höchstens 8 und zusammen etwa 3 MB */
type Bild = DiagrammBild & { nr: number };
async function bilderMalen(inhalt: ZustellInhalt, maler: DiagrammMaler): Promise<Map<string, Bild>> {
  const bilder = new Map<string, Bild>();
  let summe = 0;
  for (const t of inhalt.teile) {
    if (t.status !== "fertig") continue;
    for (const [, sprache = "", roh = ""] of t.text.replace(/\r\n?/g, "\n").matchAll(/^```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm)) {
      const q = diagrammQuelle(sprache.toLowerCase(), roh.replace(/\n$/, ""));
      if (!q || q.art === "drawio") continue;
      const schluessel = `${q.art}\n${q.code}`;
      if (bilder.has(schluessel) || bilder.size >= 8) continue;
      try {
        const b = await maler(q.code, q.art);
        if (!b || summe + b.png.length > 3_000_000) continue;
        summe += b.png.length;
        bilder.set(schluessel, { ...b, nr: bilder.size + 1 });
      } catch (e) { console.warn("[Zustellung] Diagramm nicht gezeichnet:", e instanceof Error ? e.message : e); }
    }
  }
  return bilder;
}
/** HTML für ein gezeichnetes Diagramm; Breite höchstens 640 px, damit es in Outlook und Teams ohne Rollen passt */
function bildHtml(bilder: Map<string, Bild>, quelle: (b: Bild) => string): BildHtml {
  return (sprache, code) => {
    const q = diagrammQuelle(sprache, code);
    const b = q && q.art !== "drawio" ? bilder.get(`${q.art}\n${q.code}`) : undefined;
    if (!b) return null;
    const breite = Math.min(b.breite, 640), hoehe = Math.round((b.hoehe * breite) / Math.max(1, b.breite));
    return `<p><img src="${quelle(b)}" width="${breite}" height="${hoehe}" alt="Diagramm" style="max-width:100%;height:auto"></p>`;
  };
}

const gleich = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Stellt das Ergebnis zu und gibt einen Satz für den Verlauf zurück („Per E-Mail an … gesendet.“).
 * `graph` ruft Microsoft Graph mit Token auf (Browser: graphToken, Dienst: gespeicherte Anmeldung).
 */
export async function zustellen(ziel: Ziel, inhalt: ZustellInhalt, graph: GraphRuf, maler?: DiagrammMaler): Promise<string> {
  const adresse = ziel.adresse.trim();
  const betreff = `KI-Hub: ${inhalt.titel}`;
  if (ziel.art === "hub") return "";
  if (ziel.art === "sharepoint") throw new Error("Die Ablage in einen SharePoint-Ordner gibt es noch nicht.");
  // Diagramme als Bild: Mail als eingebetteter Anhang (cid), Teams-Chat als gehosteter Inhalt; Webhook-Karten zeigen nur Text
  const bilder = maler && (ziel.art === "email" || !istWebhook(adresse)) ? await bilderMalen(inhalt, maler) : new Map<string, Bild>();
  const ohneBilderHinweis = (e: unknown) => ` Die Diagramme kamen als Quelltext, weil Microsoft die Bilder abgelehnt hat (${(e instanceof Error ? e.message : String(e)).slice(0, 160)}).`;
  if (ziel.art === "email") {
    let an = adresse;
    if (!an) { const ich = await graphJson<GraphPerson>(graph, "/v1.0/me?$select=id,mail,userPrincipalName", "E-Mail"); an = ich.mail || ich.userPrincipalName || ""; }
    if (!an) throw new Error("Keine E-Mail-Adresse für den Versand bekannt.");
    const nachricht = (mitBildern: boolean) => ({ message: {
      subject: betreff,
      body: { contentType: "HTML", content: ergebnisHtml(inhalt, mitBildern ? bildHtml(bilder, (b) => `cid:diagramm${b.nr}`) : undefined) },
      toRecipients: [{ emailAddress: { address: an } }],
      ...(mitBildern ? { attachments: [...bilder.values()].map((b) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: `Diagramm ${b.nr}.png`, contentType: "image/png", contentBytes: b.png, isInline: true, contentId: `diagramm${b.nr}` })) } : {}),
    }, saveToSentItems: false });
    let hinweis = "";
    try { await graphJson(graph, "/v1.0/me/sendMail", "E-Mail senden", { method: "POST", body: nachricht(bilder.size > 0) }); }
    catch (e) {
      if (!bilder.size) throw e;
      await graphJson(graph, "/v1.0/me/sendMail", "E-Mail senden", { method: "POST", body: nachricht(false) });
      hinweis = ohneBilderHinweis(e);
    }
    return `Per E-Mail an ${an} gesendet.${hinweis}`;
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
    // Der Chat mit sich selbst: je nach Mandant unter der festen Kennung „48:notes“ erreichbar, unter einer ID mit der
    // eigenen Benutzer-ID zweimal, oder nur über die Chatliste (höchstens 50 je Seite, ohne Reihenfolge) als Einzelchat,
    // dessen einziges Mitglied man selbst ist. Jeder Versuch wird vermerkt, damit die Fehlermeldung sagt, was Graph geantwortet hat.
    const kennung = `${ich.id}_${ich.id}`;
    const versuche: string[] = [];
    const fehlerKurz = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Teams[^:]*: /, "").slice(0, 120);
    let selbst: GraphChat | undefined;
    for (const id of ["48:notes", `19:${kennung}@unq.gbl.spaces`]) {
      if (selbst) break;
      try { selbst = await graphJson<GraphChat>(graph, `/v1.0/me/chats/${encodeURIComponent(id)}`, "Teams"); } catch (e) { versuche.push(`${id}: ${fehlerKurz(e)}`); }
    }
    if (!selbst) {
      // Manche Mandanten liefern den Chat mit sich selbst beim Anlegen eines Einzelchats mit sich selbst
      try {
        selbst = await graphJson<GraphChat>(graph, "/v1.0/chats", "Teams", { method: "POST", body: { chatType: "oneOnOne", members: [
          { "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `${GRAPH}/v1.0/users('${ich.id}')` },
          { "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `${GRAPH}/v1.0/users('${ich.id}')` },
        ] } });
      } catch (e) { versuche.push(`Anlegen: ${fehlerKurz(e)}`); }
    }
    let gesehen = 0;
    const kandidaten: GraphChat[] = [];
    let pfad: string | null = selbst ? null : "/v1.0/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members,lastMessagePreview&$top=50";
    for (let seite = 0; pfad && !selbst && seite < 40; seite++) {
      const chats: { value: GraphChat[]; "@odata.nextLink"?: string } = await graphJson(graph, pfad, "Teams");
      gesehen += chats.value.length;
      selbst = chats.value.find((c) => c.id === "48:notes" || c.id.includes(kennung));
      // Einzelchats, deren einziges Mitglied man selbst ist: der Chat mit sich selbst, aber auch alte Chats mit
      // Personen, die das Unternehmen verlassen haben; deshalb erst am Ende der jüngste davon
      kandidaten.push(...chats.value.filter((c) => (c.members ?? []).length === 1 && (c.members ?? []).every((m) => gleich(m.userId, ich.id) || meine.some((x) => gleich(x, m.email)))));
      pfad = chats["@odata.nextLink"] ? chats["@odata.nextLink"].replace(/^https:\/\/graph\.microsoft\.com/, "") : null;
    }
    if (!selbst && kandidaten.length) selbst = [...kandidaten].sort((x, y) => (y.lastMessagePreview?.createdDateTime ?? "").localeCompare(x.lastMessagePreview?.createdDateTime ?? ""))[0];
    if (!selbst) throw new Error(`Den Teams-Chat mit dir selbst gibt es noch nicht oder Graph zeigt ihn nicht (${gesehen} Einzelchats durchsucht${versuche.length ? `; ${versuche.join("; ")}` : ""}). Öffne ihn einmal in Teams (deinen Namen in der Suche wählen, eine Nachricht an dich schicken), dann klappt die Zustellung.`);
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
  const nachricht = (mitBildern: boolean) => ({
    body: { contentType: "html", content: ergebnisHtml(inhalt, mitBildern ? bildHtml(bilder, (b) => `../hostedContents/${b.nr}/$value`) : undefined) },
    ...(mitBildern ? { hostedContents: [...bilder.values()].map((b) => ({ "@microsoft.graph.temporaryId": String(b.nr), contentBytes: b.png, contentType: "image/png" })) } : {}),
  });
  const nachrichtenPfad = `/v1.0/chats/${encodeURIComponent(chatId)}/messages`;
  let hinweis = "";
  try { await graphJson(graph, nachrichtenPfad, "Teams-Nachricht senden", { method: "POST", body: nachricht(bilder.size > 0) }); }
  catch (e) {
    if (!bilder.size) throw e;
    await graphJson(graph, nachrichtenPfad, "Teams-Nachricht senden", { method: "POST", body: nachricht(false) });
    hinweis = ohneBilderHinweis(e);
  }
  return (anMich ? `Als Teams-Nachricht an dich gesendet${chatUrl ? ` (Chat: ${chatUrl})` : ""}.` : `Als Teams-Nachricht an ${adresse} gesendet.`) + hinweis;
}
