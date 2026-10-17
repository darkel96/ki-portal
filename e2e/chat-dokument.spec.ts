import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

/** Dokumente aus dem Chat: Inhalt in der Antwort, Word/PDF zum Herunterladen im Hub; keine Dateien in OneDrive */
const PLAN = "# CRA-Projektplan Retrofit\n\n## Beteiligte\n\n| Rolle | Aufgabe |\n|---|---|\n| PSSA | Sicherheitsfreigabe |\n| Projekt-IT | Oracle DB und APP Server |\n\n## Checkliste\n\n- Lieferumfang dokumentieren\n- Risk Classification durchführen\n\nQuelle: [CyRPS Attest](https://firma.sharepoint.com/sites/cra/Attest.docx)";
const KURZ = "Der CRA ist die EU-Verordnung 2024/2847.";

test("Chat: Dokument-Anfrage bekommt Word-Download, kurze Antwort nicht; die Regel steht in der Anfrage", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    prompts.push(typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n"));
    const text = prompts.length === 1 ? KURZ : PLAN;
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
  await page.goto("/app/cra-experte");
  const chat = page.locator(".o-chat");
  await chat.getByLabel("Frage", { exact: true }).fill("Was ist der CRA?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByText("EU-Verordnung 2024/2847")).toBeVisible();
  await expect(chat.locator(".o-chat-download")).toHaveCount(0);
  // Nachvollziehbar, was mitging
  await chat.getByText("Was die KI bekommen hat").first().click();
  await expect(chat.locator(".o-chat-diagnose").first()).toContainText("Keine Wissensquellen gelesen");
  await expect(chat.locator(".o-chat-diagnose").first()).toContainText("Volle Anfrage mit Rolle");
  await expect(chat.locator(".o-chat-diagnose").first()).toContainText("CRA-Unterlagen (Verordnungstext, Leitfäden, interne Bewertungen): konnte nicht gelesen werden (keine Adresse hinterlegt)");
  expect(prompts[0]).toContain("Lege keine Dateien in OneDrive, Teams oder anderswo an");
  // Dokument gewünscht: Inhalt in der Antwort, Word als Hauptknopf
  await chat.getByLabel("Frage", { exact: true }).fill("Erstelle mir ein fertiges Dokument mit Projektplan und Checkliste");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByRole("heading", { name: "Checkliste" })).toBeVisible();
  const knopf = chat.getByRole("button", { name: "CRA-Projektplan Retrofit: Word herunterladen" });
  await expect(knopf).toBeVisible();
  const dl = page.waitForEvent("download");
  await knopf.click();
  const datei = await dl;
  expect(datei.suggestedFilename()).toMatch(/CRA-Projektplan_Retrofit\.docx$/);
  const z = await JSZip.loadAsync(readFileSync((await datei.path())!));
  const xml = await z.file("word/document.xml")!.async("string");
  expect(xml).toContain("Sicherheitsfreigabe");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("Risk Classification");
  // Weitere Formate im Menü
  await chat.getByRole("button", { name: "CRA-Projektplan Retrofit: anderes Format" }).click();
  await expect(page.getByRole("menuitem", { name: /PDF/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `screenshots/${info.project.name}-chat-dokument.png` });
});
