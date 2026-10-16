/**
 * Diagramme in KI-Antworten (globale Regel): Die KI schreibt Abläufe, Organigramme oder Zeitpläne als Mermaid-Codeblock,
 * der Hub zeichnet sie im Chat und in Ergebnissen und bietet sie als SVG, PNG und draw.io zum Herunterladen an.
 * SVG-Codeblöcke werden bereinigt angezeigt, draw.io-Dateien (mxfile) direkt zum Herunterladen angeboten.
 * Mermaid wird erst geladen, wenn ein Diagramm vorkommt.
 */
import DOMPurify from "dompurify";
import { saveFile } from "./files";
import { slug } from "./model";

type Mermaid = typeof import("mermaid").default;
let mermaidLaden: Promise<Mermaid> | null = null;
function mermaid(): Promise<Mermaid> {
  mermaidLaden ??= import("mermaid").then(({ default: m }) => {
    m.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "base", htmlLabels: false,
      fontFamily: "Noto Sans, Segoe UI, Arial, sans-serif",
      // Ruhig und geschäftlich: helles Blau mit dunkler Schrift, abgerundete Formen
      themeVariables: { primaryColor: "#eaf1ff", primaryBorderColor: "#7d9fdc", primaryTextColor: "#00050d", secondaryColor: "#f0eeea", tertiaryColor: "#fbfaf9", lineColor: "#8a857e", clusterBkg: "#fbfaf9", clusterBorder: "#c9c4bc", edgeLabelBackground: "#ffffff", fontSize: "16px" },
      themeCSS: ".node rect, .node path { rx: 10px; ry: 10px; } .edgeLabel { font-size: 13px; font-weight: 600; }",
      // Breite Kästen statt schmaler Textsäulen, großzügige Abstände
      flowchart: { htmlLabels: false, useMaxWidth: true, curve: "step", padding: 18, nodeSpacing: 50, rankSpacing: 50, wrappingWidth: 400 },
    });
    return m;
  });
  return mermaidLaden;
}

// Mermaid zeichnet nacheinander (gemeinsamer Zustand); eine Warteschlange verhindert Überschneidungen
let schlange: Promise<unknown> = Promise.resolve();
let nr = 0;
/** Lange Fragen in Entscheidungsrauten umbrechen: Die Raute wächst mit der Textbreite und würde sonst riesig */
export function rautenUmbrechen(code: string, max = 22): string {
  if (!/^\s*(flowchart|graph)\b/.test(code)) return code;
  return code.replace(/(\b[\w-]+)\{(?!\{)([^{}\n]+)\}(?!\})/g, (ganz, id: string, roh: string) => {
    const zitat = /^".*"$/.test(roh.trim());
    const text = zitat ? roh.trim().slice(1, -1) : roh;
    if (/<br\s*\/?>/i.test(text) || text.length <= max) return ganz;
    const zeilen: string[] = [];
    let akt = "";
    for (const w of text.trim().split(/\s+/)) {
      if (akt && (akt + " " + w).length > max) { zeilen.push(akt); akt = w; } else akt = akt ? `${akt} ${w}` : w;
    }
    if (akt) zeilen.push(akt);
    const neu = zeilen.join("<br/>");
    return `${id}{${zitat ? `"${neu}"` : neu}}`;
  });
}

/** Mermaid-Quelltext als bereinigtes SVG */
export function mermaidSvg(code: string): Promise<string> {
  const lauf = schlange.then(async () => {
    const m = await mermaid();
    const id = `kihub-dia-${++nr}`;
    try {
      const { svg } = await m.render(id, rautenUmbrechen(code));
      return svgSauber(svg);
    } finally {
      // Bei Syntaxfehlern lässt Mermaid sein Fehlerbild im Dokument stehen
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  schlange = lauf.catch(() => undefined);
  return lauf;
}

/** SVG ohne Skripte, Ereignisse und fremde Inhalte */
export const svgSauber = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"] });

const htmlEsc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/\n/g, "&#xa;");
const hex = (farbe: string, ersatz: string) => {
  const m = farbe.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m || m[4] === "0") return farbe.startsWith("#") ? farbe : ersatz;
  return "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("");
};

/* ---------- Aufbau eines gezeichneten Ablaufdiagramms ---------- */
type Knoten = { mid: string; g: Element; form: Element };
type Kante = { id: string; von: string; nach: string };
/** Knoten und Kanten eines von Mermaid gezeichneten Flowcharts (leer bei anderen Diagrammarten) */
function graphAus(svg: SVGSVGElement): { knoten: Map<string, Knoten>; kanten: Kante[] } {
  const knoten = new Map<string, Knoten>();
  svg.querySelectorAll("g.node").forEach((g) => {
    const mid = (g.getAttribute("id") ?? "").replace(/^.*?flowchart-/, "").replace(/-\d+$/, "");
    const form = g.querySelector("rect, polygon, circle, ellipse, path");
    if (mid && form) knoten.set(mid, { mid, g, form });
  });
  const ids = [...knoten.keys()].sort((a, b) => b.length - a.length);
  const kanten: Kante[] = [];
  svg.querySelectorAll("path.flowchart-link, .edgePaths path").forEach((p) => {
    const id = p.getAttribute("data-id") ?? p.getAttribute("id") ?? "";
    const kern = id.replace(/^.*?L[_-]/, "").replace(/[_-]\d+$/, "");
    const von = ids.find((a) => kern.startsWith(a + "_") && knoten.has(kern.slice(a.length + 1)));
    if (von) kanten.push({ id, von, nach: kern.slice(von.length + 1) });
  });
  return { knoten, kanten };
}
const reihenVon = (el: Element | null) => (el ? [...el.querySelectorAll("tspan.row, tspan.text-outer-tspan")] : []);

/** Farben nach Rolle im Ablauf (wie in Präsentationen üblich): Start, Schritt, Entscheidung, Ergebnis */
const ROLLEN = {
  start: { fill: "#f0eeea", stroke: "#a8a29b", titel: "#2b2926", text: "#5c5a58" },
  schritt: { fill: "#e7f3ed", stroke: "#78b394", titel: "#0d4a33", text: "#2f6650" },
  entscheidung: { fill: "#2b2f36", stroke: "#2b2f36", titel: "#ffffff", text: "#e6e2dc" },
  ende: { fill: "#eceafb", stroke: "#8f86d8", titel: "#33288a", text: "#5b52a8" },
} as const;

/**
 * Gestaltet ein gezeichnetes Ablaufdiagramm: erste Zeile eines Kastens fett als Titel, weitere Zeilen kleiner als
 * Erläuterung, Farben nach Rolle (ohne eingehende Pfeile = Start, ohne ausgehende = Ergebnis, Raute = Entscheidung).
 * Hat die KI selbst Farben gesetzt (style/classDef), bleiben die. Natürliche Größe statt auf Spaltenbreite gestaucht.
 */
/** Beschriftung eines Knotens im Quelltext (A[Titel<br/>Erläuterung], B{Frage}, C("Text") …) */
function beschriftungIm(code: string, mid: string): string | null {
  const m = new RegExp(`(?:^|[^\\w-])${mid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[\\[({>]+`, "m").exec(code);
  if (!m) return null;
  const rest = code.slice(m.index + m[0].length);
  const ende = rest.search(/[\])}]/);
  return (ende < 0 ? rest : rest.slice(0, ende)).replace(/^"|"$/g, "").trim();
}

export function gestalten(svg: SVGSVGElement, code = ""): void {
  const eigeneFarben = /^\s*(style|classDef|class|linkStyle)\s/m.test(code);
  const { knoten, kanten } = graphAus(svg);
  const rein = new Set(kanten.map((k) => k.nach)), raus = new Set(kanten.map((k) => k.von));
  knoten.forEach((k) => {
    const rolle = k.form.tagName === "polygon" ? "entscheidung" : !rein.has(k.mid) && raus.size ? "start" : !raus.has(k.mid) && rein.size ? "ende" : "schritt";
    const f = ROLLEN[rolle];
    if (!eigeneFarben) (k.form as SVGElement).style.cssText += `fill:${f.fill};stroke:${f.stroke};stroke-width:1.3px;`;
    const reihen = reihenVon(k.g.querySelector("text"));
    const raute = rolle === "entscheidung";
    // Positionen von em in Pixel umrechnen: sonst rückt die kleinere Erläuterung an den Titel heran
    const basis = parseFloat(reihen[0] ? getComputedStyle(reihen[0]).fontSize : "") || 16;
    const px = (v: string | null) => (v && /em$/.test(v) ? parseFloat(v) * basis : parseFloat(v ?? "0") || 0);
    // Titel = erste Zeile der Beschriftung (bei Umbruch über mehrere Reihen); ohne <br/> ist alles Titel
    const quelle = beschriftungIm(code, k.mid);
    const teile = quelle ? quelle.split(/<br\s*\/?>/i) : [];
    const titelLaenge = teile.length > 1 ? teile[0].replace(/\s+/g, "").length : Infinity;
    let bisher = 0;
    const istTitel = reihen.map((r) => { const t = bisher < titelLaenge; bisher += (r.textContent ?? "").replace(/\s+/g, "").length; return t || raute; });
    const versatz = istTitel.includes(false) ? 2.5 : 0;
    reihen.forEach((r, i) => {
      const st = (r as SVGElement).style;
      const titel = istTitel[i];
      r.setAttribute("y", `${px(r.getAttribute("y")) + (titel ? -versatz : versatz)}px`);
      r.setAttribute("dy", `${px(r.getAttribute("dy"))}px`);
      if (!titel) st.fontSize = "0.84em";
      if (!eigeneFarben) st.fill = titel ? f.titel : f.text;
      // Die inneren Wörter tragen font-weight="normal" als Attribut: dort setzen
      r.querySelectorAll("tspan").forEach((w) => { (w as SVGElement).style.fontWeight = titel ? "700" : "400"; });
    });
  });
  const vb = svg.viewBox.baseVal;
  // Im Chat kleiner (--dia-mass), damit mehr vom Ablauf auf einmal zu sehen ist
  if (vb?.width) { svg.style.width = `calc(${Math.round(vb.width)}px * var(--dia-mass, 1))`; svg.style.maxWidth = "100%"; svg.style.height = "auto"; }
}

/** SVG als eigenständige Datei: mit Namensraum und fester Größe */
function svgDatei(svg: SVGSVGElement): { text: string; breite: number; hoehe: number } {
  const kopie = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const breite = Math.ceil(vb?.width || svg.getBoundingClientRect().width || 800), hoehe = Math.ceil(vb?.height || svg.getBoundingClientRect().height || 600);
  kopie.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  kopie.setAttribute("width", String(breite));
  kopie.setAttribute("height", String(hoehe));
  kopie.removeAttribute("style");
  return { text: new XMLSerializer().serializeToString(kopie), breite, hoehe };
}

/** Diagramm-Quelltext (Mermaid oder SVG) als PNG für Word, PDF und PowerPoint */
export async function diagrammAlsPng(code: string, art: "mermaid" | "svg"): Promise<{ png: Uint8Array; breite: number; hoehe: number }> {
  const sauber = art === "mermaid" ? await mermaidSvg(code) : svgSauber(code);
  // Kurz ins Dokument hängen, damit Schriften und Maße stimmen
  const halter = document.createElement("div");
  halter.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden";
  halter.innerHTML = sauber;
  document.body.append(halter);
  try {
    const svg = halter.querySelector("svg");
    if (!svg) throw new Error("Kein Diagramm");
    if (art === "mermaid") gestalten(svg, code);
    const s = svgDatei(svg);
    const blob = await svgAlsPng(s.text, s.breite, s.hoehe);
    return { png: new Uint8Array(await blob.arrayBuffer()), breite: s.breite, hoehe: s.hoehe };
  } finally { halter.remove(); }
}

/** SVG als PNG (doppelte Auflösung, weißer Hintergrund) */
export async function svgAlsPng(svgText: string, breite: number, hoehe: number, faktor = 2): Promise<Blob> {
  const bild = new Image();
  bild.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
  await bild.decode();
  const c = document.createElement("canvas");
  c.width = Math.round(breite * faktor); c.height = Math.round(hoehe * faktor);
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bild, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error("PNG konnte nicht erzeugt werden."))), "image/png"));
}

/**
 * Gezeichnetes Diagramm als draw.io-Datei. Ablaufdiagramme (Mermaid-Flowchart) werden zu bearbeitbaren Formen und
 * Verbindern mit den Positionen aus der Zeichnung; alles andere kommt als Bild in die Datei.
 */
export function alsDrawio(svg: SVGSVGElement, titel: string): string {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const mass = vb?.width && box.width ? vb.width / box.width : 1;
  const lage = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round((r.left - box.left) * mass), y: Math.round((r.top - box.top) * mass), w: Math.max(20, Math.round(r.width * mass)), h: Math.max(20, Math.round(r.height * mass)) };
  };
  const zeilen = (el: Element | null) => {
    if (!el) return "";
    const reihen = [...el.querySelectorAll("tspan.row, tspan.text-outer-tspan")].map((t) => t.textContent?.trim() ?? "").filter(Boolean);
    return (reihen.length ? reihen.join("\n") : (el.textContent ?? "").replace(/\s+/g, " ")).trim();
  };
  const zellen: string[] = [];
  const knoten = new Map<string, string>();
  let n = 2;
  // Gruppen (subgraph) zuerst, damit sie hinter den Formen liegen
  svg.querySelectorAll("g.cluster").forEach((g) => {
    const form = g.querySelector("rect");
    if (!form) return;
    const l = lage(form);
    zellen.push(`<mxCell id="c${n++}" value="${xmlEsc(zeilen(g.querySelector(".cluster-label") ?? g.querySelector("text")))}" style="rounded=1;dashed=1;fillColor=none;verticalAlign=top;fontStyle=1;strokeColor=#8a94a3;" vertex="1" parent="1"><mxGeometry x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" as="geometry"/></mxCell>`);
  });
  const { knoten: graph, kanten } = graphAus(svg);
  graph.forEach(({ mid, g, form }) => {
    const l = lage(form);
    const st = getComputedStyle(form);
    const reihen = reihenVon(g.querySelector("text"));
    const farbe = (el: Element | undefined, ersatz: string) => (el ? hex(getComputedStyle(el).fill, ersatz) : ersatz);
    const art = form.tagName === "polygon" ? "rhombus;" : form.tagName === "circle" || form.tagName === "ellipse" ? "ellipse;" : "rounded=1;arcSize=12;";
    const id = `k${n++}`;
    knoten.set(mid, id);
    // Titel fett, Erläuterung kleiner (wie in der Zeichnung)
    const texte = reihen.map((r) => r.textContent?.trim() ?? "").filter(Boolean);
    const html = texte.length > 1
      ? `<b>${htmlEsc(texte[0])}</b><br><font style="font-size:11px" color="${farbe(reihen[1], "#1f2328")}">${texte.slice(1).map(htmlEsc).join("<br>")}</font>`
      : `<b>${htmlEsc(texte[0] ?? zeilen(g))}</b>`;
    zellen.push(`<mxCell id="${id}" value="${xmlEsc(html)}" style="${art}whiteSpace=wrap;html=1;fillColor=${hex(st.fill, "#eef2f7")};strokeColor=${hex(st.stroke, "#5b6b7f")};fontColor=${farbe(reihen[0], "#1f2328")};" vertex="1" parent="1"><mxGeometry x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" as="geometry"/></mxCell>`);
  });
  if (knoten.size) {
    kanten.forEach((k) => {
      if (!knoten.has(k.nach)) return;
      const beschriftung = zeilen(svg.querySelector(`.edgeLabels [data-id="${CSS.escape(k.id.replace(/^.*?(L[_-])/, "$1"))}"]`));
      zellen.push(`<mxCell id="e${n++}" value="${xmlEsc(beschriftung)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow=block;strokeColor=#8a857e;fontColor=#1f2328;fontStyle=1;labelBackgroundColor=#ffffff;" edge="1" parent="1" source="${knoten.get(k.von)}" target="${knoten.get(k.nach)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    });
  } else {
    // Kein Ablaufdiagramm: als Bild einbetten (bleibt in draw.io sichtbar und lässt sich überzeichnen)
    const { text, breite, hoehe } = svgDatei(svg);
    const daten = btoa(unescape(encodeURIComponent(text)));
    zellen.push(`<mxCell id="b${n++}" value="" style="shape=image;imageAspect=0;aspect=fixed;image=data:image/svg+xml,${daten};" vertex="1" parent="1"><mxGeometry x="0" y="0" width="${breite}" height="${hoehe}" as="geometry"/></mxCell>`);
  }
  return `<mxfile host="KI-Hub"><diagram name="${xmlEsc(titel || "Diagramm")}"><mxGraphModel grid="1" gridSize="10" page="1" pageWidth="1169" pageHeight="827"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${zellen.join("")}</root></mxGraphModel></diagram></mxfile>`;
}

const knopf = (text: string, label: string, onClick: () => void | Promise<void>) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "o-diagramm-knopf"; b.textContent = text; b.setAttribute("aria-label", label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
};

/** Aus einem Diagramm-Block die Downloads (SVG, PNG, draw.io, Quelltext) */
function aktionen(fig: HTMLElement, svg: SVGSVGElement | null, quelle: { name: string; endung: string; text: string } | null, titel: string) {
  const leiste = document.createElement("div");
  leiste.className = "o-diagramm-aktionen";
  const name = slug(titel || "Diagramm") || "Diagramm";
  const span = document.createElement("span");
  span.textContent = "Herunterladen:";
  leiste.append(span);
  if (svg) {
    leiste.append(
      knopf("SVG", `${titel || "Diagramm"} als SVG herunterladen`, () => saveFile(`${name}.svg`, svgDatei(svg).text, "image/svg+xml")),
      knopf("PNG", `${titel || "Diagramm"} als PNG herunterladen`, async () => { const s = svgDatei(svg); await saveFile(`${name}.png`, await svgAlsPng(s.text, s.breite, s.hoehe), "image/png"); }),
      knopf("draw.io", `${titel || "Diagramm"} als draw.io-Datei herunterladen`, () => saveFile(`${name}.drawio`, alsDrawio(svg, titel), "application/vnd.jgraph.mxfile")),
    );
  }
  // Im Chat: zwischen kompakter und voller Größe umschalten
  if (svg && fig.closest(".o-chat")) {
    const gross = knopf("Größer", `${titel || "Diagramm"} größer anzeigen`, () => {
      const an = fig.toggleAttribute("data-gross");
      gross.textContent = an ? "Kleiner" : "Größer";
      gross.setAttribute("aria-label", `${titel || "Diagramm"} ${an ? "kleiner" : "größer"} anzeigen`);
    });
    gross.classList.add("o-diagramm-zoom");
    leiste.prepend(gross);
  }
  if (quelle) leiste.append(knopf(quelle.name, `${titel || "Diagramm"} als ${quelle.name} herunterladen`, () => saveFile(`${name}.${quelle.endung}`, quelle.text, "text/plain;charset=utf-8")));
  fig.append(leiste);
}

/** Überschrift über dem Diagramm im Text (für Dateinamen), sonst der übergebene Name */
const titelVon = (fig: HTMLElement, ersatz: string) => {
  let el: Element | null = fig.previousElementSibling;
  for (let i = 0; el && i < 3; i++, el = el.previousElementSibling) if (/^H\d$/.test(el.tagName)) return el.textContent?.trim() || ersatz;
  return ersatz;
};

/**
 * Zeichnet alle noch nicht gezeichneten Diagramm-Blöcke in einem Bereich (Chat-Verlauf, Ergebnis). Wiederholt
 * aufrufbar; Blöcke einer noch laufenden Antwort (offen) bleiben vorerst Quelltext.
 */
export async function diagrammeZeichnen(bereich: HTMLElement | null, name = "Diagramm"): Promise<void> {
  if (!bereich) return;
  const blocks = [...bereich.querySelectorAll<HTMLElement>("figure.o-diagramm:not([data-stand]):not([data-offen])")];
  for (const fig of blocks) {
    fig.dataset.stand = "zeichnet";
    const pre = fig.querySelector("pre");
    const code = pre?.textContent ?? "";
    const titel = titelVon(fig, name);
    const quelltext = (beschriftung: string) => {
      if (!pre) return;
      const d = document.createElement("details");
      d.className = "o-diagramm-quelle";
      const s = document.createElement("summary");
      s.textContent = beschriftung;
      d.append(s, pre);
      fig.append(d);
    };
    try {
      if (fig.dataset.art === "drawio") {
        const hinweis = document.createElement("p");
        hinweis.className = "o-muted";
        hinweis.textContent = "draw.io-Diagramm: herunterladen und in draw.io (diagrams.net) öffnen.";
        fig.prepend(hinweis);
        pre?.remove();
        aktionen(fig, null, { name: "draw.io", endung: "drawio", text: code }, titel);
        quelltext("XML-Quelltext");
      } else {
        const sauber = fig.dataset.art === "mermaid" ? await mermaidSvg(code) : svgSauber(code);
        if (!fig.isConnected) continue;
        const bild = document.createElement("div");
        bild.className = "o-diagramm-bild";
        bild.innerHTML = sauber;
        const svg = bild.querySelector("svg");
        if (!svg) throw new Error("leer");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", titel);
        pre?.remove();
        fig.prepend(bild);
        if (fig.dataset.art === "mermaid") gestalten(svg, code);
        aktionen(fig, svg, fig.dataset.art === "mermaid" ? { name: "Mermaid", endung: "mmd", text: code } : null, titel);
        quelltext(fig.dataset.art === "mermaid" ? "Mermaid-Quelltext" : "SVG-Quelltext");
      }
      fig.dataset.stand = "fertig";
    } catch {
      fig.dataset.stand = "fehler";
      const p = document.createElement("p");
      p.className = "o-muted";
      p.textContent = "Das Diagramm konnte nicht gezeichnet werden. Der Quelltext steht hier; er lässt sich z. B. in draw.io über Anordnen → Einfügen → Mermaid öffnen.";
      fig.prepend(p);
    }
  }
}
