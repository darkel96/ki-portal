import { test, expect, type Page } from "@playwright/test";

/** Baustein „Aufgaben“: die KI liest die Aufgaben aus einem Ergebnis, die Person prüft, dann Planner oder To Do */
const APP = {
  id: "aufgaben-app", name: "Aufgaben-Test", bereich: "Test", status: "freigegeben", version: 1,
  steps: [{ id: "s1", key: "punkte", name: "Offene Punkte", prompt: "Offene Punkte zu {{thema}}" }],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Angaben" }, children: [{ id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } }] },
    { id: "p2", type: "seite", props: { titel: "Offene Punkte" }, children: [
      { id: "o1", type: "output", props: { titel: "Offene Punkte", quelle: "s1" } },
      { id: "a1", type: "aufgaben", props: { titel: "Aufgaben anlegen", quelle: "s1", ziel: "planner", plan: "KTE Projekt", bucket: "Offen" } },
    ] },
  ],
};
const AUFGABEN = { aufgaben: [
  { titel: "IP-Adressliste mit KTE abstimmen", faellig: "", zustaendig: "", prioritaet: "mittel", notiz: "Gibt es schon im Plan." },
  { titel: "Freigabe SAP-DEV-Zugang einholen", faellig: "2026-11-05", zustaendig: "Marcel Huck", prioritaet: "hoch", notiz: "Blockiert die Emulation. Quelle: Mail 23.10." },
  { titel: "Ansprechpartner Leingarten benennen", faellig: "", zustaendig: "", prioritaet: "niedrig", notiz: "Zuständig festzulegen." },
] };

async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    const prompt = typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n");
    prompts.push(prompt);
    const text = prompt.includes("konkreten offenen Aufgaben") ? JSON.stringify(AUFGABEN) : "| Priorität | Was ist zu tun | Zuständig |\n|---|---|---|\n| Hoch | Freigabe SAP-DEV-Zugang einholen | Marcel Huck |";
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("") });
  });
  await page.addInitScript((app) => { localStorage.setItem("kihub-anthropic-key", "sk-ant-test"); localStorage.setItem("kihub-apps-v3", JSON.stringify([app])); }, APP);
  return prompts;
}
async function ablaufStarten(page: Page) {
  await page.goto("/app/aufgaben-app");
  await page.getByRole("textbox", { name: "Thema" }).fill("KTE");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /erstellen/i }).click();
  await expect(page.getByText("1 von 1 fertig")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Offene Punkte" }).first().click();
}

test("Aufgaben aus dem Ergebnis prüfen und in Planner anlegen; vorhandene nicht doppelt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  await ablaufStarten(page);
  const block = page.locator(".o-aufgaben");
  await block.getByRole("button", { name: "Aufgaben aus „Offene Punkte“ übernehmen" }).click();
  const gruppe = block.getByRole("group", { name: "Aufgaben zum Anlegen" });
  await expect(gruppe.getByRole("textbox", { name: "Aufgabe" })).toHaveCount(3);
  expect(prompts.some((p) => p.includes("konkreten offenen Aufgaben") && p.includes("Freigabe SAP-DEV-Zugang einholen"))).toBe(true);
  // Plan und Bucket aus dem Baukasten vorgewählt; die vorhandene Aufgabe ist abgewählt und markiert
  await expect(gruppe.getByRole("combobox", { name: "Plan", exact: true })).toHaveValue("plan-kte");
  await expect(gruppe.getByRole("combobox", { name: "Bucket", exact: true })).toHaveValue("b-offen");
  await expect(gruppe.getByRole("checkbox", { name: "„IP-Adressliste mit KTE abstimmen“ anlegen" })).not.toBeChecked();
  await expect(gruppe).toContainText("Gibt es schon in „KTE Projekt“");
  await expect(gruppe.getByRole("textbox", { name: "Zuständig: Freigabe SAP-DEV-Zugang einholen" })).toHaveValue("Marcel Huck");
  await expect(gruppe.getByLabel("Fällig: Freigabe SAP-DEV-Zugang einholen")).toHaveValue("2026-11-05");
  // Vor dem Anlegen ändern: Zuständig nachtragen (unbekannt), Titel kürzen
  await gruppe.getByRole("textbox", { name: "Zuständig: Ansprechpartner Leingarten benennen" }).fill("Unbekannte Person");
  await gruppe.getByRole("button", { name: "2 Aufgaben anlegen" }).click();
  await expect(block.getByText("2 Aufgaben in „KTE Projekt › Offen“ angelegt. Ohne Zuständigen (nicht eindeutig gefunden, steht in der Notiz): Unbekannte Person.")).toBeVisible();
  await expect(gruppe.getByText("Angelegt")).toHaveCount(2);
  const plan = await page.evaluate(async () => (await import("/src/lib/ki/aufgaben.ts")).beispielAblage("planner", "plan-kte"));
  expect(plan.map((a) => [a.titel, a.zustaendig, a.bucket])).toEqual([
    ["IP-Adressliste mit KTE abstimmen", "", undefined],
    ["Freigabe SAP-DEV-Zugang einholen", "Marcel Huck", "b-offen"],
    ["Ansprechpartner Leingarten benennen", "", "b-offen"],
  ]);
  expect(plan[2]!.notiz).toContain("Zuständig laut Ergebnis: Unbekannte Person");
  // Nichts mehr offen: der Knopf zählt 0
  await expect(gruppe.getByRole("button", { name: "0 Aufgaben anlegen" })).toBeDisabled();
});

test("Aufgaben über Microsoft Graph: Planner mit Zuständigen und Beschreibung, To Do mit Fälligkeit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await kiNachbau(page);
  const anfragen: { methode: string; pfad: string; body: unknown; ifMatch?: string }[] = [];
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "ETag" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const pfad = url.pathname.replace("/v1.0", "");
    anfragen.push({ methode: req.method(), pfad: pfad + url.search, body: req.postDataJSON?.() ?? null, ifMatch: req.headers()["if-match"] });
    const ok = (wert: unknown, extra: Record<string, string> = {}) => route.fulfill({ status: req.method() === "POST" ? 201 : 200, headers: { ...cors, ...extra }, contentType: "application/json", body: JSON.stringify(wert) });
    if (pfad === "/me/planner/plans") return ok({ value: [{ id: "P1", title: "KTE Projekt" }, { id: "P2", title: "Anderes" }] });
    if (pfad === "/planner/plans/P1/buckets") return ok({ value: [{ id: "B2", name: "In Arbeit", orderHint: "2" }, { id: "B1", name: "Offen", orderHint: "1" }] });
    if (pfad === "/planner/plans/P1/tasks") return ok({ value: [{ title: "IP-Adressliste mit KTE abstimmen", percentComplete: 0 }] });
    if (pfad.startsWith("/users")) return pfad.includes("startswith") || url.search.includes("startswith") ? ok({ value: [{ id: "U-MH", displayName: "Marcel Huck" }] }) : ok({ id: "U-X", displayName: "X" });
    if (pfad === "/planner/tasks" && req.method() === "POST") return ok({ id: `T${anfragen.length}` });
    if (/^\/planner\/tasks\/[^/]+\/details$/.test(pfad)) return req.method() === "GET" ? ok({ id: "d" }, { ETag: 'W/"etag-1"' }) : route.fulfill({ status: 204, headers: cors });
    if (pfad === "/me/todo/lists") return ok({ value: [{ id: "L2", displayName: "Projekte" }, { id: "L1", displayName: "Tasks", wellknownListName: "defaultList" }] });
    if (pfad === "/me/todo/lists/L1/tasks") return req.method() === "POST" ? ok({ id: "TD1" }) : ok({ value: [] });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-graph-test", "test-token"));
  await ablaufStarten(page);
  const block = page.locator(".o-aufgaben");
  await block.getByRole("button", { name: "Aufgaben aus „Offene Punkte“ übernehmen" }).click();
  const gruppe = block.getByRole("group", { name: "Aufgaben zum Anlegen" });
  await expect(gruppe.getByRole("combobox", { name: "Bucket", exact: true })).toHaveValue("B1");
  await expect(gruppe.getByRole("checkbox", { name: "„IP-Adressliste mit KTE abstimmen“ anlegen" })).not.toBeChecked();
  await gruppe.getByRole("checkbox", { name: "„Ansprechpartner Leingarten benennen“ anlegen" }).uncheck();
  await gruppe.getByRole("button", { name: "1 Aufgabe anlegen" }).click();
  await expect(block.getByText("1 Aufgabe in „KTE Projekt › Offen“ angelegt.")).toBeVisible();
  const neu = anfragen.find((a) => a.methode === "POST" && a.pfad === "/planner/tasks")!;
  expect(neu.body).toMatchObject({ planId: "P1", bucketId: "B1", title: "Freigabe SAP-DEV-Zugang einholen", priority: 1, dueDateTime: "2026-11-05T12:00:00Z", assignments: { "U-MH": { "@odata.type": "#microsoft.graph.plannerAssignment" } } });
  const det = anfragen.find((a) => a.methode === "PATCH" && a.pfad.endsWith("/details"))!;
  expect(det.ifMatch).toBe('W/"etag-1"');
  expect(det.body).toMatchObject({ description: "Blockiert die Emulation. Quelle: Mail 23.10." });
  // Wechsel zu „Meine Aufgaben“: Standardliste zuerst, Zuständig in der Notiz
  await gruppe.getByRole("combobox", { name: "Wohin", exact: true }).selectOption("todo");
  await expect(gruppe.getByRole("combobox", { name: "Liste", exact: true })).toHaveValue("L1");
  await gruppe.getByRole("checkbox", { name: "„Ansprechpartner Leingarten benennen“ anlegen" }).check();
  // In „Meine Aufgaben“ gibt es die IP-Adressliste noch nicht: wieder angehakt; hier nur die eine
  await expect(gruppe.getByRole("checkbox", { name: "„IP-Adressliste mit KTE abstimmen“ anlegen" })).toBeChecked();
  await gruppe.getByRole("checkbox", { name: "„IP-Adressliste mit KTE abstimmen“ anlegen" }).uncheck();
  await gruppe.getByRole("button", { name: "1 Aufgabe anlegen" }).click();
  await expect(block.getByText("1 Aufgabe in „Aufgaben“ angelegt.")).toBeVisible();
  const td = anfragen.find((a) => a.methode === "POST" && a.pfad === "/me/todo/lists/L1/tasks")!;
  expect(td.body).toMatchObject({ title: "Ansprechpartner Leingarten benennen", importance: "low", body: { content: "Zuständig festzulegen.", contentType: "text" } });
});

test("Baukasten: Aufgaben stehen unter Microsoft 365 und lassen sich einstellen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/baukasten/aufgaben-app");
  await expect(page.locator(".pal-g[data-g='Microsoft 365']").getByRole("button", { name: /Aufgaben \(Planner\)/ })).toBeVisible();
  await page.locator(".s-tab").nth(1).click();
  await page.locator(".o-aufgaben").first().click();
  await expect(page.getByLabel("Aufgaben aus dem Ergebnis von")).toContainText("Offene Punkte");
  await expect(page.getByLabel("Plan (vorgewählt, optional)")).toHaveValue("KTE Projekt");
  await expect(page.getByLabel("Bucket (vorgewählt, optional)")).toHaveValue("Offen");
});

test("Tabellen ohne äußere Striche und Trennzeile (Copilot) werden zu echten Tabellen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const t = await import("/src/lib/tabellenreparatur.ts");
    const md = await import("/src/lib/markdown.ts");
    const roh = "Offene Punkte\nPriorität | Was ist zu tun | Zuständig\nhoch | Freigabe einholen | Dario\nmittel | Liste abstimmen | Marcel Huck\n\nText mit a | b bleibt.";
    return { text: t.tabellenReparieren(roh), html: md.markdown(roh), unveraendert: t.tabellenReparieren("| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |"), einzeln: t.tabellenReparieren("nur a | b | c in einer Zeile") };
  });
  expect(r.text).toBe("Offene Punkte\n| Priorität | Was ist zu tun | Zuständig |\n| --- | --- | --- |\n| hoch | Freigabe einholen | Dario |\n| mittel | Liste abstimmen | Marcel Huck |\n\nText mit a | b bleibt.");
  expect(r.html).toContain("<th>Priorität</th>");
  expect(r.html).toContain("<td>Marcel Huck</td>");
  expect(r.unveraendert).toBe("| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |");
  expect(r.einzeln).toBe("nur a | b | c in einer Zeile");
});
