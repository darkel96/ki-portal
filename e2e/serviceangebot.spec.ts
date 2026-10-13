import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";

/** Word-Formular mit allen drei Kästchen-Arten (Inhaltssteuerelement, altes Formularfeld, Wingdings-Symbol) und einer Tabelle */
async function checklisteDocx(): Promise<Buffer> {
  const cb = (an: boolean) => `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${an ? 1 : 0}"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>${an ? "☒" : "☐"}</w:t></w:r></w:sdtContent></w:sdt>`;
  const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
  const alt = (an: boolean) => `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="K"/><w:checkBox><w:sizeAuto/><w:default w:val="${an ? 1 : 0}"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText>FORMCHECKBOX</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>X</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
<w:p>${t("Service-Checkliste Beispielkunde GmbH, Projekt Hochregallager, Angebot 4711")}</w:p>
<w:p>${t("Pos. 4 Wartungsvertrag Ja ")}${cb(true)}${t(" Nein ")}${cb(false)}</w:p>
<w:p>${t("Pos. 1 Ersatzteilpaket Ja ")}${alt(false)}${t(" Nein ")}${alt(true)}</w:p>
<w:p>${t("Pos. 3 Schulung Ja ")}<w:r><w:sym w:font="Wingdings" w:char="F0FE"/></w:r>${t(" Nein ")}<w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p>${t("Standort")}</w:p></w:tc><w:tc><w:p>${t("St. Gallen")}</w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", xml);
  return z.generateAsync({ type: "nodebuffer" });
}

const LESEN = JSON.stringify({
  kunde: "Beispielkunde GmbH", projekt: "Hochregallager", angebotsnummer: "4711", standort: "St. Gallen", sprache: "Deutsch",
  produkte: { ersatzteile: { status: "Nein", fundstelle: "Pos. 1", angaben: "" }, hotline: { status: "Unklar", fundstelle: "Pos. 2", angaben: "" }, schulung: { status: "Ja", fundstelle: "Pos. 3", angaben: "2 Tage" },
    wartung: { status: "Ja", fundstelle: "Pos. 4", angaben: "4.4 Schichtbetrieb: 2-Schicht" }, vorort: { status: "Nein", fundstelle: "Pos. 5", angaben: "" }, software: { status: "Widersprüchlich", fundstelle: "Pos. 6", angaben: "beide Kästchen" } },
  lieferumfang: "", bericht: "- **Pos. 4 Wartungsvertrag**: Ja – Pos. 4\n- **Pos. 6 Softwarepflege**: Widersprüchlich – beide Kästchen",
});
const PAKET = JSON.stringify({ hinweis: "Struktur für 4711", dateien: [{ pfad: "Serviceangebot_4711/00_Pruefprotokoll.md", inhalt: "# Prüfprotokoll\n\n- Wartungsvertrag – Ja – angelegt" }, { pfad: "Serviceangebot_4711/04_Wartungsvertrag/Leistungsbeschreibung.md", inhalt: "# Wartungsvertrag" }] });

/** Nachgebaute KI: antwortet je nach Auftrag mit JSON, einem Dateipaket oder Markdown; merkt sich die Prompts. */
async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string }[] };
    const prompt = String(body?.messages?.[0]?.content ?? "");
    prompts.push(prompt);
    const text = /Antworte nur mit JSON dieser Form/.test(prompt) ? LESEN : /Dateipaket/.test(prompt) ? PAKET : "- **Hinweis**: Pos. 6 ist widersprüchlich.";
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  return prompts;
}

test("Serviceangebot: Checkliste lesen, Prüfseite korrigieren, ZIP", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Prüfseite mit zwei Spalten: einmal auf dem Desktop reicht");
  const prompts = await kiNachbau(page);
  await page.goto("/app/serviceangebot");
  await expect(page.getByRole("heading", { name: "Serviceangebot vorbereiten", level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "Service_Checkliste.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await checklisteDocx() });
  await expect(page.getByText(/Service_Checkliste\.docx gelesen/)).toBeVisible();
  await page.getByLabel("Angebotssprache").selectOption("Deutsch");
  await page.getByRole("button", { name: "Checkliste lesen" }).click();

  // Prüfseite: Felder aus dem JSON vorbelegt, Bericht als Markdown
  await expect(page.getByRole("heading", { name: "Das hat Copilot gelesen" })).toBeVisible();
  await expect(page.getByLabel("Kunde")).toHaveValue("Beispielkunde GmbH", { timeout: 10_000 });
  await expect(page.getByLabel("Pos. 4 Wartungsvertrag")).toHaveValue("Ja");
  await expect(page.getByLabel("Pos. 6 Softwarepflege")).toHaveValue("Widersprüchlich");
  await expect(page.getByLabel("Angaben zu Wartungsvertrag")).toHaveValue("4.4 Schichtbetrieb: 2-Schicht");
  await page.screenshot({ path: "screenshots/desktop-serviceangebot-pruefseite.png" });
  await expect(page.locator("[data-src] .o-body strong", { hasText: "Pos. 4 Wartungsvertrag" }).first()).toBeVisible();
  // Der Word-Leser hat die Kästchen erhalten: angekreuzt ☒, leer ☐, bei allen drei Arten, dazu die Tabelle
  const lese = prompts[0];
  expect(lese).toContain("Wartungsvertrag Ja ☒ Nein ☐");
  expect(lese).toContain("Ersatzteilpaket Ja ☐ Nein ☒");
  expect(lese).toContain("Schulung Ja ☒ Nein ☐");
  expect(lese).toContain("| Standort | St. Gallen |");
  expect(lese).not.toContain("FORMCHECKBOX");
  // Korrektur von Hand bleibt erhalten und geht in die nächsten Schritte
  await page.getByLabel("Pos. 6 Softwarepflege").selectOption("Nein");

  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter/ }).click();
  await page.getByRole("button", { name: "Checkliste plausibilisieren" }).click();
  await expect(page.locator('[data-src][data-status="fertig"]', { hasText: "Plausibilisierung" })).toBeVisible({ timeout: 10_000 });
  expect(prompts.at(-1)).toContain("Pos. 6 Softwarepflege: Nein");
  await page.getByRole("button", { name: /Weiter zur Auswertung/ }).click();
  await expect(page.getByRole("heading", { name: "Ergebnisse" })).toBeVisible();
  await expect(page.locator(".e-kachel .status-pill")).toHaveText(["Fertig", "Fertig"], { timeout: 15_000 });
  // Das ZIP steht zum Herunterladen bereit; auf dem letzten Ergebnis führt der Pager zurück zur Übersicht statt eines toten „Weiter“
  await page.locator(".e-kachel", { hasText: "Angebotsstruktur" }).click();
  await expect(page.getByRole("button", { name: /ZIP mit Word-Dateien/ })).toBeVisible();
  await expect(page.locator("pre.code", { hasText: "Serviceangebot_4711/" })).toBeVisible();
  const pager = page.getByRole("navigation", { name: "Ergebnisse blättern" });
  await expect(pager.getByRole("button", { name: "Weiter" })).toHaveCount(0);
  await pager.getByRole("button", { name: "Alle Ergebnisse" }).click();
  await expect(page.getByRole("heading", { name: "Ergebnisse" })).toBeVisible();
  // „Neu erstellen“ in der Übersicht lässt den Lese-Schritt und die geprüften Werte in Ruhe
  expect(prompts.filter((p) => /Antworte nur mit JSON dieser Form/.test(p))).toHaveLength(1);
});
