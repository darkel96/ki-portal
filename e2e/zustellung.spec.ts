import { test, expect, type Page } from "@playwright/test";

/**
 * Zustellung von Auftragsergebnissen aus dem Browser: per E-Mail an mich, als Teams-Nachricht an mich (Chat mit sich
 * selbst), in einen Teams-Kanal (Webhook). Graph wird mit einer Attrappe abgefangen; die KI antwortet nachgebaut.
 */
const APP = {
  id: "plan-app", name: "Wochenplan", bereich: "Allgemein", status: "freigegeben", version: 1,
  steps: [{ id: "s1", key: "plan", name: "Plan", prompt: "Plane: {{thema}}" }],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Start" }, children: [{ id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } }] },
    { id: "p2", type: "seite", props: { titel: "Ergebnis" }, children: [{ id: "o1", type: "output", props: { titel: "Plan", quelle: "s1" } }] },
  ],
};

type Post = { pfad: string; body: unknown };

/** Nachgebaute KI und Graph-Attrappe; sammelt alles, was an Graph oder den Webhook geht */
const PLAN = "## Diese Woche\n\n- **Montag**: Kriterienliste\n- Dienstag: Angebot\n\n| Tag | Fokus |\n|---|---|\n| Mo | CRA |";
async function attrappen(page: Page, kiText = PLAN, optionen: { bilderAblehnen?: boolean } = {}) {
  const posts: Post[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: kiText } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pfad = url.pathname;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.headers()["authorization"] !== "Bearer test-token") return route.fulfill({ status: 401, headers: cors, body: "{}" });
    if (req.method() === "GET" && pfad === "/v1.0/me") return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ id: "me1", mail: "ich@firma.de", userPrincipalName: "ich@firma.de" }) });
    // Der Chat mit mir selbst steht erst auf der zweiten Seite (Graph liefert 50 je Seite, ohne Reihenfolge)
    if (req.method() === "GET" && pfad === "/v1.0/me/chats" && !url.searchParams.has("$skiptoken")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ value: [{ id: "chat-anna", chatType: "oneOnOne", members: [{ email: "ich@firma.de", userId: "me1" }, { email: "anna@firma.de", userId: "u2" }] }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$filter=chatType%20eq%20'oneOnOne'&$expand=members&$top=50&$skiptoken=seite2" }) });
    if (req.method() === "GET" && pfad === "/v1.0/me/chats") return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ value: [{ id: "19:me1_me1@unq.gbl.spaces", chatType: "oneOnOne", members: [{ email: null, userId: "me1" }] }] }) });
    if (req.method() === "POST") {
      posts.push({ pfad: decodeURIComponent(pfad), body: req.postDataJSON() });   // Chat-IDs stehen kodiert im Pfad
      if (pfad === "/v1.0/me/sendMail") {
        const mitBild = !!(req.postDataJSON() as { message: { attachments?: unknown[] } }).message.attachments?.length;
        if (optionen.bilderAblehnen && mitBild) return route.fulfill({ status: 413, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { code: "ErrorMessageSizeExceeded", message: "zu groß" } }) });
        return route.fulfill({ status: 202, headers: cors });
      }
      if (pfad === "/v1.0/chats") {
        const m = (req.postDataJSON() as { members: { "user@odata.bind": string }[] }).members.map((x) => x["user@odata.bind"]);
        if (m[0] === m[1]) return route.fulfill({ status: 400, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { code: "BadRequest", message: "Duplicate members" } }) });
        return route.fulfill({ status: 201, headers: cors, contentType: "application/json", body: JSON.stringify({ id: "chat-neu" }) });
      }
      if (/^\/v1\.0\/chats\/[^/]+\/messages$/.test(pfad)) return route.fulfill({ status: 201, headers: cors, contentType: "application/json", body: JSON.stringify({ id: "msg1" }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.route("https://webhook.test/**", async (route) => {
    posts.push({ pfad: "webhook", body: route.request().postDataJSON() });
    await route.fulfill({ status: 202, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  });
  await page.addInitScript(() => { localStorage.setItem("kihub-anthropic-key", "sk-ant-test"); localStorage.setItem("kihub-graph-test", "test-token"); });
  return posts;
}

const auftrag = (id: string, name: string, ziel: { art: string; adresse: string }) => ({
  id, name, appId: "plan-app", voreinstellungId: "v1", zeitplan: { art: "taeglich", uhrzeit: "07:00", wochentag: 1, tag: 1 }, ziel, aktiv: true,
  naechsterLauf: new Date(Date.now() - 60_000).toISOString(), letzterLauf: "", erstellt: new Date().toISOString(),
});

test("Aufträge stellen ihr Ergebnis zu: E-Mail an mich, Teams-Chat mit mir, Teams-Kanal per Webhook", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const posts = await attrappen(page);
  const jetzt = new Date().toISOString();
  await page.addInitScript(({ app, meinHub }) => {
    localStorage.setItem("kihub-apps-v3", JSON.stringify([app]));
    localStorage.setItem("kihub-meinhub-v1:lokal", JSON.stringify(meinHub));
  }, { app: APP, meinHub: {
    v: 1, nutzer: "lokal", pins: [], laeufe: [], automatisch: true,
    voreinstellungen: [{ id: "v1", appId: "plan-app", name: "Standard", werte: { thema: "Woche 43" }, dateien: {}, erstellt: jetzt, geaendert: jetzt }],
    auftraege: [auftrag("a1", "Mailbericht", { art: "email", adresse: "" }), auftrag("a2", "Teamsbericht", { art: "teams", adresse: "" }), auftrag("a3", "Kanalbericht", { art: "teams", adresse: "https://webhook.test/kanal/abc" })],
  } });
  await page.goto("/mein");
  await expect(page.getByRole("tab", { name: /Verlauf \(3\)/ })).toBeVisible({ timeout: 30_000 });
  // Alle drei zugestellt; der Verlauf nennt den Weg
  const zugestellt = () => posts.filter((p) => p.pfad !== "/v1.0/chats").length;   // der Versuch, den Chat mit sich selbst anzulegen, zählt nicht
  await expect.poll(zugestellt, { timeout: 15_000 }).toBe(3);
  const mail = posts.find((p) => p.pfad === "/v1.0/me/sendMail")!.body as { message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] } };
  expect(mail.message.subject).toBe("KI-Hub: Mailbericht");
  expect(mail.message.toRecipients[0].emailAddress.address).toBe("ich@firma.de");
  // Markdown wurde zu schlichtem HTML: Überschrift fett, Liste, Tabelle
  expect(mail.message.body.content).toContain("<p><b>Diese Woche</b></p>");
  expect(mail.message.body.content).toContain("<li><b>Montag</b>: Kriterienliste</li>");
  expect(mail.message.body.content).toContain("<th align=\"left\">Tag</th>");
  const teams = posts.find((p) => p.pfad === "/v1.0/chats/19:me1_me1@unq.gbl.spaces/messages")!.body as { body: { contentType: string; content: string } };
  expect(teams.body.contentType).toBe("html");
  expect(teams.body.content).toContain("Teamsbericht");
  const kanal = posts.find((p) => p.pfad === "webhook")!.body as { type: string; attachments: { content: { body: { text: string }[] } }[] };
  expect(kanal.type).toBe("message");
  expect(kanal.attachments[0].content.body[0].text).toContain("**Kanalbericht**");
  await page.getByRole("tab", { name: /Verlauf/ }).click();
  await page.getByText("Mailbericht", { exact: true }).first().click();
  await expect(page.locator(".mh-zustellung")).toHaveText("Per E-Mail an ich@firma.de gesendet.");
  await page.getByRole("button", { name: "Verlauf" }).click();
  await page.getByText("Teamsbericht", { exact: true }).first().click();
  await expect(page.locator(".mh-zustellung")).toHaveText("Als Teams-Nachricht an dich gesendet.");
  // Aufträge zeigen ihr Ziel
  await page.getByRole("tab", { name: /Aufträge/ }).click();
  await expect(page.getByText("Per E-Mail an mich")).toBeVisible();
  await expect(page.getByText("In einen Teams-Kanal (Webhook)")).toBeVisible();
});

test("Beispiel-App „Wochen-Briefing“: Auftrag-Dialog übernimmt die Empfehlung, Testnachricht geht raus", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const posts = await attrappen(page);
  await page.goto("/app/wochen-briefing");
  await expect(page.getByRole("heading", { name: "Wochen-Briefing", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Beispieldaten einsetzen" }).click();
  await page.getByRole("button", { name: /^Voreinstellungen/ }).click();
  await page.getByRole("menuitem", { name: /Regelmäßig ausführen/ }).click();
  const dialog = page.getByRole("dialog", { name: "Regelmäßig ausführen" });
  // Empfehlung der App: wöchentlich, Montag, 07:00, per E-Mail
  await expect(dialog.getByRole("radio", { name: "Wöchentlich" })).toBeChecked();
  await expect(dialog.getByLabel("Uhrzeit")).toHaveValue("07:00");
  await expect(dialog.getByRole("combobox", { name: "Ergebnis" })).toContainText("Per E-Mail");
  await expect(dialog.getByText(/Ergebnis per E-Mail an mich/)).toBeVisible();
  // Adresse prüfen, Testnachricht
  await dialog.getByLabel("Empfänger (optional)").fill("kein-postfach");
  await expect(dialog.getByText("Die E-Mail-Adresse sieht nicht vollständig aus.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await dialog.getByLabel("Empfänger (optional)").fill("team@firma.de");
  await dialog.getByRole("button", { name: "Zustellung testen" }).click();
  await expect(page.getByText(/Testnachricht per E-Mail an team@firma.de: Per E-Mail an team@firma.de gesendet\./)).toBeVisible();
  const test1 = posts.find((p) => p.pfad === "/v1.0/me/sendMail")!.body as { message: { subject: string } };
  expect(test1.message.subject).toBe("KI-Hub: Test aus „Wochen-Briefing“");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/Auftrag „Wochen-Briefing“ gespeichert\. .*Ergebnis per E-Mail an team@firma\.de\./)).toBeVisible();
  await page.goto("/mein");
  await page.getByRole("tab", { name: /Aufträge \(1\)/ }).click();
  await expect(page.getByText("Per E-Mail an team@firma.de")).toBeVisible();
});

test("„Senden“ an den Ergebnissen schickt einen fertigen Lauf sofort per E-Mail oder Teams an mich", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const posts = await attrappen(page);
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/app/plan-app");
  await page.getByLabel("Thema").fill("Woche 44");
  await page.getByRole("button", { name: /Ergebnisse erstellen/ }).click();
  await expect(page.getByText("1 von 1 fertig")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("menuitem", { name: "Als Teams-Nachricht an mich" }).click();
  await expect(page.getByText("Als Teams-Nachricht an dich gesendet.")).toBeVisible();
  const teams = posts.find((p) => p.pfad === "/v1.0/chats/19:me1_me1@unq.gbl.spaces/messages")!.body as { body: { content: string } };
  expect(teams.body.content).toContain("Wochenplan");
  expect(teams.body.content).toContain("<li><b>Montag</b>: Kriterienliste</li>");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("menuitem", { name: "Per E-Mail an mich" }).click();
  await expect(page.getByText("Per E-Mail an ich@firma.de gesendet.")).toBeVisible();
  expect((posts.find((p) => p.pfad === "/v1.0/me/sendMail")!.body as { message: { subject: string } }).message.subject).toBe("KI-Hub: Wochenplan");
});

const MIT_DIAGRAMM = "## Ablauf\n\nSo läuft es:\n\n```mermaid\nflowchart TD\n  A[Angebot] --> B{Freigabe?}\n  B -->|Ja| C[Auftrag]\n```\n\nEnde.";

test("Diagramme kommen in Mail und Teams als eingebettetes Bild an, nicht als Quelltext", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const posts = await attrappen(page, MIT_DIAGRAMM);
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/app/plan-app");
  await page.getByLabel("Thema").fill("Woche 44");
  await page.getByRole("button", { name: /Ergebnisse erstellen/ }).click();
  await expect(page.getByText("1 von 1 fertig")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("menuitem", { name: "Per E-Mail an mich" }).click();
  await expect(page.getByText("Per E-Mail an ich@firma.de gesendet.")).toBeVisible({ timeout: 20_000 });
  const mail = posts.find((p) => p.pfad === "/v1.0/me/sendMail")!.body as { message: { body: { content: string }; attachments: { contentType: string; isInline: boolean; contentId: string; contentBytes: string }[] } };
  expect(mail.message.body.content).toContain('src="cid:diagramm1"');
  expect(mail.message.body.content).not.toContain("flowchart");
  expect(mail.message.body.content).toContain("Ende.");
  expect(mail.message.attachments).toHaveLength(1);
  expect(mail.message.attachments[0]).toMatchObject({ contentType: "image/png", isInline: true, contentId: "diagramm1" });
  expect(Buffer.from(mail.message.attachments[0].contentBytes, "base64").subarray(1, 4).toString()).toBe("PNG");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("menuitem", { name: "Als Teams-Nachricht an mich" }).click();
  await expect(page.getByText("Als Teams-Nachricht an dich gesendet.")).toBeVisible({ timeout: 20_000 });
  const teams = posts.find((p) => p.pfad === "/v1.0/chats/19:me1_me1@unq.gbl.spaces/messages")!.body as { body: { content: string }; hostedContents: { "@microsoft.graph.temporaryId": string; contentType: string }[] };
  expect(teams.body.content).toContain('src="../hostedContents/1/$value"');
  expect(teams.hostedContents).toEqual([expect.objectContaining({ "@microsoft.graph.temporaryId": "1", contentType: "image/png" })]);
});

test("Lehnt Microsoft die Bilder ab, kommt die Mail trotzdem an, mit Quelltext und Hinweis", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const posts = await attrappen(page, MIT_DIAGRAMM, { bilderAblehnen: true });
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), APP);
  await page.goto("/app/plan-app");
  await page.getByLabel("Thema").fill("Woche 44");
  await page.getByRole("button", { name: /Ergebnisse erstellen/ }).click();
  await expect(page.getByText("1 von 1 fertig")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("menuitem", { name: "Per E-Mail an mich" }).click();
  await expect(page.getByText(/Die Diagramme kamen als Quelltext/)).toBeVisible({ timeout: 20_000 });
  const mails = posts.filter((p) => p.pfad === "/v1.0/me/sendMail").map((p) => p.body as { message: { body: { content: string }; attachments?: unknown[] } });
  expect(mails).toHaveLength(2);
  expect(mails[1].message.attachments).toBeUndefined();
  expect(mails[1].message.body.content).toContain("flowchart TD");
});
