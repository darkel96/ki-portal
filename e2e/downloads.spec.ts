import { test, expect } from "@playwright/test";

/** Mehrere Ergebnisse auf einer Seite: alle Downloads stehen gesammelt in einer festen Leiste unten */
test("Downloads mehrerer Ergebnisse gesammelt unten, nebeneinander", async ({ page }, info) => {
  const lang = Array.from({ length: 40 }, (_, i) => `- Punkt ${i + 1}: ausführlicher Befund mit Maßnahme`).join("\n");
  await page.route("https://api.anthropic.com/**", async (route) => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const body = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: `# Ergebnis\n\n${lang}` } }),
      ev("content_block_stop", { index: 0 }),
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }),
      ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body });
  });
  const app = {
    id: "drei-ergebnisse", name: "Retrofit", bereich: "Test", status: "freigegeben", version: 1,
    steps: [
      { id: "s1", key: "konzept", name: "Retrofit-Konzept", prompt: "Konzept zu {{thema}}", datei: "docx" },
      { id: "s2", key: "liste", name: "Maßnahmenliste", prompt: "Liste zu {{thema}}", datei: "xlsx" },
      { id: "s3", key: "kurz", name: "Management-Kurzfassung", prompt: "Kurz zu {{thema}}", datei: "pdf" },
    ],
    blocks: [
      { id: "p1", type: "seite", props: { titel: "Angaben" }, children: [{ id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } }] },
      { id: "p2", type: "seite", props: { titel: "Ergebnisse" }, children: [
        { id: "o1", type: "output", props: { titel: "Retrofit-Konzept", quelle: "s1" } },
        { id: "o2", type: "output", props: { titel: "Maßnahmenliste", quelle: "s2" } },
        { id: "o3", type: "output", props: { titel: "Management-Kurzfassung", quelle: "s3" } },
      ] },
    ],
  };
  await page.addInitScript((a) => { localStorage.setItem("kihub-apps-v3", JSON.stringify([a])); localStorage.setItem("kihub-anthropic-key", "sk-ant-test"); }, app);
  await page.goto("/app/drei-ergebnisse");
  await page.getByLabel("Thema").fill("Hochregallager");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Erstellen|Ergebnisse erstellen/i }).click();
  await page.locator(".e-kachel").first().click();

  const leiste = page.getByRole("region", { name: "Downloads" });
  await expect(leiste.getByRole("group")).toHaveCount(3);
  await expect(leiste.getByRole("button", { name: "Retrofit-Konzept: Word herunterladen" })).toBeVisible();
  await expect(leiste.getByRole("button", { name: "Maßnahmenliste: Excel herunterladen" })).toBeVisible();
  await expect(leiste.getByRole("button", { name: "Management-Kurzfassung: PDF herunterladen" })).toBeVisible();
  // Unter den einzelnen Ergebnissen stehen keine Download-Knöpfe mehr, Kopieren bleibt
  await expect(page.locator(".o-out .o-foot").getByRole("button", { name: /herunterladen/ })).toHaveCount(0);
  await expect(page.locator(".o-out .o-foot").getByRole("button", { name: "Kopieren" })).toHaveCount(3);
  // Die Leiste bleibt beim Scrollen unten sichtbar, ganz oben wie ganz unten
  const blatt = page.locator(".app-inner.innen-scroll");
  expect(await blatt.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
  await expect(leiste).toBeInViewport();
  const unten = async () => { const b = await blatt.boundingBox(), l = await leiste.boundingBox(); return Math.abs(b!.y + b!.height - (l!.y + l!.height)); };
  expect(await unten()).toBeLessThan(2);
  await page.screenshot({ path: `screenshots/${info.project.name}-downloads.png` });
  await blatt.evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
  expect(await unten()).toBeLessThan(2);
  // Herunterladen aus der Leiste
  const dl = page.waitForEvent("download");
  await leiste.getByRole("button", { name: "Maßnahmenliste: Excel herunterladen" }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.xlsx$/);
  // Weitere Formate je Ergebnis im Menü
  await leiste.getByRole("button", { name: "Retrofit-Konzept: anderes Format" }).click();
  await expect(page.getByRole("menuitem", { name: /PowerPoint/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Ein einzelnes Ergebnis behält seine Downloads direkt am Ergebnis", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/app/protokoll");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Downloads" })).toHaveCount(0);
});
