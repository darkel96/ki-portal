import { test, expect, type Page } from "@playwright/test";

/** Postfach-Baustein: Ordner, Nachrichten und geöffnete Nachricht wie in Outlook; ohne Copilot das Beispielpostfach */
const APP = {
  id: "post-app", name: "Mein Postfach", bereich: "Allgemein", status: "freigegeben", version: 1, steps: [],
  blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "h1", type: "heading", props: { text: "Postfach", level: 1, align: "left", color: "" } },
    { id: "pf", type: "postfach", props: { titel: "Posteingang und Ordner", anzahl: 25, vorschau: true } },
  ] }],
};

test("Postfach: Ordner, Nachrichten, Suche und geöffnete Nachricht", async ({ page }, info) => {
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/app/post-app");
  const post = page.locator(".o-post");
  await expect(post.getByText("Beispielpostfach")).toBeVisible();
  const ordner = post.getByRole("navigation", { name: "Ordner" });
  await expect(ordner.getByRole("button", { name: /Posteingang/ })).toHaveAttribute("aria-current", "true");
  await expect(ordner.getByRole("button", { name: /Gesendete Elemente/ })).toBeVisible();
  // Posteingang: fünf Nachrichten, ungelesene fett, neueste zuerst
  const liste = post.locator(".o-post-nachricht");
  await expect(liste).toHaveCount(5);
  await expect(liste.first()).toContainText("CRA Attest Retrofit Linie 3");
  await expect(liste.first()).toHaveClass(/ist-neu/);
  await expect(liste.first()).toContainText("Anna Berger");
  // Nachricht öffnen
  await liste.first().click();
  const inhalt = post.getByRole("article", { name: "Geöffnete Nachricht" });
  await expect(inhalt.getByRole("heading", { name: "CRA Attest Retrofit Linie 3: Freigabe bis Freitag" })).toBeVisible();
  await expect(inhalt).toContainText("anna.berger@koerber.com");
  await expect(inhalt).toContainText("Hardening-Assessment");
  // Suche im Ordner
  await post.getByLabel("Nachrichten durchsuchen").fill("SBOM");
  await post.getByLabel("Nachrichten durchsuchen").press("Enter");
  await expect(liste).toHaveCount(1);
  await expect(liste.first()).toContainText("Rückfrage SBOM");
  await post.getByRole("button", { name: "Suche aufheben" }).click();
  await expect(liste).toHaveCount(5);
  // Unterordner ausklappen und wechseln
  await ordner.getByLabel("Unterordner ausklappen").click();
  await ordner.getByRole("button", { name: /^CRA$/ }).click();
  await expect(liste).toHaveCount(1);
  await expect(liste.first()).toContainText("VDMA CRA FAQ 2.0");
  await ordner.getByRole("button", { name: /Gesendete Elemente/ }).click();
  await expect(liste.first()).toContainText("AW: CRA Attest");
  await page.screenshot({ path: `screenshots/${info.project.name}-postfach.png` });
});

test("Baukasten: Postfach steht in der Palette unter Microsoft 365 und lässt sich einstellen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/baukasten/post-app");
  await expect(page.locator(".pal-g[data-g='Microsoft 365']").getByRole("button", { name: /Postfach/ })).toBeVisible();
  await page.locator(".o-post-edit").click();
  await expect(page.getByLabel("Titel")).toHaveValue("Posteingang und Ordner");
  await expect(page.getByText("Nachrichten je Seite", { exact: true })).toBeVisible();
});

/** KI-Nachbau: antwortet je nach Aufgabe (Zusammenfassung, Antwortentwurf, thematische Auswahl) */
async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    const prompt = typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n");
    prompts.push(prompt);
    const text = prompt.includes("Welche dieser E-Mails") ? '{"nummern": [3]}' : prompt.includes("Entwirf eine Antwort") ? "Hallo Anna,\n\ndanke, ich gebe das Attest bis Freitag frei.\n\nViele Grüße\nDario" : "**Kurz:** Anna bittet um Freigabe des CRA Attests bis Freitag.";
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

test("Postfach: KI zur geöffneten Mail (Zusammenfassung, Antwortentwurf) und Prozedur „Mails zum Thema ablegen“", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  const app = { ...APP, blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "pf", type: "postfach", props: { titel: "Postfach", anzahl: 25, vorschau: true, prozeduren: [{ name: "CRA ablegen", thema: "CRA, Cyber Resilience Act", tage: 30, zielordner: "CRA-Ablage", ki: true }] } },
  ] }] };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/post-app");
  const post = page.locator(".o-post");
  await post.locator(".o-post-nachricht").first().click();
  const kiBereich = post.getByRole("region", { name: "KI zu dieser Mail" });
  await kiBereich.getByRole("button", { name: "Zusammenfassen" }).click();
  await expect(kiBereich).toContainText("Anna bittet um Freigabe des CRA Attests");
  expect(prompts[0]).toContain("Betreff: CRA Attest Retrofit Linie 3: Freigabe bis Freitag");
  expect(prompts[0]).toContain("Hardening-Assessment");
  await kiBereich.getByRole("button", { name: "Antwort entwerfen" }).click();
  await expect(kiBereich).toContainText("ich gebe das Attest bis Freitag frei");
  await kiBereich.getByRole("button", { name: "Als Entwurf in Outlook anlegen" }).click();
  await expect(kiBereich.getByText("Entwurf angelegt")).toBeVisible();
  // Freie Frage
  await kiBereich.getByLabel("Frage zur Mail").fill("Bis wann?");
  await kiBereich.getByRole("button", { name: "Fragen" }).click();
  expect(prompts.at(-1)).toContain("Aufgabe: Bis wann?");
  // Prozedur: Vorschau mit Wortsuche plus KI-Auswahl (Nr. 3 = SBOM-Mail), dann verschieben
  await post.getByRole("button", { name: "Prozeduren" }).click();
  await post.getByRole("button", { name: "CRA ablegen" }).click();
  const treffer = post.getByRole("group", { name: "Gefundene Mails" });
  await expect(treffer).toContainText("4 von 4 Mails ausgewählt");
  await expect(treffer).toContainText("CRA Attest Retrofit Linie 3");
  await expect(treffer).toContainText("VDMA CRA FAQ 2.0");
  await expect(treffer).toContainText("Rückfrage SBOM");
  // Eine abwählen, dann verschieben
  await treffer.getByLabel(/Rückfrage SBOM/).uncheck();
  await treffer.getByRole("button", { name: "Nach „CRA-Ablage“ verschieben" }).click();
  await expect(post.getByText("3 Mails nach „CRA-Ablage“ verschoben.").first()).toBeVisible();
  await expect(post.getByRole("navigation", { name: "Ordner" }).getByRole("button", { name: /CRA-Ablage/ })).toBeVisible();
  await post.getByRole("navigation", { name: "Ordner" }).getByRole("button", { name: /CRA-Ablage/ }).click();
  await expect(post.locator(".o-post-nachricht")).toHaveCount(3);
  await page.screenshot({ path: `screenshots/${info.project.name}-postfach-ki.png` });
});
