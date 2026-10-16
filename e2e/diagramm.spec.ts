import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const ABLAUF = "flowchart TD\n  A[Mitarbeitende<br/>Idee, Frage oder Problem] --> B[KI-Keyuser der Abteilung]\n  B --> C[Dario Keller]\n  C --> D{Lokal umsetzbar?}\n  D -->|Ja| E[Umsetzung in Leingarten]\n  D -->|Nein / BA-Thema| F[Abstimmung mit der BA]";
const ANTWORT = `So läuft eine KI-Idee durch die Organisation:\n\n## Ablauf KI-Ideen\n\n\`\`\`mermaid\n${ABLAUF}\n\`\`\`\n\nDatei: [CRA_Projekt-IT_Ablaufdiagramm.drawio](https://eu-prod.asyncgw.teams.microsoft.com/v1/objects/0-weu-d17-2a34/views/original/CRA_Projekt-IT_Ablaufdiagramm.drawio)`;

test("Chat: Diagramm wird gezeichnet und als SVG, PNG und draw.io angeboten", async ({ page }, info) => {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { system?: string | { text: string }[]; messages?: { content: string | { type: string; text?: string }[] }[] };
    prompts.push(JSON.stringify(body));
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: ANTWORT } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  await page.goto("/app/cra-experte");
  const chat = page.locator(".o-chat");
  await chat.getByLabel("Frage", { exact: true }).fill("Zeichne den Ablauf für KI-Ideen");
  await chat.getByRole("button", { name: "Senden" }).click();

  const fig = chat.locator("figure.o-diagramm");
  await expect(fig).toHaveAttribute("data-stand", "fertig", { timeout: 20_000 });
  await expect(fig.getByRole("img", { name: "Ablauf KI-Ideen" })).toBeVisible();
  await expect(fig.locator("svg")).toContainText("Lokal umsetzbar?");
  // Die globale Regel steht in der Anfrage
  expect(prompts[0]).toContain("Mermaid-Codeblock");
  expect(prompts[0]).toContain("Verweise nie auf Download-Links");
  // Toter Copilot-Link: Hinweis statt Link ins Leere
  await expect(chat.getByText("(nur in Copilot abrufbar)")).toBeVisible();
  await expect(chat.locator('a[href*="asyncgw.teams.microsoft.com"]')).toHaveCount(0);
  await page.screenshot({ path: `screenshots/${info.project.name}-diagramm-chat.png` });
  if (info.project.name !== "desktop") return;

  // draw.io: bearbeitbare Formen und Verbinder mit Beschriftungen
  const dl = page.waitForEvent("download");
  await fig.getByRole("button", { name: "Ablauf KI-Ideen als draw.io-Datei herunterladen" }).click();
  const drawio = readFileSync((await (await dl).path())!, "utf8");
  expect((await dl).suggestedFilename()).toMatch(/\.drawio$/);
  expect(drawio).toContain("<mxfile");
  // Titel fett, Erläuterung kleiner; Farben nach Rolle (Start grau, Entscheidung dunkel, Ergebnis violett)
  expect(drawio).toContain('value="&lt;b&gt;Lokal umsetzbar?&lt;/b&gt;" style="rhombus;whiteSpace=wrap;html=1;fillColor=#2b2f36;');
  expect(drawio).toMatch(/value="&lt;b&gt;Mitarbeitende&lt;\/b&gt;&lt;br&gt;&lt;font[^"]*&gt;Idee, Frage oder Problem&lt;\/font&gt;" style="rounded=1;[^"]*fillColor=#f0eeea;/);
  expect(drawio).toMatch(/Umsetzung in Leingarten[^"]*" style="[^"]*fillColor=#eceafb;/);
  expect(drawio.match(/edge="1"/g)?.length).toBe(5);
  expect(drawio).toContain('value="Nein / BA-Thema"');
  // PNG und SVG
  const png = page.waitForEvent("download");
  await fig.getByRole("button", { name: "Ablauf KI-Ideen als PNG herunterladen" }).click();
  const pngDaten = readFileSync((await (await png).path())!);
  expect(pngDaten.subarray(1, 4).toString()).toBe("PNG");
  const svg = page.waitForEvent("download");
  await fig.getByRole("button", { name: "Ablauf KI-Ideen als SVG herunterladen" }).click();
  const svgText = readFileSync((await (await svg).path())!, "utf8");
  expect(svgText).toMatch(/^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svgText).not.toMatch(/<script|onload=/i);
  // Quelltext bleibt erreichbar
  await fig.getByText("Mermaid-Quelltext").click();
  await expect(fig.locator("pre")).toContainText("flowchart TD");
});

test("Diagramme: fehlerhaftes Mermaid bleibt lesbar, SVG wird bereinigt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const md = await import("/src/lib/markdown.ts");
    const dia = await import("/src/lib/diagramm.ts");
    const div = document.createElement("div");
    document.body.append(div);
    div.innerHTML = md.markdown("```mermaid\nflowchart TD\n  A[[[ kaputt\n```\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\" onload=\"alert(1)\"><script>alert(2)</script><rect width=\"10\" height=\"10\"/></svg>\n```\n\n```mermaid\nflowchart TD\n  A --> B");
    await dia.diagrammeZeichnen(div, "Test");
    const figs = [...div.querySelectorAll("figure")];
    return { stand: figs.map((f) => f.getAttribute("data-stand") ?? `offen=${f.getAttribute("data-offen")}`), fehlerText: figs[0].textContent, svg: figs[1].querySelector(".o-diagramm-bild")?.innerHTML ?? "", reste: document.querySelectorAll("[id^='dkihub-dia']").length };
  });
  expect(r.stand).toEqual(["fehler", "fertig", "offen=1"]); // nicht geschlossener Block (Antwort läuft noch) wartet
  expect(r.fehlerText).toContain("A[[[ kaputt");
  expect(r.svg).toContain("<rect");
  expect(r.svg).not.toMatch(/script|onload/i);
  expect(r.reste).toBe(0);
});

test("Diagramme kommen als Bild in Word, PDF, PowerPoint und Word mit Firmenvorlage", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const vorlage = readFileSync("testdaten/Angebot_Brennecke_AN-2026-1187.docx").toString("base64");
  const r = await page.evaluate(async ({ md, vorlage }) => {
    const dok = await import("/src/lib/dokument.ts");
    const b64 = async (blob: Blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const meta = { titel: "Ablauf", app: "CRA" };
    return {
      docx: await b64(await dok.dateiErzeugen("docx", md, meta)),
      vorlage: await b64(await dok.dateiErzeugen("docx", md, { ...meta, vorlage })),
      pptx: await b64(await dok.dateiErzeugen("pptx", md, meta)),
      pdf: (await dok.dateiErzeugen("pdf", md, meta)).size,
    };
  }, { md: `# Ablauf\n\n## Ablauf KI-Ideen\n\n\`\`\`mermaid\n${ABLAUF}\n\`\`\`\n\nText danach.`, vorlage });
  for (const name of ["docx", "vorlage"] as const) {
    const z = await JSZip.loadAsync(Buffer.from(r[name], "base64"));
    const xml = await z.file("word/document.xml")!.async("string");
    expect(xml, name).toContain("<w:drawing>");
    expect(xml, name).not.toContain("flowchart TD");
    expect(xml, name).toContain("Text danach.");
    expect(Object.keys(z.files).some((p) => /^word\/media\/.+\.png$/.test(p)), name).toBe(true);
    const rels = await z.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels, name).toMatch(/relationships\/image/);
    expect(await z.file("[Content_Types].xml")!.async("string"), name).toMatch(/Extension="png"/i);
  }
  const pp = await JSZip.loadAsync(Buffer.from(r.pptx, "base64"));
  expect(Object.keys(pp.files).some((p) => /^ppt\/media\/.+\.png$/.test(p))).toBe(true);
  expect(r.pdf).toBeGreaterThan(5000);
});

test("Diagramme: Gestaltung nach Rolle, Titel fett, lange Fragen umbrochen, Text-Pfeildiagramm wird gezeichnet", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (ablauf) => {
    const md = await import("/src/lib/markdown.ts");
    const dia = await import("/src/lib/diagramm.ts");
    const div = document.createElement("div");
    document.body.append(div);
    const text = "```text\nCRA Quick Check\n      ↓\nRisk Classification\nCRA-Geltungsbereich + Produktklassifizierung\n      ↓\nBetrieb / Lifecycle\nSBOM + Sicherheitsupdates\n```";
    div.innerHTML = md.markdown("## Ablauf\n\n```mermaid\n" + ablauf + "\n  F --> G[Schwachstellen überwachen und dauerhaft bewerten im Betrieb]\n```\n\n" + text);
    await dia.diagrammeZeichnen(div, "Test");
    const [eins, zwei] = [...div.querySelectorAll("figure")];
    const knoten = (fig: Element, teil: string) => [...fig.querySelectorAll("g.node")].find((g) => g.textContent?.includes(teil))!;
    const reihen = (g: Element) => [...g.querySelectorAll("tspan.row")].map((t) => ({ text: t.textContent, gewicht: (t.querySelector("tspan") as SVGElement).style.fontWeight, groesse: (t as SVGElement).style.fontSize }));
    return {
      start: (knoten(eins, "Mitarbeitende").querySelector("rect") as SVGElement).style.fill,
      raute: (knoten(eins, "Lokal umsetzbar?").querySelector("polygon") as SVGElement).style.fill,
      schritt: (knoten(eins, "Dario Keller").querySelector("rect") as SVGElement).style.fill,
      reihenStart: reihen(knoten(eins, "Mitarbeitende")),
      // ohne <br/> umgebrochen: alles Titel, keine kleine zweite Zeile
      reihenLang: reihen(knoten(eins, "Schwachstellen")),
      textAblauf: { stand: zwei.getAttribute("data-stand"), kaesten: zwei.querySelectorAll("g.node").length, quelle: zwei.querySelector("pre")?.textContent },
      umbruch: dia.rautenUmbrechen("flowchart TD\n  M{Aktiv ausgenutzt oder schwerer Sicherheitsvorfall?} --> N[Ok]\n  X{{Sechseck bleibt}}"),
    };
  }, ABLAUF);
  expect(r.start).toBe("rgb(240, 238, 234)");
  expect(r.raute).toBe("rgb(43, 47, 54)");
  expect(r.schritt).toBe("rgb(231, 243, 237)");
  expect(r.reihenStart).toEqual([{ text: "Mitarbeitende", gewicht: "700", groesse: "" }, { text: "Idee, Frage oder Problem", gewicht: "400", groesse: "0.84em" }]);
  expect(r.reihenLang.every((x) => x.gewicht === "700" && !x.groesse)).toBe(true);
  expect(r.textAblauf.stand).toBe("fertig");
  expect(r.textAblauf.kaesten).toBe(3);
  expect(r.textAblauf.quelle).toContain('n1["Risk Classification<br/>CRA-Geltungsbereich + Produktklassifizierung"]');
  expect(r.umbruch).toContain("M{Aktiv ausgenutzt oder<br/>schwerer<br/>Sicherheitsvorfall?}");
  expect(r.umbruch).toContain("X{{Sechseck bleibt}}");
});
