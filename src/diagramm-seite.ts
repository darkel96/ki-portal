/**
 * Diagramm-Seite für den Hub-Dienst: Der Dienst öffnet sie in einem Headless-Chromium, gibt Art und Quelltext im
 * Adress-Anker mit (Base64url aus JSON) und liest das Ergebnis aus #ergebnis (JSON mit PNG als Base64 oder Fehler).
 * Gezeichnet wird mit derselben Logik wie im Hub, damit Diagramme in Mail und Teams so aussehen wie im Ergebnis.
 */
import { diagrammAlsPng } from "./lib/diagramm";
import latin from "@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2?url";
import latinExt from "@fontsource-variable/noto-sans/files/noto-sans-latin-ext-wght-normal.woff2?url";

const ausgeben = (wert: unknown) => {
  const p = document.createElement("pre");
  p.id = "ergebnis";
  p.textContent = JSON.stringify(wert);
  document.body.append(p);
};

async function zeichnen() {
  // Mermaid ist auf „Noto Sans“ eingestellt; auf dem Server gibt es keine Systemschriften, deshalb die Schrift des Hubs
  for (const [url, bereich] of [[latin, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"], [latinExt, "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"]]) {
    const f = new FontFace("Noto Sans", `url(${url})`, { weight: "100 900", unicodeRange: bereich });
    document.fonts.add(f);
    await f.load();
  }
  const roh = location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const eingabe = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(roh), (c) => c.charCodeAt(0)))) as { art: "mermaid" | "svg"; code: string };
  const r = await diagrammAlsPng(eingabe.code, eingabe.art);
  let bin = "";
  for (let i = 0; i < r.png.length; i += 0x8000) bin += String.fromCharCode(...r.png.subarray(i, i + 0x8000));
  ausgeben({ png: btoa(bin), breite: r.breite, hoehe: r.hoehe });
}

zeichnen().catch((e) => ausgeben({ fehler: e instanceof Error ? e.message : String(e) }));
