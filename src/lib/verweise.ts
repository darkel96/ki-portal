/**
 * Nummerierte Quellenverweise aus Copilot-Antworten in lesbare Links umwandeln. Reine Textlogik ohne DOM, damit sie
 * im Browser und im Hub-Dienst läuft.
 */
/** Nummerierter Verweis, wie Copilot Quellen setzt: „[1](Adresse)“ (mit Leerraum davor) */
/** Fertiger Markdown-Link „[Text](Adresse)“, Adresse auch mit paarigen Klammern */
const LINK = /\[[^\]]*\]\((?:[^\s()]|\([^\s()]*\))+\)/g;
const VERWEIS = /\s*\[(\d{1,3})\]\(((?:https?:\/\/)(?:[^\s()]|\([^\s()]*\))+)\)/g;
/** Linktexte, die nichts sagen: Kennungen (Base64, lange Zahlen, GUIDs) und technische Pfadteile */
const KENNUNG = /^(?:(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9+/=]{16,}|[A-Za-z0-9+/_-]{8,}={1,2}|[A-Za-z0-9_-]{40,}|\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/;
const TECHNISCH = /^(?:owa|mail|dispform|editform|allitems|default|index|view|doc|doc2|guestaccess|redir|download|l|p|r|0)$/i;
const TEAMS_ART: Record<string, string> = { message: "Teams-Nachricht", chat: "Teams-Chat", channel: "Teams-Kanal", "meetup-join": "Teams-Besprechung", meeting: "Teams-Besprechung", meetingrecap: "Teams-Besprechung", file: "Datei in Teams", team: "Team in Teams" };
const entschluesseln = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Base64-JSON mit einer Adresse darin („eyJ1Ijoi…“ = {"u":"https://…"}), wie Loop und Teams sie in Links packen */
function innereAdresse(u: URL): string | null {
  // Base64 darf „/“ enthalten: im ganzen Pfad und in den Parametern suchen, zur Not an „/“ kürzen
  const ort = `${entschluesseln(u.pathname)}?${[...u.searchParams.values()].join("&")}`;
  for (const roh of ort.match(/eyJ[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []) {
    const teile = roh.split("/");
    for (let n = teile.length; n > 0; n--) {
      try {
        const b = teile.slice(0, n).join("/").replace(/-/g, "+").replace(/_/g, "/");
        const j = JSON.parse(decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4))))) as Record<string, unknown>;
        const innen = [j.u, j.url, j.href].find((x): x is string => typeof x === "string" && /^https?:\/\//.test(x));
        if (innen) return innen;
      } catch { /* weiter kürzen */ }
    }
  }
  return null;
}

/** Ort, wenn die Adresse selbst keinen Namen hergibt */
function ortName(host: string): string {
  if (/-my\.sharepoint\.com$/.test(host)) return "OneDrive";
  if (/\.sharepoint\.com$/.test(host)) return "SharePoint";
  if (/^loop\.|\.loop\./.test(host)) return "Loop-Seite";
  if (/(^|\.)office\.com$|(^|\.)cloud\.microsoft$|(^|\.)microsoft365\.com$/.test(host)) return "Microsoft 365";
  return host.replace(/^www\./, "");
}

/**
 * Lesbarer Name eines Dokuments aus seiner Adresse: der Dateiname (bei Office-Links der Parameter „file“), bei
 * Outlook „E-Mail“ bzw. „Termin in Outlook“, bei Teams die Art (Nachricht, Chat, Kanal, Besprechung), bei
 * SharePoint-Listen „Liste „Name“, Eintrag 12“. Kennungen (Base64, Nachrichtennummern) werden nie zum Namen; dann
 * steht der Ort da (SharePoint, OneDrive, …). In Base64 versteckte Adressen werden ausgepackt.
 */
export function dokumentName(url: string, tiefe = 0): string {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    const host = u.hostname.toLowerCase();
    const innen = tiefe < 2 ? innereAdresse(u) : null;
    if (innen) return dokumentName(innen, tiefe + 1);
    const pfad = entschluesseln(u.pathname);
    if (/(^|\.)outlook\.(office|office365|live)\.com$|(^|\.)outlook\.cloud\.microsoft$/.test(host)) return /\/calendar\//i.test(pfad) ? "Termin in Outlook" : "E-Mail";
    if (/(^|\.)teams\.(microsoft|live)\.com$|(^|\.)teams\.cloud\.microsoft$/.test(host)) {
      const art = /\/l\/([a-z-]+)/i.exec(pfad)?.[1]?.toLowerCase() ?? "";
      return TEAMS_ART[art] ?? "Teams";
    }
    let name = u.searchParams.get("file") || "";
    const liste = /\/Lists\/([^/]+)\/[^/]+\.aspx$/i.exec(pfad);
    if (!name && liste) {
      const id = u.searchParams.get("ID") ?? u.searchParams.get("id");
      return `Liste „${liste[1]!.replace(/_/g, " ")}“${id ? `, Eintrag ${id}` : ""}`;
    }
    if (!name) name = pfad.split("/").filter(Boolean).at(-1) ?? "";
    // Seiten (.aspx): Bindestriche trennen Wörter („CRA-QA.aspx“ = „CRA QA“); Dateinamen bleiben, wie sie sind
    const seite = /\.aspx$/i.test(name);
    name = name.replace(/\.aspx$/i, "").replace(seite ? /[_-]+/g : /_/g, " ").trim();
    return !name || KENNUNG.test(name) || TECHNISCH.test(name) ? ortName(host) : name;
  } catch { return url; }
}

/** Sagt ein Linktext nichts (Nummer, Kennung, die Adresse selbst, „owa“), steht stattdessen der Dokumentname */
export function linkText(text: string, url: string): string {
  const t = text.trim();
  const nichtssagend = !t || t === url.trim() || /^https?:\/\//i.test(t) || /^\d{1,3}$/.test(t) || KENNUNG.test(t) || TECHNISCH.test(t);
  return nichtssagend ? dokumentName(url) : text;
}

/**
 * Copilot setzt Quellen als nummerierte Verweise „… Text [1](Adresse)“, in der Anzeige bleibt davon nur eine kleine „1“.
 * Der Hub macht daraus lesbare Links: In einer Quellenzeile („Quelle: Dokument, Abschnitt [1](…)“) wird die Angabe davor
 * zum Linktext. Verweise im Fließtext, deren Adresse in einer Quellenzeile steht, fallen weg (die Quellenzeile trägt den
 * Link); die übrigen bekommen den Dokumentnamen aus der Adresse als Linktext. Wirkt auf den Text selbst, also auch in
 * Word, PDF und beim Kopieren.
 */
export function verweiseAufloesen(text: string): string {
  if (!/\[\d{1,3}\]\(https?:/.test(text)) return text;
  const inQuellen = new Set<string>();
  const zeilen = text.split("\n");
  const quellenZeile = /^(\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:\s*)(.*)$/i;
  const erst = zeilen.map((z) => {
    const m = quellenZeile.exec(z);
    if (!m) return z;
    // Abschnitte der Zeile: Text bis zum Verweis → [Text](Adresse). Steht in dem Text schon ein Link (Copilot schreibt
    // inzwischen beides: Link und Nummer), bleibt der Link, und nur der Text danach wird mit der Adresse der Nummer verlinkt
    let rest = "", pos = 0;
    for (const v of m[2].matchAll(VERWEIS)) {
      const t = m[2].slice(pos, v.index);
      pos = v.index + v[0].length;
      inQuellen.add(v[2]);
      let ende = 0;
      for (const l of t.matchAll(LINK)) ende = l.index + l[0].length;
      const vor = t.slice(0, ende), nach = t.slice(ende);
      const trenner = /^\s*[;,·|]\s*/.exec(nach)?.[0] ?? "";
      const name = nach.slice(trenner.length).trim().replace(/[.;,:·]+$/, "");
      if (name) rest += `${vor}${trenner}[${name}](${v[2]})`;
      else if (vor) rest += vor;   // Nummer hinter einem fertigen Link: der Link reicht
      else rest += `${rest.trim() ? " · " : ""}[${dokumentName(v[2])}](${v[2]})`;
    }
    rest += m[2].slice(pos);
    return m[1] + rest;
  });
  // Mehrere Nummern hintereinander („[1](…)[2](…)“) werden eine Aufzählung; gleiche Namen bekommen eine Nummer („E-Mail 2“)
  const folge = new RegExp(`(?:${VERWEIS.source})+`, "g");
  return erst.map((z) => (quellenZeile.test(z) ? z : z.replace(folge, (ganz) => {
    const adressen = [...new Set([...ganz.matchAll(VERWEIS)].map((v) => v[2]!).filter((u) => !inQuellen.has(u)))];
    if (!adressen.length) return "";
    const zaehler = new Map<string, number>();
    return " " + adressen.map((u) => {
      const name = dokumentName(u), n = (zaehler.get(name) ?? 0) + 1;
      zaehler.set(name, n);
      return `[${n > 1 ? `${name} ${n}` : name}](${u})`;
    }).join(", ");
  }))).join("\n");
}

/* ---------- Quellennamen ohne Link ---------- */
export type DokLink = { titel: string; link: string };

/** Dokumente mit Adresse aus dem Auszugstext des Hubs („Dokument: …“ gefolgt von „Link: …“) */
export function dokumentLinks(auszug: string): DokLink[] {
  const out: DokLink[] = [];
  const zeilen = auszug.split("\n");
  for (let i = 0; i + 1 < zeilen.length; i++) {
    const d = /^Dokument:\s*(.+)$/.exec(zeilen[i]), l = /^Link:\s*(\S+)$/.exec(zeilen[i + 1]);
    if (d && l) out.push({ titel: d[1].trim(), link: l[1] });
  }
  return out;
}

/** Vergleichsform eines Dokumentnamens: klein, ohne Endung, Unterstriche und Satzzeichen */
const normName = (s: string) => s.toLowerCase().replace(/\.(docx?|pptx?|xlsx?|pdf|md|txt|csv|aspx)$/i, "").replace(/[_\s]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Schreibt die KI in einer Quellenzeile nur den Namen eines Dokuments („Quelle: Cheat Sheet, Abschnitt 3; Schulung, S. 24“),
 * verlinkt der Hub ihn mit der Adresse aus den gelesenen Auszügen; die ganze Angabe (Name und Stelle) wird Linktext.
 * Nur Abschnitte ohne Link werden angefasst, der längste passende Dokumentname gewinnt.
 */
export function quellenVerlinken(text: string, links: DokLink[]): string {
  const bekannt = links.map((l) => ({ ...l, norm: normName(l.titel) })).filter((l) => l.norm.length >= 6 && /^https?:/.test(l.link)).sort((a, b) => b.norm.length - a.norm.length);
  if (!bekannt.length || !/^\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:/im.test(text)) return text;
  const quellenZeile = /^(\s*(?:[-*]\s+)?(?:\*\*)?Quellen?(?:\*\*)?\s*:\s*)(.*)$/i;
  return text.split("\n").map((z) => {
    const m = quellenZeile.exec(z);
    if (!m) return z;
    // Abschnitte an „;“ oder „·“ trennen; „,“ bleibt, weil es Name und Stelle trennt
    const teile = m[2].split(/(\s*[;·]\s*)/);
    const neu = teile.map((t, i) => {
      if (i % 2 === 1 || !t.trim() || /\]\(/.test(t) || /https?:\/\//.test(t)) return t;
      const name = t.trim().replace(/[.;,:]+$/, "");
      const norm = normName(name);
      const l = bekannt.find((x) => norm.startsWith(x.norm) || norm.includes(" " + x.norm) || norm === x.norm);
      if (!l) return t;
      const vor = /^\s*/.exec(t)?.[0] ?? "", nach = t.slice(vor.length + t.trim().length);
      return `${vor}[${name}](${l.link})${nach}`;
    }).join("");
    return m[1] + neu;
  }).join("\n");
}

/** Gleiche Adresse trotz &amp; und Leerzeichen */
const adresseNorm = (u: string) => u.replace(/&amp;/g, "&").replace(/ /g, "%20").trim();

/**
 * Jeder Link bekommt einen sprechenden Text, im Ergebnistext selbst (also auch in Word, PDF, PowerPoint, Mail und
 * beim Kopieren): Nichtssagende Linktexte (Nummern, Kennungen, „owa“, die Adresse) werden zum Titel aus den gelesenen
 * Auszügen (Betreff der E-Mail, Name des Chats, Dokument) oder zum Dokumentnamen. Mit `nackt` werden auch nackte
 * Adressen (auch „<https://…>“) zu Links. Codeblöcke und `Code` bleiben unberührt.
 */
export function linksBenennen(text: string, links: DokLink[] = [], nackt = true): string {
  if (!/https?:\/\//.test(text)) return text;
  const titel = new Map(links.filter((l) => /^https?:/.test(l.link)).map((l) => [adresseNorm(l.link), l.titel.trim()]));
  const name = (t: string, u: string) => {
    const neu = linkText(t, u);
    return neu === t ? t : titel.get(adresseNorm(u)) || neu;
  };
  const LINK_MD = /\[([^\]\n]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;
  const teil = (s: string) => {
    // Fertige Links benennen und beiseitelegen, damit die Suche nach nackten Adressen sie nicht trifft
    const fertig: string[] = [];
    let r = s.replace(LINK_MD, (_, t: string, u: string) => { fertig.push(`[${name(t, u)}](${u})`); return `\u0000${fertig.length - 1}\u0000`; });
    if (nackt) {
      r = r.replace(/<(https?:\/\/[^\s<>]+)>/g, (_, u: string) => `[${titel.get(adresseNorm(u)) || dokumentName(u)}](${u})`)
        .replace(/(^|[\s(\[„"'])(https?:\/\/[^\s<>()\]]*[^\s<>().,;:!?'"“”\]])/g, (_, vor: string, u: string) => `${vor}[${titel.get(adresseNorm(u)) || dokumentName(u)}](${u})`);
    }
    return r.replace(/\u0000(\d+)\u0000/g, (_, i: string) => fertig[Number(i)]!);
  };
  let imCode = false;
  return text.split("\n").map((z) => {
    if (/^\s*```/.test(z)) { imCode = !imCode; return z; }
    if (imCode) return z;
    // Inline-Code (`…`) auslassen
    return z.split(/(`[^`]*`)/).map((s, i) => (i % 2 ? s : teil(s))).join("");
  }).join("\n");
}
