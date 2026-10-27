import { passtZumThema, suchWorte } from "@/lib/themensuche";
import { Arbeitet } from "@/components/layout/Arbeitet";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import DOMPurify from "dompurify";
import { toast } from "sonner";
import { BookmarkPlus, ChevronDown, ChevronRight, FolderInput, Mail, MailOpen, Paperclip, RefreshCw, Search, Sparkles, Square } from "lucide-react";
import type { Block } from "@/lib/schema";
import { antwortEntwurf, mailKontext, nachrichtenLaden, nachrichtenSeit, nachrichtenSuchen, nachrichtenVerschieben, nachrichtLaden, ordnerGemerkt, ordnerLaden, ordnerNamen, ordnerNeuAnlegen, postfachEcht, zielOrdnerSuchen, pfadTeile, alleOrdner, suchOrdnerAufloesen, type OrdnerPfad, type Nachricht, type NachrichtVoll, type Ordner } from "@/lib/ki/postfach";
import { KiSimulation, jsonAus, kiFragen } from "@/lib/ki";
import { markdown } from "@/lib/markdown";
import type { Mode } from "./BlockContent";

type Prozedur = Extract<Block, { type: "postfach" }>["props"]["prozeduren"][number];
/** Themensuche: so viele Treffer nimmt sie höchstens, und so viele prüft die KI je Anfrage */
const MAX_MAILS = 1000;
const PAKET = 150;
type Kandidat = Nachricht & { ordnerId: string };
/** Wo eine Prozedur sucht (ältere, gemerkte Prozeduren ohne Angabe: nur im Posteingang) */
const suchIn = (p: Prozedur): string[] => (Array.isArray(p.suchOrdner) ? p.suchOrdner.map((x) => x.trim()).filter(Boolean) : ["Posteingang"]);
type Treffer = Nachricht & { ordnerId: string; ordnerName?: string; gewaehlt: boolean };

/** Vordefinierte KI-Aktionen zur geöffneten Mail */
const AKTIONEN: { key: string; label: string; auftrag: string }[] = [
  { key: "zusammenfassung", label: "Zusammenfassen", auftrag: "Fasse diese E-Mail in höchstens fünf Sätzen zusammen: Worum geht es, was wird von mir erwartet, bis wann." },
  { key: "antwort", label: "Antwort entwerfen", auftrag: "Entwirf eine Antwort auf diese E-Mail in meinem Namen: freundlich, knapp, auf Deutsch (oder in der Sprache der Mail), mit Anrede und Gruß. Offene Punkte, die ich klären muss, als [offen] markieren. Gib nur den Antworttext aus." },
  { key: "aufgaben", label: "Aufgaben herausziehen", auftrag: "Liste alle Aufgaben, Fristen und offenen Fragen aus dieser E-Mail als Checkliste: je Punkt wer, was, bis wann (soweit genannt)." },
  { key: "uebersetzen", label: "Übersetzen", auftrag: "Übersetze diese E-Mail vollständig: ist sie deutsch, ins Englische, sonst ins Deutsche. Nur die Übersetzung ausgeben." },
];
const TAGE: [string, string][] = [["7", "7 Tage"], ["14", "14 Tage"], ["30", "30 Tage"], ["60", "60 Tage"], ["90", "90 Tage"], ["180", "180 Tage"]];

type Props = { b: Extract<Block, { type: "postfach" }>; mode: Mode };

const datum = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso), heute = new Date();
  const gleicherTag = d.toDateString() === heute.toDateString();
  return gleicherTag ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: d.getFullYear() === heute.getFullYear() ? undefined : "2-digit" });
};
const datumLang = (iso: string) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** Postfach wie in Outlook: links die Ordner, in der Mitte die Nachrichten des gewählten Ordners, rechts die geöffnete Nachricht */
export function PostfachView({ b, mode }: Props) {
  const [ordner, setOrdner] = useState<Ordner[]>([]);
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const [gewaehlt, setGewaehlt] = useState<Ordner | null>(null);
  const [liste, setListe] = useState<Nachricht[]>([]);
  const [weiter, setWeiter] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [eingabe, setEingabe] = useState("");
  const [nachricht, setNachricht] = useState<NachrichtVoll | null>(null);
  const [laedt, setLaedt] = useState<"ordner" | "liste" | "mehr" | "nachricht" | null>(null);
  const [fehler, setFehler] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const echt = postfachEcht();
  // KI zur geöffneten Mail
  const [kiFrage, setKiFrage] = useState("");
  const [ki, setKi] = useState<{ aktion: string; text: string; simulation?: boolean } | null>(null);
  const [kiLaeuft, setKiLaeuft] = useState<AbortController | null>(null);
  const [entwurf, setEntwurf] = useState<"laeuft" | string | null>(null);
  // Prozeduren: Mails zu einem Thema aus den letzten Tagen in einen Ordner ablegen
  const [prozOffen, setProzOffen] = useState(false);
  const [proz, setProz] = useState<Prozedur>({ name: "", thema: "", tage: 30, zielordner: "", ki: true, suchOrdner: ["Posteingang"] });
  /** Alle Ordner (für die Auswahl, wo gesucht wird); erst geladen, wenn „Nur Posteingang“ abgewählt wird */
  const [ordnerWahl, setOrdnerWahl] = useState<OrdnerPfad[] | null>(null);
  const [treffer, setTreffer] = useState<Treffer[] | null>(null);
  /** Zielordner zur Eingabe: gefunden (mit Pfad), mehrfach vorhanden (Person muss genauer werden) oder neu anzulegen */
  const [ziel, setZiel] = useState<{ eingabe: string; treffer: OrdnerPfad[] } | null>(null);
  const [prozLaeuft, setProzLaeuft] = useState<"suche" | "verschieben" | null>(null);
  const [prozMeldung, setProzMeldung] = useState("");
  /** Was die Suche gerade tut (für den Knopf): „Lädt die Mails …“, „KI wählt aus 150 Mails …“ */
  const [prozPhase, setProzPhase] = useState("");
  // Eigene Prozeduren: gemerkte Suchen dieser Person (im Browser, je Postfach-Baustein)
  const eigeneSchluessel = `kihub-prozeduren:${b.id}`;
  const [eigene, setEigene] = useState<Prozedur[]>(() => { try { const v = JSON.parse(localStorage.getItem(eigeneSchluessel) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } });
  const eigeneSetzen = (liste: Prozedur[]) => { setEigene(liste); try { localStorage.setItem(eigeneSchluessel, JSON.stringify(liste)); } catch { /* voll oder gesperrt */ } };
  const merken = () => {
    const neu: Prozedur = { ...proz, name: proz.thema.trim().slice(0, 40), thema: proz.thema.trim(), zielordner: proz.zielordner.trim() };
    const gleich = (a: Prozedur) => a.thema === neu.thema && a.zielordner === neu.zielordner && a.tage === neu.tage && a.ki === neu.ki && suchIn(a).join("|") === suchIn(neu).join("|");
    if (eigene.some(gleich) || b.props.prozeduren.some(gleich)) { toast.info("Diese Prozedur gibt es schon."); return; }
    eigeneSetzen([...eigene, neu].slice(-12));
    toast.success(`„${neu.name}“ gemerkt. Ein Klick darauf startet die Vorschau.`);
  };

  const kiAnfrage = async (aktion: string, auftrag: string) => {
    if (!nachricht) return;
    const c = new AbortController();
    setKiLaeuft(c); setKi({ aktion, text: "" }); setEntwurf(null);
    const prompt = `Du hilfst bei E-Mails im Postfach von ${nachricht.an[0] ? nachricht.an[0] : "der angemeldeten Person"}. Antworte auf Deutsch, außer die Aufgabe verlangt etwas anderes. Erfinde keine Fakten; was in der Mail nicht steht, kennzeichnest du.\n\nAufgabe: ${auftrag}\n\nE-Mail:\n"""\n${mailKontext(nachricht)}\n"""`;
    try {
      const text = await kiFragen(prompt, c.signal, (t) => setKi({ aktion, text: t }));
      setKi({ aktion, text });
    } catch (e) {
      if (e instanceof KiSimulation) setKi({ aktion, text: "nachricht" in e.req ? e.req.nachricht : "", simulation: true });
      else if (!c.signal.aborted) { setKi(null); toast.error(e instanceof Error ? e.message : "Die KI-Anfrage ist fehlgeschlagen."); }
    } finally { setKiLaeuft(null); }
  };
  const entwurfAnlegen = async () => {
    if (!nachricht || !ki?.text) return;
    setEntwurf("laeuft");
    try { const { webLink } = await antwortEntwurf(nachricht.id, ki.text); setEntwurf(webLink || "ok"); toast.success("Antwortentwurf in Outlook angelegt (Ordner „Entwürfe“)."); }
    catch (e) { setEntwurf(null); toast.error(e instanceof Error ? e.message : "Der Entwurf konnte nicht angelegt werden."); }
  };
  /** Prozedur vorbereiten: Mails der letzten Tage holen, zum Thema auswählen (Wortsuche, auf Wunsch KI), zur Bestätigung zeigen */
  const prozSuchen = async (p: Prozedur) => {
    if (!p.thema.trim()) { toast.error("Bitte ein Thema oder Suchbegriffe angeben."); return; }
    setProz(p); setProzLaeuft("suche"); setTreffer(null); setProzMeldung("");
    const hinweise: string[] = [];
    try {
      const w = suchWorte(p.thema);
      const dazu = (liste: Kandidat[], mehr: Kandidat[]) => { const ids = new Set(liste.map((n) => n.id)); return [...liste, ...mehr.filter((n) => !ids.has(n.id))]; };
      // Wo gesucht wird: Standard nur der Posteingang, sonst die gewählten Ordner oder alle
      const pfade = suchIn(p);
      setProzPhase("Sucht die Ordner");
      const { ordner: suchOrdner, fehlen } = await suchOrdnerAufloesen(pfade);
      if (fehlen.length) hinweise.push(`Nicht gefunden und übersprungen: ${fehlen.map((f) => `„${f}“`).join(", ")}.`);
      if (pfade.length && !suchOrdner.length) { setProzMeldung(`Keinen der Suchordner gefunden (${pfade.join(", ")}).`); return; }
      const suchIds = suchOrdner.map((o) => o.id);
      const wo = suchOrdner.length ? suchOrdner.map((o) => `„${o.pfad.join(" › ")}“`).join(", ") : "allen Ordnern";
      // 1. Im ganzen Zeitraum nach den Suchwörtern suchen (Microsoft durchsucht Betreff, Text und Absender)
      setProzPhase(`Sucht ${w.map((x) => `„${x}“`).join(", ")} in ${wo}, letzte ${p.tage} Tage`);
      let kandidaten: Kandidat[];
      try { kandidaten = await nachrichtenSuchen(w, p.tage, undefined, MAX_MAILS, suchIds); }
      catch (e) {
        // Suche nicht möglich: die neuesten Mails des Zeitraums laden und selbst nach den Wörtern filtern
        hinweise.push(`Die Suche von Microsoft war nicht möglich (${e instanceof Error ? e.message : String(e)}); geprüft wurden Betreff und Vorschau der neuesten ${MAX_MAILS} Mails.`);
        kandidaten = (await nachrichtenSeit(p.tage, undefined, MAX_MAILS)).filter((n) => (!suchIds.length || suchIds.includes(n.ordnerId)) && passtZumThema(`${n.betreff} ${n.von} ${n.vonAdresse} ${n.vorschau}`, w));
      }
      hinweise.push(`Gesucht in ${wo}.`);
      let kiAus = !p.ki;
      if (p.ki) {
        // 2. Die KI nennt weitere Begriffe, unter denen das Thema läuft (Projekt-, Anlagennummern, Kunden), und es wird auch danach gesucht
        setProzPhase("KI sucht weitere Begriffe zum Thema");
        try {
          const antwort = await kiFragen(`Für eine Postfach-Suche zum Thema „${p.thema}“: Nenne bis zu 5 weitere Suchbegriffe, unter denen Mails zu genau diesem Thema auch laufen (Projektnummern, Anlagennummern, Kundennamen, Abkürzungen), etwa aus diesen Betreffzeilen. Keine allgemeinen Wörter, keine Wörter, die auch in vielen anderen Mails stehen. Antworte nur mit JSON: {"begriffe": ["…"]}\n\nBetreffzeilen bisheriger Treffer:\n${kandidaten.slice(0, 80).map((n) => n.betreff).join("\n") || "(noch keine)"}`);
          const j = jsonAus(antwort) as { begriffe?: unknown };
          const extra = (Array.isArray(j.begriffe) ? j.begriffe : []).map((x) => String(x).trim()).filter((x) => x.length >= 2 && x.length <= 40 && !w.includes(x.toLowerCase())).slice(0, 5);
          if (extra.length) {
            setProzPhase(`Sucht auch nach ${extra.map((x) => `„${x}“`).join(", ")}`);
            kandidaten = dazu(kandidaten, await nachrichtenSuchen(extra, p.tage, undefined, MAX_MAILS, suchIds).catch(() => []));
            hinweise.push(`Mitgesucht: ${extra.join(", ")}.`);
          }
        } catch (e) {
          if (e instanceof KiSimulation) { kiAus = true; hinweise.push("Simulation: Die KI-Auswahl würde an die zentrale KI-Anbindung gehen; gezeigt wird nur die Suche nach den Wörtern."); }
        }
      }
      // Zielordner in allen Ebenen suchen; was schon dort liegt, muss nicht noch einmal verschoben werden
      setProzPhase("Sucht den Zielordner");
      const zt = p.zielordner.trim() ? await zielOrdnerSuchen(p.zielordner).catch(() => [] as OrdnerPfad[]) : [];
      setZiel(p.zielordner.trim() ? { eingabe: p.zielordner.trim(), treffer: zt } : null);
      const zielId = zt.length === 1 ? zt[0]!.id : "";
      const schonDa = zielId ? kandidaten.filter((n) => n.ordnerId === zielId).length : 0;
      if (zielId) kandidaten = kandidaten.filter((n) => n.ordnerId !== zielId);
      let passend = kandidaten;
      if (!kiAus && kandidaten.length) {
        // 3. Die KI prüft die Treffer in Paketen und wirft aus, was nicht wirklich zum Thema gehört
        const ids = new Set<string>();
        let ohneKi = 0;
        for (let ab = 0; ab < kandidaten.length; ab += PAKET) {
          const paket = kandidaten.slice(ab, ab + PAKET);
          setProzPhase(kandidaten.length > PAKET ? `KI prüft Treffer ${ab + 1} bis ${ab + paket.length} von ${kandidaten.length}` : `KI prüft ${kandidaten.length} Treffer`);
          const liste = paket.map((n, i) => `${i + 1} | ${n.empfangen.slice(0, 10)} | ${n.von} | ${n.betreff} | ${n.vorschau.slice(0, 120)}`).join("\n");
          try {
            const antwort = await kiFragen(`Welche dieser E-Mails gehören eindeutig zum Thema „${p.thema}“? Zähle auch Mails dazu, die das Thema anders benennen (Projektnummer, Kunde, Anlage), aber nur, wenn der Bezug klar ist; im Zweifel nicht. Newsletter, Einladungen, Benachrichtigungen von Tools und Werbung gehören nicht dazu, außer sie handeln ausdrücklich vom Thema. Antworte nur mit JSON: {"nummern": [Zahlen]}\n\nNr | Datum | Von | Betreff | Vorschau\n${liste}`);
            const j = jsonAus(antwort) as { nummern?: unknown };
            const nummern = Array.isArray(j.nummern) ? j.nummern.map(Number).filter((n) => n >= 1 && n <= paket.length) : [];
            for (const n of nummern) ids.add(paket[n - 1]!.id);
          } catch (e) {
            // Paket ohne KI-Prüfung: die Treffer der Suche bleiben
            for (const n of paket) ids.add(n.id);
            ohneKi += paket.length;
            if (ab + PAKET >= kandidaten.length) hinweise.push(`KI-Prüfung für ${ohneKi} Treffer nicht möglich (${e instanceof Error ? e.message : String(e)}); sie stehen ungeprüft in der Liste.`);
          }
        }
        passend = kandidaten.filter((n) => ids.has(n.id));
      }
      if (kandidaten.length >= MAX_MAILS) hinweise.push(`Mehr als ${MAX_MAILS} Treffer; berücksichtigt sind die neuesten ${MAX_MAILS}.`);
      if (schonDa) hinweise.push(`${schonDa} ${schonDa === 1 ? "Mail liegt" : "Mails liegen"} schon in „${zt[0]!.pfad.join(" › ")}“.`);
      setProzMeldung(hinweise.join(" "));
      // Ordner, in dem die Mail gerade liegt (Spalte in der Auswahl)
      const namen = await ordnerNamen(passend.map((n) => n.ordnerId), ordner).catch(() => ({} as Record<string, string>));
      setTreffer(passend.map((n) => ({ ...n, ordnerName: namen[n.ordnerId] ?? "", gewaehlt: true })));
      if (!passend.length) setProzMeldung((m) => `Keine ${schonDa ? "weiteren " : ""}Mails zum Thema „${p.thema}“ in den letzten ${p.tage} Tagen.${m ? ` ${m}` : ""}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Die Suche ist fehlgeschlagen."); }
    finally { setProzLaeuft(null); }
  };
  const prozAusfuehren = async () => {
    const ids = (treffer ?? []).filter((t) => t.gewaehlt).map((t) => t.id);
    if (!ids.length || !proz.zielordner.trim()) { toast.error(ids.length ? "Bitte einen Zielordner angeben." : "Keine Mail ausgewählt."); return; }
    setProzLaeuft("verschieben"); setProzPhase("Sucht den Zielordner");
    const erledigt = new Set<string>();
    try {
      // Zielordner noch einmal frisch suchen (in allen Ebenen); angelegt wird nur, was es nirgends gibt und was die Person gesehen hat
      const eingabe = proz.zielordner.trim();
      const gefunden = await zielOrdnerSuchen(eingabe);
      const gesehen = ziel?.eingabe === eingabe ? ziel.treffer : null;
      setZiel({ eingabe, treffer: gefunden });
      if (gefunden.length > 1) { toast.error(`„${eingabe}“ gibt es mehrmals. Bitte den Pfad angeben, z. B. „${gefunden[0]!.pfad.slice(-2).join("/")}“.`); return; }
      if (!gefunden.length && gesehen?.length !== 0) { toast.info(`Den Ordner „${eingabe}“ gibt es noch nicht. Zum Anlegen noch einmal auf „Anlegen und verschieben“ klicken.`); return; }
      const zo = gefunden[0] ?? await ordnerNeuAnlegen(eingabe);
      const zielName = zo.pfad.join(" › ");
      setProzPhase(`Verschiebt 0 von ${ids.length} Mails`);
      const n = await nachrichtenVerschieben(ids, zo.id, undefined, (id) => { erledigt.add(id); setProzPhase(`Verschiebt ${erledigt.size} von ${ids.length} Mails`); });
      toast.success(`${n} ${n === 1 ? "Mail" : "Mails"} nach „${zielName}“ verschoben.`);
      setTreffer(null); setZiel(null); setProzMeldung(`${n} ${n === 1 ? "Mail" : "Mails"} nach „${zielName}“ verschoben.`);
      await ordnerHolen(); setSuche((s) => s);   // Liste und Zähler neu
      setGewaehlt((g) => (g ? { ...g } : g));
    } catch (e) {
      // Schon Verschobene aus der Auswahl nehmen, damit „Erneut starten“ nur den Rest verschiebt
      if (erledigt.size) setTreffer((t) => t?.filter((x) => !erledigt.has(x.id)) ?? t);
      toast.error(e instanceof Error ? e.message : "Verschieben fehlgeschlagen.");
    }
    finally { setProzLaeuft(null); setProzPhase(""); }
  };

  const nurPosteingang = (p: Prozedur) => { const l = suchIn(p); return l.length === 1 && l[0]!.toLowerCase() === "posteingang"; };
  const nurPosteingangSetzen = async (an: boolean) => {
    // Abgewählt: erst einmal alle Ordner (leere Auswahl), die Liste zum genauen Wählen lädt dazu
    setProz({ ...proz, suchOrdner: an ? ["Posteingang"] : [] });
    if (!an && !ordnerWahl) setOrdnerWahl(await alleOrdner().catch(() => []));
  };
  const zielStand: "da" | "neu" | "mehrfach" | null = !ziel || ziel.eingabe !== proz.zielordner.trim() ? null : ziel.treffer.length === 1 ? "da" : ziel.treffer.length ? "mehrfach" : "neu";
  const ordnerHolen = async () => {
    setLaedt("ordner"); setFehler("");
    // Zuletzt geladene Ordner sofort zeigen, die frische Liste ersetzt sie gleich
    const alt = await ordnerGemerkt();
    if (alt?.length) { setOrdner((jetzt) => (jetzt.length ? jetzt : alt)); setGewaehlt((g) => g ?? alt[0] ?? null); }
    try {
      const o = await ordnerLaden();
      setOrdner(o);
      setGewaehlt((alt) => alt ?? o[0] ?? null);
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  useEffect(() => { if (mode === "run") void ordnerHolen(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nachrichten des gewählten Ordners (bei Ordnerwechsel und Suche neu)
  useEffect(() => {
    if (mode !== "run" || !gewaehlt) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLaedt("liste"); setFehler(""); setNachricht(null);
    nachrichtenLaden(gewaehlt.id, b.props.anzahl, { suche }, c.signal)
      .then((s) => { if (!c.signal.aborted) { setListe(s.liste); setWeiter(s.weiter); } })
      .catch((e) => { if (!c.signal.aborted) setFehler(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!c.signal.aborted) setLaedt(null); });
    return () => c.abort();
  }, [gewaehlt, suche, b.props.anzahl, mode]);

  const mehr = async () => {
    if (!gewaehlt || !weiter) return;
    setLaedt("mehr");
    try { const s = await nachrichtenLaden(gewaehlt.id, b.props.anzahl, { weiter }); setListe((l) => [...l, ...s.liste]); setWeiter(s.weiter); }
    catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  const oeffnen = async (n: Nachricht) => {
    setLaedt("nachricht"); setFehler("");
    setKi(null); setEntwurf(null); setKiFrage("");
    try { setNachricht(await nachrichtLaden(n.id)); }
    catch (e) { setFehler(e instanceof Error ? e.message : String(e)); }
    finally { setLaedt(null); }
  };
  const html = useMemo(() => (nachricht?.html ? DOMPurify.sanitize(nachricht.html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button"], ADD_ATTR: ["target"] }) : ""), [nachricht]);

  const ordnerZeile = (o: Ordner, tiefe: number) => (
    <li key={o.id}>
      <button type="button" className={`o-post-ordner${gewaehlt?.id === o.id ? " ist-aktiv" : ""}`} style={{ paddingLeft: 10 + tiefe * 16 }} onClick={() => { setSuche(""); setEingabe(""); setGewaehlt(o); }} aria-current={gewaehlt?.id === o.id ? "true" : undefined}>
        {o.kinder?.length ? <span className="o-post-klapp" role="button" aria-label={offen.has(o.id) ? "Unterordner einklappen" : "Unterordner ausklappen"} onClick={(e) => { e.stopPropagation(); setOffen((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; }); }}>{offen.has(o.id) ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}</span> : <span className="o-post-klapp" />}
        <span className="o-post-ordnername">{o.name}</span>
        {o.ungelesen > 0 && <span className="o-post-zahl" aria-label={`${o.ungelesen} ungelesen`}>{o.ungelesen}</span>}
      </button>
      {!!o.kinder?.length && offen.has(o.id) && <ul>{o.kinder.map((k) => ordnerZeile(k, tiefe + 1))}</ul>}
    </li>
  );

  if (mode === "edit") {
    return (
      <div className="o-post o-post-edit" aria-label={b.props.titel}>
        <div className="o-post-kopf"><Mail size={16} aria-hidden="true" /><b>{b.props.titel}</b></div>
        <p className="o-muted">Zeigt beim Ausführen die Ordner und Nachrichten des Postfachs der angemeldeten Person (nur lesen). {b.props.anzahl} Nachrichten je Seite{b.props.vorschau ? ", mit Vorschau" : ""}.</p>
      </div>
    );
  }
  return (
    <div className="o-post" aria-label={b.props.titel}>
      <div className="o-post-kopf">
        <Mail size={16} aria-hidden="true" /><b>{b.props.titel}</b>
        {!echt && <span className="o-post-hinweis" title="Ohne Copilot-Anbindung zeigt der Baustein ein Beispielpostfach">Beispielpostfach</span>}
        <span className="flex-1" />
        <button type="button" className={`o-chat-knopf${prozOffen ? " ist-aktiv" : ""}`} onClick={() => setProzOffen((o) => !o)} aria-expanded={prozOffen}><FolderInput size={13} aria-hidden="true" />Prozeduren</button>
        <button type="button" className="o-chat-knopf" onClick={() => { void ordnerHolen(); setSuche(eingabe); }} disabled={laedt !== null} title="Neu laden"><RefreshCw size={13} aria-hidden="true" />Aktualisieren</button>
      </div>
      {fehler && <p className="o-err" role="alert">{fehler}</p>}
      {prozOffen && (
        <section className="o-post-proz" aria-label="Prozeduren">
          <p className="hint" style={{ margin: 0 }}>Mails zu einem Thema aus den letzten Tagen in einen Ordner ablegen. Du siehst die Auswahl vorher und bestätigst sie.</p>
          {(b.props.prozeduren.length > 0 || eigene.length > 0) && (
            <div className="o-post-proz-liste">
              {b.props.prozeduren.map((p, i) => <button key={i} type="button" className="o-chat-knopf" disabled={prozLaeuft !== null} onClick={() => void prozSuchen(p)} title={`Thema „${p.thema}“, letzte ${p.tage} Tage, in ${suchIn(p).length ? suchIn(p).join(", ") : "allen Ordnern"}, nach „${p.zielordner}“`}>{p.name || p.thema}</button>)}
              {eigene.map((p, i) => (
                <span key={`e${i}`} className="o-post-proz-eigen">
                  <button type="button" className="o-chat-knopf" disabled={prozLaeuft !== null} onClick={() => void prozSuchen(p)} title={`Eigene Prozedur: Thema „${p.thema}“, letzte ${p.tage} Tage, nach „${p.zielordner || "(kein Ordner)"}“`}>{p.name || p.thema}</button>
                  <button type="button" className="o-post-proz-weg" aria-label={`„${p.name || p.thema}“ vergessen`} onClick={() => eigeneSetzen(eigene.filter((_, k) => k !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <form className="o-post-proz-form" onSubmit={(e) => { e.preventDefault(); void prozSuchen(proz); }}>
            <input value={proz.thema} onChange={(e) => setProz({ ...proz, thema: e.target.value })} placeholder="Thema oder Suchbegriffe, z. B. CRA, Cyber Resilience Act" aria-label="Thema" />
            <select value={String(proz.tage)} onChange={(e) => setProz({ ...proz, tage: Number(e.target.value) })} aria-label="Zeitraum">{TAGE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input value={proz.zielordner} onChange={(e) => setProz({ ...proz, zielordner: e.target.value })} placeholder="Zielordner, z. B. CRA" aria-label="Zielordner" />
            <label className="o-post-proz-ki"><input type="checkbox" checked={proz.ki} onChange={(e) => setProz({ ...proz, ki: e.target.checked })} />KI wählt thematisch</label>
            <label className="o-post-proz-ki"><input type="checkbox" checked={nurPosteingang(proz)} onChange={(e) => void nurPosteingangSetzen(e.target.checked)} />Nur Posteingang</label>
            <button type="submit" className="o-btn" style={{ "--btn": "var(--app-accent)", "--btn-ink": "var(--app-accent-ink)" } as CSSProperties} disabled={prozLaeuft !== null}>{prozLaeuft === "suche" ? <Arbeitet text="Sucht" /> : "Vorschau"}</button>
            <button type="button" className="o-chat-knopf" disabled={!proz.thema.trim()} onClick={merken} title="Diese Suche als eigene Prozedur merken (nur in diesem Browser)"><BookmarkPlus size={13} aria-hidden="true" />Merken</button>
          </form>
          {!nurPosteingang(proz) && (
            <fieldset className="o-post-suchordner">
              <legend>Suchen in <span className="o-muted">(keiner gewählt = alle Ordner; Unterordner einzeln wählen)</span></legend>
              {!ordnerWahl ? <p className="o-muted"><Arbeitet text="Lädt die Ordner" /></p> : (
                <ul>{ordnerWahl.map((o) => { const pf = o.pfad.join("/"); const an = suchIn(proz).some((x) => x.toLowerCase() === pf.toLowerCase()); return (
                  <li key={o.id} style={{ paddingLeft: `${(o.pfad.length - 1) * 16}px` }}><label><input type="checkbox" checked={an} onChange={() => setProz({ ...proz, suchOrdner: an ? suchIn(proz).filter((x) => x.toLowerCase() !== pf.toLowerCase()) : [...suchIn(proz), pf] })} />{o.name}</label></li>
                ); })}</ul>
              )}
            </fieldset>
          )}
          {prozLaeuft && prozPhase && <p className="o-muted" role="status"><Arbeitet text={prozPhase} /></p>}
          {prozMeldung && <p className="o-muted" role="status">{prozMeldung}</p>}
          {treffer && treffer.length > 0 && (
            <div className="o-post-proz-treffer" role="group" aria-label="Gefundene Mails">
              <div className="o-post-proz-kopf">
                <b>{treffer.filter((t) => t.gewaehlt).length} von {treffer.length} Mails ausgewählt</b>
                <button type="button" className="o-chat-link" onClick={() => setTreffer(treffer.map((t) => ({ ...t, gewaehlt: true })))}>alle</button>
                <button type="button" className="o-chat-link" onClick={() => setTreffer(treffer.map((t) => ({ ...t, gewaehlt: false })))}>keine</button>
                <span className="flex-1" />
                <button type="button" className="o-btn" style={{ "--btn": "var(--app-accent)", "--btn-ink": "var(--app-accent-ink)" } as CSSProperties} disabled={prozLaeuft !== null || !treffer.some((t) => t.gewaehlt) || (zielStand === "mehrfach")} onClick={() => void prozAusfuehren()}>{prozLaeuft === "verschieben" ? <Arbeitet text="Verschiebt" /> : zielStand === "neu" ? `„${proz.zielordner.trim()}“ anlegen und verschieben` : `Nach „${zielStand === "da" ? ziel!.treffer[0]!.pfad.slice(-2).join(" › ") : proz.zielordner || "…"}“ verschieben`}</button>
              </div>
              {zielStand === "da" && <p className="o-muted o-post-ziel">Ziel: {ziel!.treffer[0]!.pfad.join(" › ")}</p>}
              {zielStand === "neu" && <p className="o-muted o-post-ziel">Einen Ordner „{ziel!.eingabe}“ gibt es noch nicht; er wird beim Verschieben {pfadTeile(ziel!.eingabe).length > 1 ? "dort" : "auf oberster Ebene"} neu angelegt.</p>}
              {zielStand === "mehrfach" && <p className="o-post-ziel o-post-ziel-warn" role="alert">„{ziel!.eingabe}“ gibt es mehrmals: {ziel!.treffer.map((o) => o.pfad.join(" › ")).join("; ")}. Bitte den Pfad als Zielordner angeben, z. B. „{ziel!.treffer[0]!.pfad.slice(-2).join("/")}“, und neu suchen.</p>}
              <ul>
                {treffer.map((t) => (
                  <li key={t.id}><label><input type="checkbox" checked={t.gewaehlt} onChange={(e) => setTreffer(treffer.map((x) => (x.id === t.id ? { ...x, gewaehlt: e.target.checked } : x)))} /><span className="o-post-datum">{datum(t.empfangen)}</span><b>{t.von}</b><span className="o-post-betreff">{t.betreff}</span><span className="o-post-ort" title={t.ordnerName ? `Liegt in „${t.ordnerName}“` : undefined}>{t.ordnerName || "–"}</span></label></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <div className="o-post-raster">
        <nav className="o-post-ordnerliste" aria-label="Ordner">
          {laedt === "ordner" && !ordner.length ? <p className="o-muted">Ordner werden geladen …</p> : <ul>{ordner.map((o) => ordnerZeile(o, 0))}</ul>}
        </nav>
        <section className="o-post-liste" aria-label={gewaehlt ? `Nachrichten in ${gewaehlt.name}` : "Nachrichten"}>
          <form className="o-post-suche" onSubmit={(e) => { e.preventDefault(); setSuche(eingabe.trim()); }}>
            <Search size={14} aria-hidden="true" />
            <input value={eingabe} onChange={(e) => setEingabe(e.target.value)} placeholder={gewaehlt ? `In „${gewaehlt.name}“ suchen` : "Suchen"} aria-label="Nachrichten durchsuchen" />
            {suche && <button type="button" className="o-chat-link" onClick={() => { setSuche(""); setEingabe(""); }}>Suche aufheben</button>}
          </form>
          {laedt === "liste" ? <p className="o-muted">Nachrichten werden geladen …</p>
            : !gewaehlt ? <p className="o-muted">Kein Ordner gewählt.</p>
            : !liste.length ? <p className="o-muted">{suche ? "Nichts gefunden." : "Keine Nachrichten in diesem Ordner."}</p>
            : <ul className="o-post-nachrichten">
              {liste.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`o-post-nachricht${n.gelesen ? "" : " ist-neu"}${nachricht?.id === n.id ? " ist-aktiv" : ""}`} onClick={() => void oeffnen(n)} aria-current={nachricht?.id === n.id ? "true" : undefined}>
                    <span className="o-post-symbol">{n.gelesen ? <MailOpen size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}</span>
                    <span className="o-post-text">
                      <span className="o-post-zeile"><span className="o-post-von">{n.von || n.vonAdresse}</span><span className="o-post-datum">{datum(n.empfangen)}</span></span>
                      <span className="o-post-zeile"><span className="o-post-betreff">{n.wichtig && <span className="o-post-wichtig" title="Hohe Wichtigkeit">!</span>}{n.betreff}</span>{n.anhang && <Paperclip size={12} aria-label="Anhang" />}</span>
                      {b.props.vorschau && n.vorschau && <span className="o-post-vorschau">{n.vorschau}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>}
          {weiter && <button type="button" className="o-chat-knopf" onClick={() => void mehr()} disabled={laedt !== null}>{laedt === "mehr" ? <Arbeitet text="Lädt" /> : "Mehr laden"}</button>}
        </section>
        <article className="o-post-inhalt" aria-label="Geöffnete Nachricht">
          {laedt === "nachricht" ? <p className="o-muted">Nachricht wird geladen …</p>
            : !nachricht ? <p className="o-muted">Wähle eine Nachricht aus.</p>
            : <>
              <h3 className="o-post-titel">{nachricht.betreff}</h3>
              <p className="o-post-meta"><b>{nachricht.von}</b>{nachricht.vonAdresse && <span> &lt;{nachricht.vonAdresse}&gt;</span>}<br />
                {!!nachricht.an.length && <span>An: {nachricht.an.join(", ")}<br /></span>}
                {!!nachricht.cc.length && <span>Cc: {nachricht.cc.join(", ")}<br /></span>}
                <span>{datumLang(nachricht.empfangen)}</span>{nachricht.anhang && <span> · mit Anhang</span>}</p>
              <div className="o-post-ki" role="region" aria-label="KI zu dieser Mail">
                <div className="o-post-ki-zeile">
                  <Sparkles size={14} aria-hidden="true" />
                  {AKTIONEN.map((a) => <button key={a.key} type="button" className={`o-chat-knopf${ki?.aktion === a.key ? " ist-aktiv" : ""}`} disabled={!!kiLaeuft} onClick={() => void kiAnfrage(a.key, a.auftrag)}>{a.label}</button>)}
                </div>
                <form className="o-post-ki-zeile" onSubmit={(e) => { e.preventDefault(); if (kiFrage.trim()) void kiAnfrage("frage", kiFrage.trim()); }}>
                  <input value={kiFrage} onChange={(e) => setKiFrage(e.target.value)} placeholder="Frage zur Mail, z. B. Was muss ich bis wann liefern?" aria-label="Frage zur Mail" />
                  {kiLaeuft ? <button type="button" className="o-chat-knopf" onClick={() => kiLaeuft.abort()}><Square size={12} aria-hidden="true" />Stoppen</button>
                    : <button type="submit" className="o-chat-knopf" disabled={!kiFrage.trim()}>Fragen</button>}
                </form>
                {ki && (ki.simulation
                  ? <><p className="o-muted">Simulation: Diese Anfrage würde an die zentrale KI-Anbindung gehen.</p><pre className="code o-sim">{ki.text}</pre></>
                  : <div className="o-post-ki-antwort">
                    {ki.text ? <div className="o-body" aria-live="polite" dangerouslySetInnerHTML={{ __html: markdown(ki.text) }} /> : <p className="o-muted">Denkt nach …</p>}
                    {ki.aktion === "antwort" && ki.text && !kiLaeuft && (
                      <div className="o-post-ki-zeile">
                        <button type="button" className="o-chat-knopf" disabled={entwurf === "laeuft"} onClick={() => void entwurfAnlegen()}>{entwurf === "laeuft" ? <Arbeitet text="Legt an" /> : "Als Entwurf in Outlook anlegen"}</button>
                        {entwurf && entwurf !== "laeuft" && (entwurf.startsWith("http") ? <a className="o-chat-link" href={entwurf} target="_blank" rel="noopener noreferrer">Entwurf öffnen</a> : <span className="o-chat-vermerk">Entwurf angelegt</span>)}
                      </div>
                    )}
                  </div>)}
              </div>
              {html ? <div className="o-post-body o-body" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="o-post-body o-post-klartext">{nachricht.text}</pre>}
            </>}
        </article>
      </div>
    </div>
  );
}
