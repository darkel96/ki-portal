import { test, expect, type Page } from "@playwright/test";

/**
 * Wissensquellen aus Microsoft 365: eigene E-Mails, Teams-Nachrichten und Termine eines Zeitraums gehen als Auszüge
 * an die KI, mit Filter aus einer Eingabe ({{thema}}). Graph wird abgefangen; die KI ist nachgebaut und merkt sich
 * die Anfragen.
 */
async function kiNachbau(page: Page) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    type Teil = { type: string; text?: string };
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string | Teil[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    prompts.push(`${body.system ?? ""}\n${typeof c === "string" ? c : c.filter((t) => t.type === "text").map((t) => t.text ?? "").join("\n")}`);
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "## Erreicht\n\n- Pflichtenheft freigegeben. Quelle: [E-Mail: KTE: Freigabe Pflichtenheft](https://outlook.test/a1)" } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  return prompts;
}

const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000).toISOString();

async function graphAttrappe(page: Page) {
  const pfade: string[] = [];
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pfad = url.pathname;
    pfade.push(pfad);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const ok = (wert: unknown) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(wert) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.headers()["authorization"] !== "Bearer test-token") return route.fulfill({ status: 401, headers: cors, body: "{}" });
    if (/^\/v1\.0\/me\/mailFolders\//.test(pfad)) return ok({ id: `ordner-${pfad.split("/").pop()}` });
    if (pfad === "/v1.0/me/messages") return ok({ value: [
      { id: "a1", subject: "KTE: Freigabe Pflichtenheft", from: { emailAddress: { name: "Anna Berger", address: "anna@firma.de" } }, toRecipients: [{ emailAddress: { name: "Dario Keller" } }], receivedDateTime: vor(2), bodyPreview: "Das Pflichtenheft KTE ist freigegeben.", body: { contentType: "html", content: "<p>Hallo,</p><p>das Pflichtenheft <b>KTE</b> ist freigegeben, Umsetzung startet Montag.</p>" }, webLink: "https://outlook.test/a1", parentFolderId: "inbox" },
      { id: "a2", subject: "Kantinenplan", from: { emailAddress: { name: "Verwaltung" } }, receivedDateTime: vor(1), bodyPreview: "Kantinenplan", body: { contentType: "text", content: "Der Kantinenplan für nächste Woche hängt an." }, webLink: "https://outlook.test/a2", parentFolderId: "inbox" },
      { id: "a3", subject: "KTE alt", from: { emailAddress: { name: "Archiv" } }, receivedDateTime: vor(1), bodyPreview: "gelöscht", body: { contentType: "text", content: "KTE, aber im Papierkorb." }, webLink: "https://outlook.test/a3", parentFolderId: "ordner-deleteditems" },
    ] });
    if (pfad === "/v1.0/me/chats") return ok({ value: [
      { id: "chat-anna", chatType: "oneOnOne", webUrl: "https://teams.test/chat-anna", members: [{ displayName: "Dario Keller" }, { displayName: "Anna Berger" }], lastMessagePreview: { createdDateTime: vor(1) } },
      { id: "chat-alt", chatType: "oneOnOne", members: [{ displayName: "Dario Keller" }, { displayName: "Alt" }], lastMessagePreview: { createdDateTime: vor(40) } },
    ] });
    if (pfad === "/v1.0/me/chats/chat-anna/messages") return ok({ value: [
      { id: "c1", messageType: "message", createdDateTime: vor(1), from: { user: { displayName: "Anna Berger" } }, body: { contentType: "html", content: "<p>KTE: Termin mit dem Kunden steht, Donnerstag 10 Uhr.</p>" } },
      { id: "c2", messageType: "message", createdDateTime: vor(1), from: { user: { displayName: "Anna Berger" } }, body: { contentType: "text", content: "Mittagessen?" } },
    ] });
    if (pfad === "/v1.0/me/joinedTeams") return ok({ value: [{ id: "t1", displayName: "Projekt KTE" }] });
    if (pfad === "/v1.0/teams/t1/channels") return ok({ value: [{ id: "k1", displayName: "Allgemein", webUrl: "https://teams.test/k1" }] });
    if (pfad === "/v1.0/teams/t1/channels/k1/messages") return ok({ value: [{ id: "k1m", messageType: "message", createdDateTime: vor(3), from: { user: { displayName: "Thomas Bothmann" } }, body: { contentType: "text", content: "KTE Lieferung der Steuerung verschiebt sich um eine Woche." } }] });
    if (pfad === "/v1.0/me/calendarView") return ok({ value: [
      { subject: "KTE Abstimmung", start: { dateTime: vor(3).replace(/Z$/, "") }, end: { dateTime: vor(3).replace(/Z$/, "") }, organizer: { emailAddress: { name: "Anna Berger" } }, attendees: [{ emailAddress: { name: "Dario Keller" } }], webLink: "https://outlook.test/t1" },
      { subject: "Kundentermin KTE", start: { dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString().replace(/Z$/, "") }, end: { dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString().replace(/Z$/, "") }, organizer: { emailAddress: { name: "Dario Keller" } } },
    ] });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-graph-test", "test-token"));
  return pfade;
}

test("Wochenrückblick: E-Mails, Teams und Termine gehen gefiltert als Auszüge an die KI, mit Links als Quellen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  const pfade = await graphAttrappe(page);
  await page.goto("/app/wochenrueckblick");
  await expect(page.getByRole("heading", { name: "Wochenrückblick", level: 1 })).toBeVisible();
  await page.getByLabel(/Projekt oder Thema/).fill("KTE");
  await page.getByRole("button", { name: /Ergebnisse erstellen/ }).click();
  await expect(page.getByText("Pflichtenheft freigegeben").first()).toBeVisible({ timeout: 20_000 });
  // Beide Schritte haben die Auszüge bekommen
  await expect.poll(() => prompts.length).toBeGreaterThanOrEqual(1);
  // Beide Schritte laufen gleichzeitig; die Reihenfolge der Anfragen ist offen
  const p = prompts.join("\n---\n");
  expect(p).toContain("### Meine E-Mails der Woche");
  expect(p).toContain("Dokument: E-Mail: KTE: Freigabe Pflichtenheft");
  expect(p).toContain("Link: https://outlook.test/a1");
  expect(p).toContain("das Pflichtenheft KTE ist freigegeben");        // HTML zu Text
  expect(p).not.toContain("Kantinenplan");                              // Filter „KTE“
  expect(p).not.toContain("im Papierkorb");                             // Gelöschte Elemente bleiben weg
  expect(p).toContain("2 E-Mails im Zeitraum, 1 davon passend zum Filter „KTE“");   // gelöschte zählen nicht
  expect(p).toContain("Dokument: Teams-Chat mit Dario Keller, Anna Berger");
  expect(p).toContain("Anna Berger: KTE: Termin mit dem Kunden steht");
  expect(p).not.toContain("Mittagessen");
  expect(p).toContain("Dokument: Teams-Kanal Projekt KTE › Allgemein");
  expect(p).toContain("Lieferung der Steuerung verschiebt sich");
  expect(p).toContain("Vergangene Termine (1):");
  expect(p).toContain("KTE Abstimmung");
  expect(p).toContain("Kommende Termine (1):");
  expect(p).toContain("Statusbericht zu „KTE“");
  // Der alte Chat (keine neuen Nachrichten) wurde nicht gelesen; die Quelle als Link in der Antwort
  expect(pfade).not.toContain("/v1.0/me/chats/chat-alt/messages");
  await page.getByText("Öffnen", { exact: true }).first().click();
  await expect(page.getByRole("link", { name: "E-Mail: KTE: Freigabe Pflichtenheft" }).first()).toHaveAttribute("href", "https://outlook.test/a1");
  // Die technischen Details nennen die Quellen
  await page.getByText("Technische Details").first().click();
  await expect(page.getByText(/Meine E-Mails der Woche/).first()).toBeVisible();
});

test("Ohne Copilot-Anmeldung liefern E-Mail-, Teams- und Kalenderquellen Beispiele, der Baukasten zeigt Zeitraum und Filter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  await page.goto("/app/wochen-briefing");
  await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await page.getByRole("button", { name: /Ergebnisse erstellen/ }).click();
  await expect.poll(() => prompts.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const alle = prompts.join("\n---\n");
  expect(alle).toContain("### Meine Termine (Beispiel)");
  expect(alle).toContain("Kommende Termine");
  expect(alle).toContain("### Meine E-Mails der letzten Woche (Beispielpostfach)");
  expect(alle).toContain("Dokument: E-Mail: CRA Attest Retrofit Linie 3");   // Filter „CRA, Nordhafen, Audit“
  expect(alle).toContain("Angebot Serviceleistungen Kunde Nordhafen");
  expect(alle).not.toContain("Rückfrage SBOM für Steuerungssoftware");        // kein Filterwort
  expect(alle).not.toContain("Wochenbericht Produktsicherheit");
  expect(alle).toContain("### Meine Teams-Nachrichten der letzten Woche (Beispiel)");
  // Baukasten: Quelle mit Zeitraum und Filter statt Adresse
  await page.goto("/baukasten?kopie=wochenrueckblick");
  await page.getByRole("tab", { name: "Wissen", exact: true }).first().click();
  await expect(page.getByLabel("Zeitraum in Tagen").first()).toHaveValue("7");
  await expect(page.getByLabel("Filter (Wörter, Komma getrennt)").first()).toHaveValue("{{thema}}");
  await expect(page.getByLabel("Adresse der Quelle")).toHaveCount(0);
  await expect(page.getByLabel("Zeitraum in Tagen")).toHaveCount(3);
  await page.getByRole("button", { name: "Meine E-Mails" }).click();
  await expect(page.getByLabel("Zeitraum in Tagen")).toHaveCount(4);
});
