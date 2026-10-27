import { test, expect } from "@playwright/test";

/**
 * Bedingte Schritte („nur ausführen, wenn“): Ankreuzfelder steuern, welche Teile entstehen. Die KI schreibt die
 * Bedingung gern als „true“ oder mit der Beschriftung statt des Schlüssels; beides muss wirken.
 */
const APP = {
  id: "teile-app", name: "Teile-Test", bereich: "Test", status: "freigegeben", version: 1,
  steps: [
    { id: "s1", key: "todo_liste", name: "Offene Punkte & To-dos", prompt: "To-dos zu {{thema}}", bedingung: { feld: "todos", op: "gleich", wert: "true" } },
    { id: "s2", key: "briefing", name: "Briefing", prompt: "Briefing zu {{thema}}", bedingung: { feld: "Briefing erstellen", op: "gefuellt", wert: "" } },
  ],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Thema" }, children: [
      { id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } },
      { id: "f2", type: "checkbox", props: { key: "todos", label: "To-dos erstellen" } },
      { id: "f3", type: "checkbox", props: { key: "briefing_an", label: "Briefing erstellen" } },
    ] },
    { id: "p2", type: "seite", props: { titel: "Offene Punkte & To-dos" }, children: [{ id: "o1", type: "output", props: { titel: "Offene Punkte & To-dos", quelle: "s1" } }] },
    { id: "p3", type: "seite", props: { titel: "Briefing" }, children: [{ id: "o2", type: "output", props: { titel: "Briefing", quelle: "s2" } }] },
  ],
};

test("Ankreuzfelder wählen die Teile: angehakt läuft, nicht angehakt wird mit Grund übersprungen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const fragen: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    fragen.push(typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n"));
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "- Punkt eins" } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("") });
  });
  await page.addInitScript((app) => { localStorage.setItem("kihub-apps-v3", JSON.stringify([app])); localStorage.setItem("kihub-anthropic-key", "sk-ant-test"); }, APP);
  await page.goto("/app/teile-app");
  await page.getByRole("textbox", { name: "Thema" }).fill("KTE");
  await page.getByLabel("To-dos erstellen").check();
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /erstellen/i }).click();
  await expect(page.getByText("1 von 1 fertig, 1 übersprungen")).toBeVisible({ timeout: 20_000 });
  const kacheln = page.locator(".e-kachel");
  await expect(kacheln.filter({ hasText: "Offene Punkte & To-dos" })).toContainText("Fertig");
  await expect(kacheln.filter({ hasText: "Briefing" })).toContainText("Übersprungen, weil „Briefing erstellen“ nicht angehakt ist.");
  expect(fragen).toHaveLength(1);
  expect(fragen[0]).toContain("To-dos zu KTE");
  // Logik direkt: true/an/angehakt wie „ja“, false wie „nein“, Feld über die Beschriftung
  const r = await page.evaluate(async (app) => {
    const run = await import("/src/lib/runner.ts");
    const s = (bedingung: unknown) => ({ ...app.steps[0], bedingung }) as never;
    const ctx = { todos: "ja", briefing_an: "nein" };
    return [
      run.bedingungErfuellt(s({ feld: "todos", op: "gleich", wert: "true" }), ctx),
      run.bedingungErfuellt(s({ feld: "todos", op: "gleich", wert: "angehakt" }), ctx),
      run.bedingungErfuellt(s({ feld: "briefing_an", op: "gleich", wert: "false" }), ctx),
      run.bedingungErfuellt(s({ feld: "briefing_an", op: "gefuellt", wert: "" }), ctx),
      run.bedingungErfuellt(s({ feld: "To-dos erstellen", op: "gefuellt", wert: "" }), ctx, app as never),
    ];
  }, APP);
  expect(r).toEqual([true, true, true, false, true]);
});
