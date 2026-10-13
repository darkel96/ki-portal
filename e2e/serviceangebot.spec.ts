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

const st = (wert: string, hinweis: string, klaeren = false) => ({ wert, hinweis, klaeren });
const LESEN = JSON.stringify({
  kunde: "Beispielkunde GmbH", projekt: "Hochregallager", standort: "St. Gallen", sprache: st("Deutsch", "Seite 1: Deutsch angekreuzt"),
  produkte: { remoteservice: { status: st("Ja", "Pos. 1: Ja angekreuzt; RA und SM"), nummer: "190014105", angaben: "RA, SM" }, softwaremaintenance: { status: st("Nein", "Pos. 2: Nein angekreuzt"), nummer: "", angaben: "" }, itservices: { status: st("Unklar", "Pos. 3: kein Kästchen angekreuzt", true), nummer: "", angaben: "" },
    wartungsvertrag: { status: st("Ja", "Pos. 4: Ja angekreuzt; 4.4 Schichtbetrieb 2-Schicht"), nummer: "", angaben: "4.4 Schichtbetrieb: 2-Schicht" }, ersatzteilpaket: { status: st("Nein", "Pos. 5: Nein angekreuzt"), nummer: "", angaben: "" }, residentmaintenance: { status: st("Widersprüchlich", "Pos. 6: beide Kästchen angekreuzt", true), nummer: "", angaben: "beide Kästchen" } },
  lieferumfang: "", offen: "",
});
const PAKET = JSON.stringify({
  hinweis: "Struktur für Beispielkunde",
  ordner: ["Beispielkunde_GmbH_Hochregallager_Serviceangebotsstruktur/RS_190014105_Remote_Service/01_Request", "Beispielkunde_GmbH_Hochregallager_Serviceangebotsstruktur/RS_190014105_Remote_Service/04_Suppliers/RA"],
  kopien: [{ quelle: "Kalkulation/Remote Services Calculation.xltm", ziel: "Beispielkunde_GmbH_Hochregallager_Serviceangebotsstruktur/RS_190014105_Remote_Service/03_Calculation/Rev00/Remote Services Calculation.xltm" }],
  dateien: [{ pfad: "Beispielkunde_GmbH_Hochregallager_Serviceangebotsstruktur/Pruefprotokoll.txt", inhalt: "Remote Service (Z30) – Ja – angelegt ja" }, { pfad: "Beispielkunde_GmbH_Hochregallager_Serviceangebotsstruktur/Angebotszusammenfassung.md", inhalt: "# Serviceangebot" }],
});

/** Nachgebaute KI: antwortet je nach Auftrag mit JSON, einem Dateipaket oder Markdown; merkt sich die Prompts. */
async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string }[] };
    const prompt = String(body?.messages?.[0]?.content ?? "");
    prompts.push(prompt);
    const text = /Antworte nur mit JSON dieser Form/.test(prompt) ? LESEN : /Dateipaket/.test(prompt) ? PAKET : "- **Hinweis**: Pos. 6 ist widersprüchlich.";
    await new Promise((r) => setTimeout(r, 700));   // kurz „arbeiten“, damit sich Zwischenzustände prüfen lassen
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
  // „Weiter“ auf die Prüfseite startet den Lese-Schritt von selbst; die Felder füllen sich, sobald er fertig ist
  const weiter = () => page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter|Ergebnisse erstellen/ }).click();
  await weiter();
  await expect(page.getByRole("heading", { name: "Gelesene Werte prüfen (1 von 2)" })).toBeVisible();
  // Solange Copilot liest: Hinweisleiste, „Weiter“ ausgegraut, Punkte blättern nicht vor
  const weiterKnopf = page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Weiter/ });
  await expect(page.getByText("„Checkliste lesen“ läuft, die Felder werden gleich ausgefüllt …")).toBeVisible();
  await expect(weiterKnopf).toBeDisabled();
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Seite 3/ }).click();
  await expect(page.getByRole("heading", { name: "Gelesene Werte prüfen (1 von 2)" })).toBeVisible();
  await expect(weiterKnopf).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByLabel("Kunde")).toHaveValue("Beispielkunde GmbH", { timeout: 10_000 });
  await expect(page.getByLabel("Angebotssprache")).toHaveValue("Deutsch");
  await expect(page.getByLabel("Remote Service (Z30)")).toHaveValue("Ja");
  await expect(page.getByLabel("Angebotsnummer Remote Service")).toHaveValue("190014105");
  await expect(page.getByLabel("Angekreuzt bei Remote Service")).toHaveValue("RA, SM");
  await page.screenshot({ path: "screenshots/desktop-serviceangebot-pruefseite.png" });
  // Hinweise der KI stehen am Feld; nicht eindeutige Felder sind markiert, bis die Person sie setzt
  await expect(page.getByText("Pos. 1: Ja angekreuzt; RA und SM")).toBeVisible();
  await expect(page.locator(".o-field.klaeren")).toHaveCount(1);
  await expect(page.locator('[data-key="status_itservices"] .o-klaeren-marke')).toHaveText("Zu klären");
  // Die Prüfseite passt ohne Scrollen auf den Bildschirm
  expect(await page.locator(".app-inner").evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
  // Der Word-Leser hat die Kästchen erhalten: angekreuzt ☒, leer ☐, bei allen drei Arten, dazu die Tabelle
  const lese = prompts[0];
  expect(lese).toContain("Wartungsvertrag Ja ☒ Nein ☐");
  expect(lese).toContain("Ersatzteilpaket Ja ☐ Nein ☒");
  expect(lese).toContain("Schulung Ja ☒ Nein ☐");
  expect(lese).toContain("| Standort | St. Gallen |");
  expect(lese).not.toContain("FORMCHECKBOX");

  await weiter();
  await expect(page.getByRole("heading", { name: "Gelesene Werte prüfen (2 von 2)" })).toBeVisible();
  await expect(page.getByLabel("Wartungsvertrag (Z50)")).toHaveValue("Ja");
  await expect(page.getByLabel("Angekreuzt bei Wartungsvertrag")).toHaveValue("4.4 Schichtbetrieb: 2-Schicht");
  await expect(page.getByLabel("Resident Maintenance (Z61)")).toHaveValue("Widersprüchlich");
  await expect(page.getByText("Pos. 6: beide Kästchen angekreuzt")).toBeVisible();
  expect(await page.locator(".app-inner").evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
  // Korrektur von Hand bleibt erhalten, nimmt die Markierung weg und geht in die nächsten Schritte
  await expect(page.locator(".o-field.klaeren")).toHaveCount(1);
  await page.getByLabel("Resident Maintenance (Z61)").selectOption("Nein");
  await expect(page.locator(".o-field.klaeren")).toHaveCount(0);

  // „Weiter“ von der letzten Prüfseite erstellt die Angebotsstruktur mit den bestätigten Werten
  await weiter();
  await expect(page.getByRole("heading", { name: "Ergebnisse" })).toBeVisible();
  await expect(page.locator(".e-kachel .status-pill")).toHaveText(["Fertig"], { timeout: 15_000 });
  expect(prompts.at(-1)).toContain("Resident Maintenance (Z61): Status Nein");
  expect(prompts.at(-1)).toContain("Angekreuzt: 4.4 Schichtbetrieb: 2-Schicht");
  // Das ZIP steht zum Herunterladen bereit: leere Ordner, Kopien aus SharePoint und Textdateien gemeinsam im Baum
  await page.locator(".e-kachel", { hasText: "Angebotsstruktur" }).click();
  await expect(page.getByRole("button", { name: /ZIP herunterladen/ })).toBeVisible();
  const baum = page.locator("pre.code", { hasText: "Serviceangebotsstruktur/" });
  await expect(baum).toBeVisible();
  await expect(baum).toContainText("01_Request/");
  await expect(baum).toContainText("Remote Services Calculation.xltm");
  await expect(baum).toContainText("Pruefprotokoll.txt");
  await expect(page.getByText("2 Dateien, 1 Vorlage aus SharePoint, 2 Ordner im Paket")).toBeVisible();
  await page.getByRole("button", { name: "Alle Ergebnisse" }).click();
  await expect(page.getByRole("heading", { name: "Ergebnisse" })).toBeVisible();
  // „Neu erstellen“ in der Übersicht lässt den Lese-Schritt und die geprüften Werte in Ruhe
  expect(prompts.filter((p) => /Antworte nur mit JSON dieser Form/.test(p))).toHaveLength(1);
});
