import { test, expect, type Page } from "@playwright/test";

test("Copilot-Antworten: entdoppeln, JSON, Streaming", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const c = await import("/src/lib/ki/copilot.ts");
    const k = await import("/src/lib/ki/index.ts");
    const A = "## Variante 1\nText mit genug Länge für den Test.";
    const sse = (events: string[]) => new Response(new ReadableStream({
      start(ctl) { const enc = new TextEncoder(); for (const e of events) ctl.enqueue(enc.encode(e)); ctl.close(); },
    }), { headers: { "content-type": "text/event-stream" } });
    const conv = (t: string) => `data: ${JSON.stringify({ id: "c1", messages: [{ text: "FRAGE" }, { text: t }] })}\n\n`;
    const teile: string[] = [];
    const kum = await c.streamLesen(sse([conv("Hal"), conv("Hallo Wel"), conv("Hallo Welt")]), "FRAGE", (t) => teile.push(t), 0, {});
    const delta = await c.streamLesen(sse([conv("Hal"), conv("lo "), "data: [DONE]\n\n", conv("Welt")]), "FRAGE", () => {}, 0, {});
    // Ereignis über zwei Netzwerk-Pakete verteilt
    const geteilt = await c.streamLesen(sse([conv("Hallo").slice(0, 20), conv("Hallo").slice(20)]), "FRAGE", () => {}, 0, {});
    // Copilot schreibt den bisherigen Text um (Quellenzeile erst als Markdown-Link, dann als nackte Adresse): kein Anhängen
    const basis = "Für uns als Hersteller bedeutet der CRA vor allem: Cybersicherheit über den Lebenszyklus.\n\nQuelle: ";
    const umgeschrieben = await c.streamLesen(sse([conv(basis + "[CRA Schulung](https://x.sharepoint.com/Termin%201%20(1"), conv(basis + "https://x.sharepoint.com/Termin%201%20(1.docx)"), conv(basis + "https://x.sharepoint.com/Termin%201%20(1).docx\n\nSoll ich"), conv(basis + "https://x.sharepoint.com/Termin%201%20(1).docx\n\nSoll ich weitermachen?")]), "FRAGE", () => {}, 0, {});
    // Copilot hängt die fertige Antwort noch einmal an: Die Anzeige bleibt stabil, das Ergebnis ist einfach
    const lang = "Der Cyber Resilience Act ist eine EU-Verordnung für Produkte mit digitalen Elementen.";
    const doppelTeile: string[] = [];
    const streamDoppelt = await c.streamLesen(sse([conv(lang.slice(0, 30)), conv(lang), conv(lang + "\n\n" + lang.slice(0, 25)), conv(lang + "\n\n" + lang)]), "FRAGE", (t) => doppelTeile.push(t), 0, {});
    // Zweitfassung mit korrigierter Adresse am Ende (erst „(1.docx)“, dann „(1).docx“): die spätere Fassung bleibt, einmal
    const erst = "Der CRA beinhaltet für unsere Produkte vor allem Security by Design.\n\nQuelle: https://x.sharepoint.com/Termin%201%20(1.docx)";
    const dann = "Der CRA beinhaltet für unsere Produkte vor allem Security by Design.\n\nQuelle: https://x.sharepoint.com/Termin%201%20(1).docx";
    const korrigiertTeile: string[] = [];
    const korrigiert = await c.streamLesen(sse([conv(erst), conv(erst + dann.slice(0, 40)), conv(erst + dann)]), "FRAGE", (t) => korrigiertTeile.push(t), 0, {});
    const korrigiertEnde = c.entdoppeln(erst + dann);
    // Trennzeichen vor der Zweitfassung
    const getrennt = await c.streamLesen(sse([conv(lang), conv(lang + "\n\n---\n\n" + lang.slice(0, 30)), conv(lang + "\n\n---\n\n" + lang)]), "FRAGE", () => {}, 0, {});
    const getrenntEnde = c.entdoppeln(lang + "\n\n---\n\n" + lang);
    const jsonNicht = new Response(JSON.stringify({ messages: [{ text: "FRAGE" }, { text: "Antwort" }] }), { headers: { "content-type": "application/json" } });
    const ohneStream = await c.streamLesen(jsonNicht, "FRAGE", () => {}, 0, {});
    return {
      doppelt: c.entdoppeln(A + A), doppeltLeer: c.entdoppeln(A + "\n\n" + A), einfach: c.entdoppeln(A), kurz: c.entdoppeln("abab"),
      json: k.jsonAus('Hier: {"a":"}{","b":{"c":1}}{"a":"}{","b":{"c":1}}'), jsonFence: k.jsonAus('```json\n{"x":"\\"}"}\n```'),
      kum, teile, delta, geteilt, ohneStream, umgeschrieben, streamDoppelt, doppelTeile, lang, korrigiert, korrigiertTeile, korrigiertEnde, dann, erst, getrennt, getrenntEnde,
    };
  });
  expect(r.doppelt).toBe("## Variante 1\nText mit genug Länge für den Test.");
  expect(r.doppeltLeer).toBe(r.doppelt);
  expect(r.einfach).toBe(r.doppelt);
  expect(r.kurz).toBe("abab");
  expect(r.json).toEqual({ a: "}{", b: { c: 1 } });
  expect(r.jsonFence).toEqual({ x: '"}' });
  expect(r.kum).toBe("Hallo Welt");
  expect(r.teile).toEqual(["Hal", "Hallo Wel", "Hallo Welt"]);
  expect(r.delta).toBe("Hallo Welt");
  expect(r.geteilt).toBe("Hallo");
  expect(r.ohneStream).toBe("Antwort");
  expect(r.streamDoppelt).toBe(r.lang);
  expect(r.korrigiert).toBe(r.dann);
  expect(r.korrigiertTeile).toEqual([r.erst, r.dann]);
  expect(r.korrigiertEnde).toBe(r.dann);
  expect(r.getrennt).toBe(r.lang);
  expect(r.getrenntEnde).toBe(r.lang);
  expect(r.doppelTeile).toEqual([r.lang.slice(0, 30), r.lang]);
  expect(r.umgeschrieben).toBe("Für uns als Hersteller bedeutet der CRA vor allem: Cybersicherheit über den Lebenszyklus.\n\nQuelle: https://x.sharepoint.com/Termin%201%20(1).docx\n\nSoll ich weitermachen?");
});

/** Nachgebaute Anthropic-Schnittstelle: jede Antwort kommt nach 1,5 s; Start- und Endzeiten werden mitgeschrieben. */
async function claudeNachbau(page: Page) {
  const log: { start: number; ende: number }[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 1500));
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const body = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Ergebnis " } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: `um ${start}` } }),
      ev("content_block_stop", { index: 0 }),
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }),
      ev("message_stop", {}),
    ].join("");
    log.push({ start, ende: Date.now() });
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  return log;
}

async function laufen(page: Page, id: string) {
  await page.goto(`/app/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const mehr = page.getByRole("button", { name: "Weitere Aktionen" });
  if (await mehr.isVisible()) { await mehr.click(); await page.getByRole("menuitem", { name: "Beispieldaten einsetzen" }).click(); }
  else await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|^Weiter$|^Erstellen$|Ausführen/ }).click();
  await expect(page.locator(".e-kachel .status-pill")).toHaveText(["Fertig", "Fertig"], { timeout: 15_000 });
}

test("Unabhängige Schritte laufen gleichzeitig (Meeting-Protokoll)", async ({ page }) => {
  const log = await claudeNachbau(page);
  await laufen(page, "protokoll");
  expect(log).toHaveLength(2);
  expect(Math.abs(log[0].start - log[1].start)).toBeLessThan(700);
});

test("Abhängige Schritte bleiben nacheinander (Stellenanzeige)", async ({ page }) => {
  const log = await claudeNachbau(page);
  await laufen(page, "stellenanzeige");
  expect(log).toHaveLength(2);
  expect(log[1].start).toBeGreaterThanOrEqual(log[0].ende);
});
