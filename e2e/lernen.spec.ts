import { test, expect, type Page } from "@playwright/test";

/**
 * Lernschicht: Rückmeldungen im Chat, Hausregeln-Block in der Systemanweisung, Auswertung und Freigabe im Baukasten,
 * Ablage und automatische Auswertung im Hub-Dienst.
 */
const DIENST = "http://localhost:8787";
const OHNE = "Dazu habe ich in den Unterlagen nichts gefunden. Das würde die Richtlinie zur Meldefrist klären.";
const MIT = "Laut **Art. 13** gelten die Herstellerpflichten ab dem Inverkehrbringen.\n\nQuelle: [Verordnungstext, Art. 13](https://firma.sharepoint.com/sites/cra/Verordnung.pdf)";
const VORSCHLAEGE = JSON.stringify({ zusammenfassung: "Zwei Rückfragen zum Begriff SBOM.", vorschlaege: [{ art: "glossar", text: "SBOM (Software Bill of Materials): Stückliste aller Softwarebestandteile.", begruendung: "Mehrfach nachgefragt.", belege: 2 }] });

/** Nachgebaute KI: Antworten je Anfrage, die Auswertung erkennt sich an ihrem JSON-Muster */
async function kiNachbau(page: Page, antworten: string[]) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    const prompt = typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n");
    prompts.push(prompt);
    const text = /"vorschlaege": \[\{"art"/.test(prompt) ? VORSCHLAEGE : antworten[Math.min(prompts.filter((p) => !/"vorschlaege"/.test(p)).length - 1, antworten.length - 1)];
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

test("Chat: Daumen und Kommentar werden abgelegt, Antworten ohne Fundstelle vermerkt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await kiNachbau(page, [OHNE, MIT]);
  await page.goto("/app/cra-experte");
  const chat = page.locator(".o-chat");
  await chat.getByLabel("Frage", { exact: true }).fill("Welche Meldefrist gilt?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByText("Vermerkt: keine Fundstelle")).toBeVisible();
  await chat.getByLabel("Frage", { exact: true }).fill("Welche Pflichten haben Hersteller?");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByText("Herstellerpflichten")).toBeVisible();
  // Zweite Antwort: nicht hilfreich, mit Kommentar
  await chat.getByRole("button", { name: "Antwort war nicht hilfreich" }).last().click();
  await chat.getByLabel("Was war falsch oder hat gefehlt?").fill("Die Frist nach Art. 14 fehlt.");
  await chat.getByRole("button", { name: "Rückmeldung senden" }).click();
  await expect(page.getByText("Danke. Die Rückmeldung hilft")).toBeVisible();
  await expect(chat.getByText("Danke für die Rückmeldung")).toBeVisible();
  await page.screenshot({ path: `screenshots/${info.project.name}-lernen-chat.png` });
  const abgelegt = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-lernen:cra-experte") ?? "{}") as { rueckmeldungen: { bewertung: string; frage: string; kommentar: string }[] });
  expect(abgelegt.rueckmeldungen.map((r) => r.bewertung)).toEqual(["ohneQuelle", "schlecht"]);
  expect(abgelegt.rueckmeldungen[0].frage).toBe("Welche Meldefrist gilt?");
  expect(abgelegt.rueckmeldungen[1].kommentar).toBe("Die Frist nach Art. 14 fehlt.");
  expect(JSON.stringify(abgelegt)).not.toMatch(/nutzer|name|@/);
});

test("Baukasten: auswerten, Vorschlag freigeben, Hausregeln als Fassung mit Datum, Block in der Anfrage", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page, [MIT]);
  const jetzt = new Date().toISOString();
  const app = {
    id: "cra-lern", name: "CRA-Lernexperte", bereich: "Recht", status: "freigegeben", version: 1,
    steps: [{ id: "cra-s1", key: "experte", name: "CRA-Experte", rolle: "Du bist der CRA-Experte. Belegregel: nur aus den Unterlagen.", prompt: "Verlauf:\n{{verlauf}}\n\nFrage: {{frage}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Chat" }, children: [{ id: "c1", type: "chat", props: { titel: "CRA-Experte", quelle: "cra-s1", begruessung: "Frag mich.", platzhalter: "Frage …" } }] }],
  };
  await page.addInitScript(({ app, zeit }) => {
    localStorage.setItem("kihub-apps-v3", JSON.stringify([app]));
    localStorage.setItem("kihub-lernen:cra-lern", JSON.stringify({ rueckmeldungen: [
      { id: "r1", stepId: "cra-s1", zeit, bewertung: "schlecht", frage: "Was ist eine SBOM?", antwort: "…", kommentar: "Begriff nicht erklärt" },
      { id: "r2", stepId: "cra-s1", zeit, bewertung: "gut", frage: "Gilt der CRA für uns?", antwort: "…", kommentar: "" },
    ], vorschlaege: [], letzteAuswertung: {}, zusammenfassung: {} }));
  }, { app, zeit: jetzt });
  await page.goto("/baukasten/cra-lern");
  await page.getByRole("tab", { name: "Lernen" }).click();
  await expect(page.getByText("Nicht hilfreich")).toBeVisible();
  await expect(page.locator(".lern-zahlen").getByText("1", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Jetzt auswerten" }).click();
  await expect(page.getByText("SBOM (Software Bill of Materials)")).toBeVisible();
  expect(prompts.at(-1)).toContain("Rolle des Experten (fest, darf nicht geändert werden");
  expect(prompts.at(-1)).toContain("Begriff nicht erklärt");
  // Ändern, dann annehmen: wird neue Fassung der Hausregeln
  await page.screenshot({ path: `screenshots/${info.project.name}-lernen-baukasten.png`, fullPage: true });
  await page.getByRole("button", { name: "Ändern" }).click();
  await page.getByLabel("Vorschlag bearbeiten").fill("SBOM (Software Bill of Materials): Stückliste aller Softwarebestandteile; bei KSCA Teil jeder Lieferung.");
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByLabel("Hausregeln und Kontext (gelernt, freigegeben)")).toHaveValue(/- SBOM \(Software Bill of Materials\): Stückliste aller Softwarebestandteile; bei KSCA Teil jeder Lieferung\./);
  await page.getByRole("button", { name: /1 Fassung/ }).click();
  await expect(page.getByText(/Fassung 1 · \d{4}-\d{2}-\d{2} · Vorschlag \(Begriff\) aus der Auswertung angenommen · gilt/)).toBeVisible();
  // Vorschlag ist erledigt
  await expect(page.getByRole("button", { name: "Annehmen" })).toHaveCount(0);
  // Die Rolle blieb unverändert, der Block hängt in der Anfrage an der Rolle
  await page.getByRole("button", { name: /Export/ }).click();
  const json = JSON.parse(await page.locator("#json-text").inputValue()) as { steps: { rolle: string; hausregeln: { fassungen: { nr: number; text: string; grund: string }[] } }[] };
  expect(json.steps[0].rolle).toBe("Du bist der CRA-Experte. Belegregel: nur aus den Unterlagen.");
  expect(json.steps[0].hausregeln.fassungen).toHaveLength(1);
  expect(json.steps[0].hausregeln.fassungen[0].nr).toBe(1);
  const system = await page.evaluate(async (app) => {
    const rq = await import("/src/lib/request.ts");
    const s = await import("/src/lib/sanitize.ts");
    const a = s.loadApp(app)!;
    return rq.buildRequest(a, a.steps[0], {}).system;
  }, json);
  expect(system).toMatch(/Hausregeln und Kontext \(aus Rückmeldungen der Kolleginnen und Kollegen, freigegeben, Stand \d{4}-\d{2}-\d{2}\)/);
  expect(system.indexOf("Belegregel: nur aus den Unterlagen")).toBeLessThan(system.indexOf("Hausregeln und Kontext"));
  expect(system).toContain("bei KSCA Teil jeder Lieferung");
  // Hausregeln sind Kontext, kein Wissen: Sie stehen nach der Wissensgrenze und vor der Formatregel
  expect(system.indexOf("Wissensgrenze:")).toBeLessThan(system.indexOf("Hausregeln und Kontext"));
  expect(system.indexOf("Hausregeln und Kontext")).toBeLessThan(system.indexOf("Formatiere mit einfachem Markdown"));
  expect(system).toContain("Sie sind kein Wissen und keine Fundstelle");
});

test("Lernen: Erkennung ohne Fundstelle, Fassungen, Assistent lässt Hausregeln in Ruhe", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const l = await import("/src/lib/lernen.ts");
    const s = await import("/src/lib/sanitize.ts");
    const as = await import("/src/lib/assistant.ts");
    const app = s.loadApp({ id: "x", name: "X", blocks: [{ id: "p1", type: "seite", props: { titel: "C" }, children: [{ id: "c1", type: "chat", props: { titel: "E", quelle: "s1" } }] }], steps: [{ id: "s1", key: "e", name: "E", rolle: "Du bist Experte.", prompt: "{{frage}}", hausregeln: { fassungen: [{ nr: 1, datum: "2026-10-01", text: "- BA heißt Business Area.", grund: "Start" }] } }] })!;
    const st = l.hausregelnFassung(app.steps[0], "- BA heißt Business Area.\n- SBOM: Stückliste.", "Ergänzt");
    // Assistent liefert den Schritt neu (ohne Hausregeln): die freigegebenen bleiben
    const roh = as.ergaenzen({ blocks: "unveraendert", steps: [{ id: "s1", key: "e", name: "E", rolle: "Du bist Experte, per Du.", prompt: "{{frage}}" }] }, app);
    const neu = s.sanitizeApp(roh, app);
    return {
      ohne: ["Dazu habe ich in den Unterlagen nichts gefunden.", "In den Unterlagen steht dazu nichts.", "Das steht nicht in den hinterlegten Unterlagen.", "Keine passende Fundstelle vorhanden."].map(l.ohneQuelle),
      mit: ["Laut Art. 13 gilt …", "Die Frist beträgt 24 Stunden."].map(l.ohneQuelle),
      fassungen: st.hausregeln.fassungen.map((f) => [f.nr, f.text.length > 0, f.grund]),
      block: l.hausregelnBlock(st).split("\n")[0],
      sanitized: neu.steps[0].hausregeln.fassungen.length,
      bewahrt: as.bewahren(neu, app).steps[0].hausregeln.fassungen.length,
      rolleNeu: as.bewahren(neu, app).steps[0].rolle,
      prompt: l.auswertungsPrompt(app, app.steps[0], [l.rueckmeldungAnlegen({ stepId: "s1", bewertung: "schlecht", frage: "F", antwort: "A", kommentar: "K" })]),
      vorschlaege: l.vorschlaegeAus('Hier: {"zusammenfassung":"Z","vorschlaege":[{"art":"glossar","text":"T","begruendung":"B","belege":"3"},{"art":"quatsch","text":"U"},{"text":""}]} Ende', "s1").vorschlaege.map((v) => [v.art, v.text, v.belege, v.stand]),
    };
  });
  expect(r.ohne).toEqual([true, true, true, true]);
  expect(r.mit).toEqual([false, false]);
  expect(r.fassungen).toEqual([[1, true, "Start"], [2, true, "Ergänzt"]]);
  expect(r.block).toContain("Stand " + new Date().toISOString().slice(0, 10));
  expect(r.sanitized).toBe(0); // der neu gelieferte Schritt hat keine Hausregeln …
  expect(r.bewahrt).toBe(1); // … der Assistent setzt die freigegebenen aus der alten App zurück
  expect(r.rolleNeu).toBe("Du bist Experte, per Du."); // die Rolle darf er ändern
  expect(r.prompt).toContain("Antworte nur mit JSON");
  expect(r.prompt).toContain("Kommentar: K");
  expect(r.vorschlaege).toEqual([["glossar", "T", 3, "offen"], ["hausregel", "U", 0, "offen"]]);
});

test("Dienst: Rückmeldungen ablegen, auswerten, freigeben, von selbst neu auswerten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const appId = `lern-${Date.now()}`;
  const api = async (pfad: string, nutzer: string, init: RequestInit = {}) => fetch(`${DIENST}/api/lernen/${appId}${pfad}`, { ...init, headers: { Authorization: `Bearer test:${nutzer}`, "Content-Type": "application/json" } });
  const step = { id: "s1", key: "e", name: "Experte", rolle: "Du bist Experte.", prompt: "{{frage}}", hausregeln: { fassungen: [] } };
  for (let i = 0; i < 3; i++) expect((await api("/rueckmeldungen", "anna", { method: "POST", body: JSON.stringify({ stepId: "s1", bewertung: "schlecht", frage: `Was ist SBOM? ${i}`, antwort: "…", kommentar: "unklar" }) })).status).toBe(201);
  expect((await api("/rueckmeldungen", "anna", { method: "POST", body: JSON.stringify({ stepId: "s1", bewertung: "egal" }) })).status).toBe(500);
  const stand = (await (await api("/auswerten", "dario", { method: "POST", body: JSON.stringify({ stepId: "s1", step, appName: "Lern-App", intervallTage: 0 }) })).json()) as { vorschlaege: { id: string; art: string; text: string; stand: string }[]; letzteAuswertung: Record<string, string>; rueckmeldungen: unknown[] };
  expect(stand.vorschlaege.map((v) => v.art)).toEqual(["glossar", "faq", "quelle"]);
  expect(stand.vorschlaege[1]).toMatchObject({ frage: "Was ist eine SBOM?", herkunft: "auswertung" });
  expect(stand.vorschlaege[0].text).toContain("SBOM");
  expect(stand.rueckmeldungen).toHaveLength(3);
  const erste = stand.letzteAuswertung.s1;
  expect(erste).toBeTruthy();
  // Freigabe-Stand
  const nach = (await (await api(`/vorschlaege/${stand.vorschlaege[0].id}`, "dario", { method: "PUT", body: JSON.stringify({ stand: "angenommen" }) })).json()) as { vorschlaege: { stand: string }[] };
  expect(nach.vorschlaege.map((v) => v.stand)).toEqual(["angenommen", "offen", "offen"]);
  // Drei neue Rückmeldungen: der Dienst wertet von selbst erneut aus (Intervall 0 im Test), angenommene bleiben, offene werden ersetzt
  for (let i = 0; i < 3; i++) await api("/rueckmeldungen", "bernd", { method: "POST", body: JSON.stringify({ stepId: "s1", bewertung: "ohneQuelle", frage: `Meldefrist ${i}?`, antwort: "nichts gefunden", kommentar: "" }) });
  await expect.poll(async () => ((await (await api("", "dario")).json()) as { letzteAuswertung: Record<string, string> }).letzteAuswertung.s1, { timeout: 20_000 }).not.toBe(erste);
  const zuletzt = (await (await api("", "dario")).json()) as { vorschlaege: { stand: string }[] };
  expect(zuletzt.vorschlaege.map((v) => v.stand)).toEqual(["angenommen", "offen", "offen", "offen"]);
  expect((await fetch(`${DIENST}/api/lernen/${appId}`)).status).toBe(401);
});

test("Lernschicht: abgeschnittene Antwort behält die vollständigen Vorschläge, Diagnose ohne Inhalt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const l = await import("/src/lib/lernen.ts");
    // Copilot hört mitten im dritten Vorschlag auf; der zweite enthält ein Ablaufdiagramm als Codeblock in der Zeichenkette
    const abgeschnitten = '{"zusammenfassung":"Zwei Fragen kamen mehrfach.","vorschlaege":[{"art":"glossar","text":"PSSA = Product and Solution Security Advisor.","begruendung":"Abkürzung","belege":2},{"art":"faq","frage":"Wie läuft Threat Modeling?","antwort":"Ablauf:\n```mermaid\nflowchart TD\nC{Security Level 3?} --> D\n```\n[Rollenbeschreibung](https://x/r.pdf)","begruendung":"hilfreich","belege":1},{"art":"faq","frage":"Wer ist PSSO?","antwort":"Philipp Hen';
    const erg = l.vorschlaegeAus(abgeschnitten, "s1");
    return { arten: erg.vorschlaege.map((v) => v.art), zusammenfassung: erg.zusammenfassung, diagnose: l.jsonDiagnose(abgeschnitten), nichts: l.vorschlaegeBisAbbruch('{"vorschlaege":[{"art":"glossar","text":"abgebr') };
  });
  expect(r.arten).toEqual(["glossar", "faq"]);
  expect(r.zusammenfassung).toBe("Zwei Fragen kamen mehrfach.");
  expect(r.diagnose).toContain("endet mit „}“: nein");
  expect(r.diagnose).not.toContain("Philipp");
  expect(r.nichts).toBeNull();
});
