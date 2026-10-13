import { test, expect, type Page } from "@playwright/test";

/** Nachgebaute KI: antwortet mit einem festen Text und merkt sich die Prompts */
async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  const bilder: number[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    type Teil = { type: string; text?: string };
    const body = route.request().postDataJSON() as { messages?: { content: string | Teil[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    prompts.push(typeof c === "string" ? c : c.filter((t) => t.type === "text").map((t) => t.text ?? "").join("\n"));
    bilder.push(typeof c === "string" ? 0 : c.filter((t) => t.type === "image").length);
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const text = prompts.length === 1 ? "Laut **Art. 13** gelten die Herstellerpflichten.\n\nQuelle: [Verordnungstext, Art. 13](https://firma.sharepoint.com/sites/cra/Verordnung.pdf)" : "Dazu finde ich in den hinterlegten Unterlagen nichts.";
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  return { prompts, bilder };
}

/** Nachgebaute Spracherkennung des Browsers: liefert nach dem Start einen festen Satz */
const SPRACHE = `window.SpeechRecognition = window.webkitSpeechRecognition = class {
  start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Welche Pflichten gelten für Hersteller?" }, length: 1 }], length: 1 }); this.onend?.(); }, 50); }
  stop() {} abort() {}
};`;

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("Fachexperten-Chat: Frage, Antwort mit Quelle, Rückfrage mit Verlauf", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const { prompts } = await kiNachbau(page);
  await page.goto("/app/cra-experte");
  await expect(page.getByRole("heading", { name: "Fachexperte Cyber Resilience Act", level: 1 })).toBeVisible();
  const chat = page.locator(".o-chat");
  await expect(chat).toContainText("Was möchtest du wissen?");
  // Kein Pager, kein Button: nur der Chat
  await expect(page.getByRole("navigation", { name: "Seiten blättern" })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Senden" })).toBeDisabled();
  await chat.getByLabel("Frage").fill("Welche Pflichten gelten für Hersteller?");
  await chat.getByLabel("Frage").press("Enter");
  await expect(chat.locator(".o-chat-n.von-mensch")).toHaveText("Welche Pflichten gelten für Hersteller?");
  await expect(chat.locator(".o-chat-n.von-experte").last()).toContainText("Art. 13", { timeout: 10_000 });
  // Rolle mit Belegregel, Wissensgrenze und die Frage stehen in der Anfrage
  // Quelle als Link, der in einem neuen Tab öffnet
  const quelle = chat.locator(".o-chat-n.von-experte a", { hasText: "Verordnungstext, Art. 13" });
  await expect(quelle).toHaveAttribute("href", "https://firma.sharepoint.com/sites/cra/Verordnung.pdf");
  await expect(quelle).toHaveAttribute("target", "_blank");
  await expect(quelle).toHaveAttribute("rel", /noopener/);
  expect(prompts[0]).toContain("Antworte nur aus den hinterlegten Unterlagen");
  expect(prompts[0]).toContain("Quellenangaben schreibst du als Markdown-Link");
  expect(prompts[0]).toContain("Wissensgrenze");
  expect(prompts[0]).toContain("Frage: Welche Pflichten gelten für Hersteller?");
  // Rückfrage bekommt den Verlauf mit
  await chat.getByLabel("Frage").fill("Und ab wann?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.locator(".o-chat-n.von-experte").last()).toContainText("finde ich in den hinterlegten Unterlagen nichts", { timeout: 10_000 });
  expect(prompts[1]).toContain("Person: Welche Pflichten gelten für Hersteller?");
  expect(prompts[1]).toContain("Experte: Laut **Art. 13**");
  await page.screenshot({ path: "screenshots/desktop-chat.png" });
  // Neu beginnen leert den Verlauf
  await chat.getByRole("button", { name: "Neu beginnen" }).click();
  await expect(chat.locator(".o-chat-n.von-mensch")).toHaveCount(0);
});

test("Baukasten: {{frage}} und {{verlauf}} gelten für den Chat-Experten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/baukasten?kopie=cra-experte");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  // Keine Warnung zu den Chat-Variablen, Einsetzen-Chips vorhanden, Fußzeile nennt den Chat
  await expect(page.getByRole("tab", { name: "Prüfung", exact: true })).toBeVisible();
  await expect(page.getByText(/Diese Variable gibt es an dieser Stelle nicht/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Frage im Chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bisheriger Verlauf" })).toBeVisible();
  await expect(page.getByText(/Antwortet als Experte im Chat/)).toBeVisible();
});

test("Fachexperten-Chat: Anhänge (Dokument und Bild) und Diktat", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const { prompts, bilder } = await kiNachbau(page);
  await page.addInitScript(SPRACHE);
  await page.goto("/app/cra-experte");
  const chat = page.locator(".o-chat");
  // Dokument und Bild anhängen: beide erscheinen als Chip, der Senden-Knopf ist ohne Text aktiv
  await chat.getByLabel("Dateien anhängen").setInputFiles([
    { name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("Unser Produkt hat eine Fernwartungsschnittstelle.") },
    { name: "screenshot.png", mimeType: "image/png", buffer: PNG },
  ]);
  const wartend = chat.getByRole("list", { name: "Anhänge zur nächsten Frage" });
  await expect(wartend).toContainText("notiz.txt");
  await expect(wartend).toContainText("screenshot.png");
  await expect(wartend.locator("img")).toHaveCount(1);
  await expect(chat.getByRole("button", { name: "Senden" })).toBeEnabled();
  // Diktieren füllt das Eingabefeld
  await chat.getByRole("button", { name: "Diktieren" }).click();
  await expect(chat.getByLabel("Frage", { exact: true })).toHaveValue("Welche Pflichten gelten für Hersteller?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.locator(".o-chat-n.von-experte").last()).toContainText("Art. 13", { timeout: 10_000 });
  // Anhänge stehen an der Frage und gehen mit: Dokument als Text, Bild als Bild
  const frage = chat.locator(".o-chat-n.von-mensch");
  await expect(frage.getByRole("list", { name: "Anhänge" })).toContainText("notiz.txt");
  expect(prompts[0]).toContain("Anhang „notiz.txt“ (Dokument der fragenden Person):\nUnser Produkt hat eine Fernwartungsschnittstelle.");
  expect(prompts[0]).toContain("Anhang „screenshot.png“ (Bild der fragenden Person");
  expect(bilder[0]).toBe(1);
  await expect(wartend).toHaveCount(0);
  // Ohne Gespräch bei der KI nimmt die Rückfrage die Anhänge wieder mit
  await chat.getByLabel("Frage", { exact: true }).fill("Und was heißt das für uns?");
  await chat.getByLabel("Frage", { exact: true }).press("Enter");
  await expect(chat.locator(".o-chat-n.von-experte").last()).toContainText("nichts", { timeout: 10_000 });
  expect(prompts[1]).toContain("Anhang „notiz.txt“");
  expect(bilder[1]).toBe(1);
  await page.screenshot({ path: "screenshots/desktop-chat-anhang.png" });
});
