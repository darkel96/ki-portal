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
    const text = prompt.includes("weitere Suchbegriffe") ? JSON.stringify({ begriffe: ["SBOM"] }) : prompt.includes("Welche dieser E-Mails") ? JSON.stringify({ nummern: [...prompt.matchAll(/^(\d+) \|(.*)$/gm)].filter((m) => /CRA|Cyber Resilience|SBOM/i.test(m[2]!)).map((m) => Number(m[1])) }) : prompt.includes("Entwirf eine Antwort") ? "Hallo Anna,\n\ndanke, ich gebe das Attest bis Freitag frei.\n\nViele Grüße\nDario" : "**Kurz:** Anna bittet um Freigabe des CRA Attests bis Freitag.";
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
  // Prozedur: Die KI wählt (CRA-Mails und die SBOM-Rückfrage, die das Wort „CRA“ nicht enthält), dann verschieben
  await post.getByRole("button", { name: "Prozeduren" }).click();
  await post.getByRole("button", { name: "CRA ablegen" }).click();
  const treffer = post.getByRole("group", { name: "Gefundene Mails" });
  await expect(treffer).toContainText("4 von 4 Mails ausgewählt");
  await expect(treffer).toContainText("CRA Attest Retrofit Linie 3");
  await expect(treffer).toContainText("VDMA CRA FAQ 2.0");
  await expect(treffer).toContainText("Rückfrage SBOM");
  // Spalte mit dem Ordner, in dem die Mail gerade liegt
  await expect(treffer.locator("li").filter({ hasText: "CRA Attest Retrofit Linie 3" }).locator(".o-post-ort")).toHaveText("Posteingang");
  // Eine abwählen, dann verschieben
  await treffer.getByLabel(/Rückfrage SBOM/).uncheck();
  // „CRA-Ablage“ gibt es noch nicht: die Schaltfläche sagt, dass er angelegt wird
  await expect(treffer).toContainText("Einen Ordner „CRA-Ablage“ gibt es noch nicht");
  await treffer.getByRole("button", { name: "„CRA-Ablage“ anlegen und verschieben" }).click();
  await expect(post.getByText("3 Mails nach „CRA-Ablage“ verschoben.").first()).toBeVisible();
  await expect(post.getByRole("navigation", { name: "Ordner" }).getByRole("button", { name: /CRA-Ablage/ })).toBeVisible();
  await post.getByRole("navigation", { name: "Ordner" }).getByRole("button", { name: /CRA-Ablage/ }).click();
  await expect(post.locator(".o-post-nachricht")).toHaveCount(3);
  await page.screenshot({ path: `screenshots/${info.project.name}-postfach-ki.png` });
});

test("Themensuche: Füllwörter zählen nicht, Wortanfang statt Teilwort, die KI entscheidet; eigene Prozedur merken", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const t = await import("/src/lib/themensuche.ts");
    const w = t.suchWorte("Alles zum Projekt KTE");
    return {
      w, nurFuell: t.suchWorte("Projekt"),
      treffer: ["KTE: TGW Remotezugriffe", "AW: KTE-Projekt Stand", "Digital Projects @KTE"].map((x) => t.passtZumThema(x, w)),
      daneben: ["Projektname: AU20-430", "Ihr Team arbeitet an diesen Seiten – zum Mitmachen", "Projekte im Überblick"].map((x) => t.passtZumThema(x, w)),
      endung: t.passtZumThema("AW: Remotezugriffe TGW", t.suchWorte("Remotezugriff")),
    };
  });
  expect(r.w).toEqual(["kte"]);
  expect(r.nurFuell).toEqual(["projekt"]);
  expect(r.treffer).toEqual([true, true, true]);
  expect(r.daneben).toEqual([false, false, false]);
  expect(r.endung).toBe(true);
  // Eigene Prozedur merken: bleibt nach dem Neuladen, lässt sich wieder vergessen
  await kiNachbau(page);
  const app = { ...APP, blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "pf-merken", type: "postfach", props: { titel: "Postfach", anzahl: 25, vorschau: true, prozeduren: [] } },
  ] }] };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/post-app");
  const post = page.locator(".o-post");
  await post.getByRole("button", { name: "Prozeduren" }).click();
  await post.getByRole("textbox", { name: "Thema", exact: true }).fill("Attest Retrofit");
  await post.getByRole("textbox", { name: "Zielordner", exact: true }).fill("Retrofit");
  await post.getByRole("button", { name: "Merken" }).click();
  await expect(page.getByText("„Attest Retrofit“ gemerkt.", { exact: false })).toBeVisible();
  await page.reload();
  await page.locator(".o-post").getByRole("button", { name: "Prozeduren" }).click();
  await expect(page.locator(".o-post").getByRole("button", { name: "Attest Retrofit", exact: true })).toBeVisible();
  await page.locator(".o-post").getByRole("button", { name: "„Attest Retrofit“ vergessen" }).click();
  await expect(page.locator(".o-post").getByRole("button", { name: "Attest Retrofit", exact: true })).toHaveCount(0);
});

test("Themensuche über Microsoft: durchsucht den ganzen Zeitraum, KI ergänzt Begriffe und prüft, Zielordner bleibt außen vor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page);
  const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000).toISOString();
  const suchen: string[] = [];
  const mail = (id: string, betreff: string, tage: number, ordner: string) => ({ id, subject: betreff, from: { emailAddress: { name: "Anna Berger", address: "anna@firma.de" } }, receivedDateTime: vor(tage), bodyPreview: betreff, parentFolderId: ordner });
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const ok = (wert: unknown) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(wert) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const pfad = url.pathname.replace("/v1.0/me", "");
    if (pfad === "/mailFolders" ) return ok({ value: [{ id: "inbox", displayName: "Inbox", unreadItemCount: 0, totalItemCount: 3 }, { id: "f-cra", displayName: "CRA-Ablage", totalItemCount: 1 }] });
    if (/^\/mailFolders\/[a-z]+$/.test(pfad) && !url.searchParams.has("$top")) return ok({ id: pfad.split("/").pop() });
    if (/^\/mailFolders\/.+\/childFolders/.test(pfad) || /^\/mailFolders\/.+\/messages/.test(pfad)) return ok({ value: [] });
    if (pfad === "/messages" && url.searchParams.has("$search")) {
      const s = url.searchParams.get("$search")!;
      suchen.push(s);
      if (s.includes("SBOM")) return ok({ value: [mail("s1", "Rückfrage SBOM Steuerung", 120, "inbox")] });
      return ok({ value: [mail("c1", "CRA Attest Linie 3", 2, "inbox"), mail("c2", "CRA Newsletter alt", 170, "inbox"), mail("c3", "CRA schon abgelegt", 5, "f-cra"), mail("c4", "CRA im Papierkorb", 3, "deleteditems")] });
    }
    return ok({ value: [] });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-graph-test", "test-token"));
  const app = { ...APP, blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "pf", type: "postfach", props: { titel: "Postfach", anzahl: 25, vorschau: true, prozeduren: [{ name: "CRA ablegen", thema: "Alles zum CRA", tage: 180, zielordner: "CRA-Ablage", ki: true }] } },
  ] }] };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/post-app");
  const post = page.locator(".o-post");
  await post.getByRole("button", { name: "Prozeduren" }).click();
  await post.getByRole("button", { name: "CRA ablegen" }).click();
  const treffer = post.getByRole("group", { name: "Gefundene Mails" });
  await expect(treffer).toContainText("3 von 3 Mails ausgewählt", { timeout: 15_000 });
  // Gesucht wird bei Microsoft im ganzen Zeitraum, nur nach echten Suchwörtern, dann nach dem Begriff der KI
  expect(suchen[0]).toMatch(/^"\(cra\) AND received>=\d{4}-\d{2}-\d{2}"$/);
  expect(suchen[0]).toContain(`received>=${vor(180).slice(0, 10)}`);
  expect(suchen.some((s) => s.includes("SBOM"))).toBe(true);
  // Auch die Mail von vor 170 Tagen ist dabei; Papierkorb und Zielordner nicht
  await expect(treffer).toContainText("CRA Newsletter alt");
  await expect(treffer).toContainText("Rückfrage SBOM Steuerung");
  await expect(treffer).not.toContainText("CRA im Papierkorb");
  await expect(treffer).not.toContainText("CRA schon abgelegt");
  await expect(post.getByText("1 Mail liegt schon in „CRA-Ablage“.")).toBeVisible();
  expect(prompts.some((p) => p.includes("weitere Suchbegriffe"))).toBe(true);
});

test("Postfach über Microsoft: höchstens drei Anfragen gleichzeitig (sonst bremst Exchange mit 429), 429 wird abgewartet", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  let gleichzeitig = 0, hoechstens = 0, gebremst = 0;
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "Retry-After" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    gleichzeitig++; hoechstens = Math.max(hoechstens, gleichzeitig);
    await new Promise((r) => setTimeout(r, 150));
    gleichzeitig--;
    const ok = (wert: unknown) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(wert) });
    const pfad = url.pathname.replace("/v1.0/me", "");
    if (pfad === "/mailFolders") return ok({ value: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, displayName: `Ordner ${i}`, unreadItemCount: 0, totalItemCount: 1, childFolderCount: 1 })) });
    if (/childFolders/.test(pfad)) {
      // Eine Anfrage wird einmal gebremst
      if (pfad.includes("/f3/") && gebremst++ === 0) return route.fulfill({ status: 429, headers: { ...cors, "Retry-After": "1" }, body: JSON.stringify({ error: { code: "ApplicationThrottled" } }) });
      return ok({ value: [{ id: `${pfad.split("/")[2]}-k`, displayName: `Unter ${pfad.split("/")[2]}`, unreadItemCount: 0, totalItemCount: 0 }] });
    }
    if (/^\/mailFolders\/[a-z]+$/.test(pfad)) return ok({ id: pfad.split("/").pop() });
    return ok({ value: [] });
  });
  await page.addInitScript((a) => { localStorage.setItem("kihub-graph-test", "test-token"); localStorage.setItem("kihub-apps-v3", JSON.stringify([a])); }, APP);
  await page.goto("/app/post-app");
  const ordner = page.locator(".o-post").getByRole("navigation", { name: "Ordner" });
  await expect(ordner.getByRole("button", { name: /Ordner 7/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Fehler 429/)).toHaveCount(0);
  expect(gebremst).toBeGreaterThanOrEqual(2);
  expect(hoechstens).toBeLessThanOrEqual(3);
});

test("Zielordner wird in allen Ebenen gesucht: „KTE“ unter Projekte wird genutzt, nicht neu angelegt; doppelte Namen muss man genauer angeben", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await kiNachbau(page);
  const app = { ...APP, blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "pf", type: "postfach", props: { titel: "Postfach", anzahl: 25, vorschau: true, prozeduren: [] } },
  ] }] };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/post-app");
  const post = page.locator(".o-post");
  await post.getByRole("button", { name: "Prozeduren" }).click();
  await post.getByRole("textbox", { name: "Thema", exact: true }).fill("Nordhafen");
  await post.getByRole("textbox", { name: "Zielordner", exact: true }).fill("KTE");
  await post.getByRole("checkbox", { name: /KI wählt/ }).uncheck();
  await post.getByRole("button", { name: "Vorschau" }).click();
  const treffer = post.getByRole("group", { name: "Gefundene Mails" });
  await expect(treffer).toContainText("Ziel: Posteingang › Projekte › KTE");
  await treffer.getByRole("button", { name: "Nach „Projekte › KTE“ verschieben" }).click();
  await expect(post.getByText("1 Mail nach „Posteingang › Projekte › KTE“ verschoben.").first()).toBeVisible();
  // Kein zweiter Ordner „KTE“ auf oberster Ebene
  const ordner = post.getByRole("navigation", { name: "Ordner" });
  await expect(ordner.getByRole("button", { name: /^KTE/ })).toHaveCount(0);
  // Gibt es den Namen zweimal, legt der Hub nichts an und verschiebt nicht, bis der Pfad eindeutig ist
  const r = await page.evaluate(async () => {
    const p = await import("/src/lib/ki/postfach.ts");
    await p.ordnerNeuAnlegen("CRA");
    return { zwei: (await p.zielOrdnerSuchen("CRA")).map((o) => o.pfad.join(" › ")), eins: (await p.zielOrdnerSuchen("Posteingang/CRA")).length, teile: p.pfadTeile("Projekte › KTE") };
  });
  expect(r.zwei).toEqual(["Posteingang › CRA", "CRA"]);
  expect(r.eins).toBe(1);
  expect(r.teile).toEqual(["Projekte", "KTE"]);
});
