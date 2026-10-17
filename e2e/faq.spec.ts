import { test, expect, type Page } from "@playwright/test";

/** Häufige Fragen: sofortige Antwort ohne KI, „Trotzdem die KI fragen“, Vorschlag aus dem Chat, Freigabe im Baukasten */
const DIENST = "http://localhost:8787";
const MIT = "Laut **Art. 13** gelten die Herstellerpflichten ab dem Inverkehrbringen.\n\nQuelle: [Verordnungstext, Art. 13](https://firma.sharepoint.com/sites/cra/Verordnung.pdf)";
const APP = {
  id: "faq-app", name: "FAQ-Experte", bereich: "Recht", status: "freigegeben", version: 1,
  steps: [{ id: "s1", key: "experte", name: "Experte", rolle: "Du bist Experte.", prompt: "Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}",
    faq: { eintraege: [{ id: "f1", frage: "Welche Pflichten haben Hersteller?", varianten: ["Herstellerpflichten"], antwort: "Hersteller müssen Sicherheit über den Lebenszyklus sicherstellen (Art. 13). Quelle: [CRA, Art. 13](https://firma.sharepoint.com/sites/cra/Verordnung.pdf)", datum: "2026-10-10", quelle: "hand" }] } }],
  blocks: [{ id: "p1", type: "seite", props: { titel: "Chat" }, children: [{ id: "c1", type: "chat", props: { titel: "Experte", quelle: "s1", begruessung: "Frag mich.", platzhalter: "Frage …" } }] }],
};

async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    prompts.push(typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n"));
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: MIT } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript((app) => { localStorage.setItem("kihub-anthropic-key", "sk-ant-test"); localStorage.setItem("kihub-apps-v3", JSON.stringify([app])); }, APP);
  return prompts;
}

test("FAQ: Zuordnung, Parsen, Sanitizer und Assistent", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (app) => {
    const f = await import("/src/lib/faq.ts");
    const l = await import("/src/lib/lernen.ts");
    const s = await import("/src/lib/sanitize.ts");
    const as = await import("/src/lib/assistant.ts");
    const a = s.loadApp(app)!;
    const st = a.steps[0];
    const neu = s.sanitizeApp(as.ergaenzen({ blocks: "unveraendert", steps: [{ id: "s1", key: "experte", name: "Experte", rolle: "Neu", prompt: "{{frage}}" }] }, a), a);
    return {
      treffer: ["Was sind die Pflichten der Hersteller?", "welche pflichten haben hersteller", "Welche Pflichten haben Importeure?", "Herstellerpflichten?", "Wie lange dauert die Konformitätsbewertung?", ""].map((q) => f.faqTreffer(st, q)?.wert ?? null),
      geladen: st.faq.eintraege.length,
      bewahrt: as.bewahren(neu, a).steps[0].faq.eintraege.length,
      vorschlag: l.vorschlaegeAus('{"vorschlaege":[{"art":"faq","frage":"Was ist SBOM?","antwort":"Stückliste.","belege":2},{"art":"faq","frage":"ohne Antwort"},{"art":"quelle","text":"Unterlage ergänzen: X"}]}', "s1").vorschlaege.map((v) => [v.art, v.text, v.frage, v.antwort]),
      einarbeiten: (() => {
        const chat = l.vorschlagAnlegen("s1", { art: "faq", frage: "F", antwort: "A", herkunft: "chat" });
        const alt = l.vorschlagAnlegen("s1", { art: "glossar", text: "alt" });
        const st2 = l.auswertungEinarbeiten({ ...l.leererStand(), vorschlaege: [chat, alt] }, "s1", { zusammenfassung: "", vorschlaege: [l.vorschlagAnlegen("s1", { art: "glossar", text: "neu" })] });
        return st2.vorschlaege.map((v) => v.text || v.frage);
      })(),
    };
  }, APP);
  expect(r.treffer[0]).toBeGreaterThanOrEqual(0.6); // Umformulierung passt
  expect(r.treffer[1]).toBe(1); // gleiche Wörter
  expect(r.treffer[2]).toBeNull(); // anderes Thema (Importeure)
  expect(r.treffer[3]).toBe(1); // Variante
  expect(r.treffer[4]).toBeNull();
  expect(r.treffer[5]).toBeNull();
  expect(r.geladen).toBe(1);
  expect(r.bewahrt).toBe(1);
  expect(r.vorschlag).toEqual([["faq", "Was ist SBOM?", "Was ist SBOM?", "Stückliste."], ["quelle", "Unterlage ergänzen: X", undefined, undefined]]);
  expect(r.einarbeiten).toEqual(["F", "neu"]); // aus dem Chat bleibt, alte Auswertung wird ersetzt
});

test("Chat: gespeicherte Antwort sofort, auf Wunsch trotzdem die KI, hilfreiche Antwort als häufige Frage vorschlagen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  await page.goto("/app/faq-app");
  const chat = page.locator(".o-chat");
  await chat.getByLabel("Frage", { exact: true }).fill("Was sind die Pflichten der Hersteller?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByText("Hersteller müssen Sicherheit über den Lebenszyklus")).toBeVisible();
  await expect(chat.getByText("Gespeicherte Antwort vom 10.10.2026, freigegeben.")).toBeVisible();
  expect(prompts).toHaveLength(0);
  // Trotzdem die KI: dieselbe Frage geht an die KI, die gespeicherte Antwort verschwindet
  await chat.getByRole("button", { name: "Trotzdem die KI fragen" }).click();
  await expect(chat.getByText("Herstellerpflichten ab dem Inverkehrbringen")).toBeVisible();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Was sind die Pflichten der Hersteller?");
  await expect(chat.getByText("Gespeicherte Antwort")).toHaveCount(0);
  await expect(chat.locator(".o-chat-n.von-mensch")).toHaveCount(1);
  // Hilfreich + als häufige Frage vorschlagen
  await chat.getByRole("button", { name: "Antwort war hilfreich" }).click();
  await chat.getByRole("button", { name: "Als häufige Frage vorschlagen" }).click();
  await expect(page.getByText("Freigegeben wird es im Baukasten")).toBeVisible();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-lernen:faq-app") ?? "{}") as { vorschlaege: { art: string; frage: string; antwort: string; stand: string; herkunft: string }[] });
  expect(st.vorschlaege).toHaveLength(1);
  expect(st.vorschlaege[0]).toMatchObject({ art: "faq", frage: "Was sind die Pflichten der Hersteller?", stand: "offen", herkunft: "chat" });
  expect(st.vorschlaege[0].antwort).toContain("Art. 13");
  // Eine andere Frage geht normal an die KI
  await chat.getByLabel("Frage", { exact: true }).fill("Welche Pflichten haben Importeure?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect.poll(() => prompts.length).toBe(2);
});

test("Baukasten: häufige Frage aus dem Chat freigeben, von Hand anlegen, löschen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await kiNachbau(page);
  await page.addInitScript(() => localStorage.setItem("kihub-lernen:faq-app", JSON.stringify({ rueckmeldungen: [], letzteAuswertung: {}, zusammenfassung: {}, vorschlaege: [
    { id: "v1", stepId: "s1", art: "faq", text: "Gilt der CRA für Software-Updates?", frage: "Gilt der CRA für Software-Updates?", antwort: "Ja, wesentliche Änderungen gelten als neues Inverkehrbringen. Quelle: [FAQ](https://x)", begruendung: "Im Chat als häufige Frage vorgeschlagen.", belege: 1, stand: "offen", zeit: new Date().toISOString(), herkunft: "chat" },
  ] })));
  await page.goto("/baukasten/faq-app");
  await page.getByRole("tab", { name: "Lernen" }).click();
  await expect(page.getByText("Häufige Fragen: sofortige Antwort ohne KI (1)")).toBeVisible();
  await expect(page.getByText("Häufige Frage · aus dem Chat")).toBeVisible();
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByText("Häufige Fragen: sofortige Antwort ohne KI (2)")).toBeVisible();
  await expect(page.locator(".lern-faq").getByText("Gilt der CRA für Software-Updates?")).toBeVisible();
  await expect(page.locator(".lern-faq").getByText("aus der Lernschicht")).toBeVisible();
  // Von Hand
  await page.getByLabel("Neue häufige Frage", { exact: true }).fill("Was ist eine SBOM?");
  await page.getByLabel("Antwort auf die neue häufige Frage").fill("Eine Stückliste aller Softwarebestandteile.");
  await page.getByRole("button", { name: "Häufige Frage hinzufügen" }).click();
  await expect(page.getByText("Häufige Fragen: sofortige Antwort ohne KI (3)")).toBeVisible();
  await page.getByRole("button", { name: "Häufige Frage „Welche Pflichten haben Hersteller?“ löschen" }).click();
  await expect(page.getByText("Häufige Fragen: sofortige Antwort ohne KI (2)")).toBeVisible();
  await page.getByRole("button", { name: /Exportieren/ }).click();
  const json = JSON.parse(await page.locator("#json-text").inputValue()) as { steps: { faq: { eintraege: { frage: string; quelle: string; datum: string }[] } }[] };
  expect(json.steps[0].faq.eintraege.map((e) => [e.frage, e.quelle])).toEqual([["Gilt der CRA für Software-Updates?", "lern"], ["Was ist eine SBOM?", "hand"]]);
  expect(json.steps[0].faq.eintraege[0].datum).toBe(new Date().toISOString().slice(0, 10));
});

test("Dienst: Vorschlag aus dem Chat einreichen, bleibt über die nächste Auswertung erhalten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const appId = `faq-${Date.now()}`;
  const api = async (pfad: string, init: RequestInit = {}) => fetch(`${DIENST}/api/lernen/${appId}${pfad}`, { ...init, headers: { Authorization: "Bearer test:dario", "Content-Type": "application/json" } });
  const r = await api("/vorschlaege", { method: "POST", body: JSON.stringify({ stepId: "s1", art: "faq", frage: "Was ist eine SBOM?", antwort: "Stückliste. Quelle: [FAQ](https://x)", herkunft: "chat" }) });
  expect(r.status).toBe(201);
  expect((await api("/vorschlaege", { method: "POST", body: JSON.stringify({ stepId: "s1", art: "faq", frage: "ohne Antwort" }) })).status).toBe(500);
  const nach = (await (await api("/auswerten", { method: "POST", body: JSON.stringify({ stepId: "s1", step: { id: "s1", key: "e", name: "E", rolle: "R", prompt: "{{frage}}" }, appName: "FAQ" }) })).json()) as { vorschlaege: { art: string; herkunft?: string; frage?: string }[] };
  expect(nach.vorschlaege.map((v) => [v.art, v.herkunft ?? "auswertung"])).toEqual([["faq", "chat"], ["glossar", "auswertung"], ["faq", "auswertung"], ["quelle", "auswertung"]]);
});
