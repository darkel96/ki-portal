import { test, expect } from "@playwright/test";

/** KI-Assistent: kurze Antworten mit „unverändert“-Marken, Live-Stand während die Antwort kommt */
test("KI-Assistent: nur Geändertes zurück, Rest bleibt erhalten, Fortschritt sichtbar", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  let prompt = "";
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    prompt = typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n");
    // Aus dem Kontext: erste Seite und erster Schritt; alles außer der ersten Seite bleibt unverändert
    const ctx = JSON.parse(prompt.split("## Aktuelle Applikation (Eigenschaften mit Standardwert sind weggelassen)\n")[1].split("\n\n## Wunsch der Person")[0]);
    const seite1 = { ...ctx.blocks[0], props: { ...ctx.blocks[0].props, titel: "Checkliste hochladen" } };
    const antwort = JSON.stringify({ zusammenfassung: "Erste Seite umbenannt.", app: {
      name: ctx.name, theme: "unveraendert", wissen: "unveraendert",
      blocks: [seite1, ...ctx.blocks.slice(1).map((b: { id: string }) => ({ id: b.id, unveraendert: true }))],
      steps: ctx.steps.map((s: { id: string }) => ({ id: s.id, unveraendert: true })),
    } });
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const halb = Math.floor(antwort.length / 2);
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: antwort.slice(0, halb) } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: antwort.slice(halb) } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  await page.goto("/baukasten?kopie=serviceangebot");
  const vorher = await page.evaluate(async () => (await import("/src/lib/seeds.ts")).SEED_APPS.find((a) => a.id === "serviceangebot")!);
  await expect(page.getByRole("heading", { name: "KI-Assistent" })).toBeVisible();
  const auf = page.getByRole("button", { name: "KI-Assistent aufklappen" });
  if (await auf.count()) await auf.click();
  await page.getByLabel("Wunsch an den KI-Assistenten").fill("Benenne die erste Seite in „Checkliste hochladen“ um");
  await page.getByRole("button", { name: "Umsetzen" }).click();
  // Live-Stand mit laufender Zeit statt fester Zeitangabe
  await expect(page.locator(".ai-meldung[role=status]")).toContainText(/Die KI liest die Applikation und plant … 0:0\d/);
  await expect(page.locator(".ai-meldung[role=status]")).toContainText("Erste Seite umbenannt.", { timeout: 15_000 });
  // Kontext ohne Standardwerte, Antwortregel mit „unveraendert“
  expect(prompt).toContain('{"id": "<id>", "unveraendert": true}');
  expect(prompt).not.toContain('"align":"left"');
  // Schneller: kompaktes JSON, neue Blöcke ohne id
  expect(prompt).toContain("kompakt in einer einzigen Zeile");
  expect(prompt).toContain('Neue Blöcke schreibst du ohne "id"');
  await expect(page.getByRole("tab", { name: /Checkliste hochladen/ }).or(page.getByRole("button", { name: /Checkliste hochladen/ })).first()).toBeVisible();
  // Alles andere blieb erhalten: Seitenzahl, Schritte mit vollständigen Aufgaben
  await page.getByRole("button", { name: /Exportieren/ }).click();
  const json = JSON.parse(await page.locator("#json-text").inputValue());
  expect(json.blocks.length).toBe(vorher.blocks.length);
  expect(json.steps.map((s: { prompt: string }) => s.prompt)).toEqual(vorher.steps.map((s) => s.prompt));
  expect(json.blocks[1]).toEqual(JSON.parse(JSON.stringify(vorher.blocks[1])));
});

test("Assistent: ergaenzen ersetzt Marken, unbekannte IDs fallen weg", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const as = await import("/src/lib/assistant.ts");
    const s = await import("/src/lib/sanitize.ts");
    const app = s.loadApp({ id: "a", name: "A", blocks: [{ id: "p1", type: "seite", props: { titel: "Eins" }, children: [] }, { id: "p2", type: "seite", props: { titel: "Zwei" }, children: [] }], steps: [{ id: "s1", key: "k", name: "S", prompt: "P" }] })!;
    const out = as.ergaenzen({ blocks: [{ id: "p1", unveraendert: true }, { id: "gibtsnicht", unveraendert: true }, { id: "p3", type: "seite", props: { titel: "Neu" } }], steps: "unveraendert" }, app);
    return { titel: (out.blocks as { props?: { titel: string } }[]).map((b) => b.props?.titel), steps: (out.steps as { prompt: string }[]).map((x) => x.prompt), name: out.name };
  });
  expect(r).toEqual({ titel: ["Eins", "Neu"], steps: ["P"], name: "A" });
});

test("Assistent: kompakte Antwort ohne Block-IDs ergibt eine vollständige App", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const as = await import("/src/lib/assistant.ts");
    const s = await import("/src/lib/sanitize.ts");
    const k = await import("/src/lib/ki/index.ts");
    const leer = s.loadApp({ id: "a", name: "Neu", blocks: [], steps: [] })!;
    // So antwortet die KI jetzt: eine Zeile, neue Blöcke ohne id, nur Schritte mit id
    const antwort = '{"zusammenfassung":"Neu gebaut.","app":{"name":"Retrofit","blocks":[{"type":"seite","props":{"titel":"Anlage"},"children":[{"type":"heading","props":{"text":"Retrofit-Check","level":1}},{"type":"section","children":[{"type":"input","props":{"key":"kunde","label":"Kunde","pflicht":true}},{"type":"input","props":{"key":"baujahr","label":"Baujahr"}}]}]},{"type":"seite","props":{"titel":"Konzept"},"children":[{"type":"output","props":{"titel":"Konzept","quelle":"n1"}}]}],"steps":[{"id":"n1","key":"konzept","name":"Konzept","prompt":"Konzept für {{kunde}}, Baujahr {{baujahr}}","datei":"docx"}]}}';
    const roh = k.jsonAus(antwort) as { app: Record<string, unknown> };
    const app = s.sanitizeApp(as.ergaenzen(roh.app, leer), leer);
    const ids: string[] = [];
    const lauf = (bs: { id: string; children?: unknown[] }[]) => bs.forEach((b) => { ids.push(b.id); lauf((b.children ?? []) as never); });
    lauf(app.blocks as never);
    const out = (app.blocks[1].children ?? [])[0] as { props: { quelle: string } };
    return { anzahl: ids.length, eindeutig: new Set(ids).size, leer: ids.filter((x) => !x).length, quelle: out.props.quelle, step: app.steps[0].id, datei: app.steps[0].datei };
  });
  expect(r.anzahl).toBe(7);
  expect(r.eindeutig).toBe(7);
  expect(r.leer).toBe(0);
  expect(r.quelle).toBe(r.step);
  expect(r.datei).toBe("docx");
});
