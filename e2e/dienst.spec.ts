import { test, expect, type Page } from "@playwright/test";

/**
 * Hub-Dienst (server/) im Testmodus: Läufe und Aufträge laufen dort weiter, auch wenn kein Tab mehr offen ist.
 * Der Dienst startet über die Playwright-Konfiguration auf Port 8787 mit der Copilot-Attrappe.
 */
const DIENST = "http://localhost:8787";
const APP = {
  id: "dienst-app", name: "Hintergrund-Test", bereich: "Test", status: "freigegeben", version: 1,
  steps: [
    { id: "s1", key: "eins", name: "Erster Schritt", prompt: "Schreib zu {{thema}}" },
    { id: "s2", key: "zwei", name: "Zweiter Schritt", prompt: "Fasse zusammen: {{eins}}" },
  ],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Angaben" }, children: [{ id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } }] },
    { id: "p2", type: "seite", props: { titel: "Ergebnis 1" }, children: [{ id: "o1", type: "output", props: { titel: "Erster Schritt", quelle: "s1" } }] },
    { id: "p3", type: "seite", props: { titel: "Ergebnis 2" }, children: [{ id: "o2", type: "output", props: { titel: "Zweiter Schritt", quelle: "s2" } }] },
  ],
};
const api = async (pfad: string, nutzer: string, init: RequestInit = {}) => fetch(`${DIENST}/api${pfad}`, { ...init, headers: { Authorization: `Bearer test:${nutzer}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

async function hubMitDienst(page: Page, nutzer: string, meinHub?: unknown) {
  await page.context().addInitScript(({ app, nutzer, meinHub }) => {
    localStorage.setItem("kihub-apps-v3", JSON.stringify([app]));
    localStorage.setItem("kihub-dienst-url", "http://localhost:8787");
    localStorage.setItem("kihub-dienst-nutzer", nutzer);
    if (meinHub) localStorage.setItem("kihub-meinhub-v1:lokal", JSON.stringify(meinHub));
  }, { app: APP, nutzer, meinHub });
}

test("Lauf geht im Hub-Dienst weiter, wenn der Tab geschlossen wird", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const nutzer = `tab${Date.now()}`;
  await hubMitDienst(page, nutzer);
  await page.goto("/app/dienst-app");
  await page.getByLabel("Thema").fill("Leergutlager");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /erstellen/i }).click();
  await expect(page.getByText("Läuft im Hub-Dienst weiter")).toBeVisible();
  // Tab zu, während der Dienst noch arbeitet
  await page.close();
  const liste = await (await api("/laeufe?app=dienst-app", nutzer)).json() as { id: string; status: string }[];
  expect(liste).toHaveLength(1);
  // Der Dienst macht fertig, auch ohne Tab
  await expect.poll(async () => ((await (await api(`/laeufe/${liste[0].id}`, nutzer)).json()) as { status: string }).status, { timeout: 30_000 }).toBe("fertig");
  const lauf = (await (await api(`/laeufe/${liste[0].id}`, nutzer)).json()) as { outs: Record<string, { status: string; text?: string }>; gesehen: boolean };
  expect(lauf.outs.s2.text).toContain("Ergebnis der Attrappe");
  expect(lauf.gesehen).toBe(false);
  // Neuer Tab: die App zeigt den fertigen Lauf samt Eingaben
  const seite = await context.newPage();
  await seite.goto("/app/dienst-app");
  await expect(seite.getByText("im Hintergrund fertig geworden")).toBeVisible({ timeout: 15_000 });
  await expect(seite.locator(".e-kachel").first()).toContainText("Fertig");
  await seite.locator(".e-kachel").first().click();
  await expect(seite.locator(".o-out")).toContainText("Ergebnis der Attrappe");
  await seite.getByRole("button", { name: "Alle Ergebnisse" }).click();
  await seite.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Zurück/ }).click();
  await expect(seite.getByLabel("Thema")).toHaveValue("Leergutlager");
  await expect.poll(async () => ((await (await api(`/laeufe/${liste[0].id}`, nutzer)).json()) as { gesehen: boolean }).gesehen).toBe(true);
  // Beim nächsten Öffnen nichts mehr davon
  await seite.reload();
  await expect(seite.getByLabel("Thema")).toHaveValue("");
});

test("Auftrag nach Zeitplan läuft im Dienst und geht per E-Mail raus", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const nutzer = `plan${Date.now()}`;
  const jetzt = new Date().toISOString();
  await hubMitDienst(page, nutzer, {
    v: 1, nutzer: "lokal", pins: [{ appId: "dienst-app", seit: jetzt }], laeufe: [], automatisch: true,
    voreinstellungen: [{ id: "v1", appId: "dienst-app", name: "Standard", werte: { thema: "Wochenbericht Lager" }, dateien: {}, erstellt: jetzt, geaendert: jetzt }],
    // Termin schon verstrichen (der Hub war zu): läuft einmal nach
    auftraege: [{ id: "a1", name: "Wochenbericht", appId: "dienst-app", voreinstellungId: "v1", zeitplan: { art: "taeglich", uhrzeit: "07:00", wochentag: 1, tag: 1 }, ziel: { art: "email", adresse: "" }, aktiv: true, naechsterLauf: new Date(Date.now() - 60_000).toISOString(), letzterLauf: "", erstellt: jetzt }],
  });
  await page.goto("/mein");
  await expect(page.getByText("Aufträge laufen im Hub-Dienst")).toBeVisible();
  // Der Hub übergibt den Auftrag an den Dienst …
  await expect.poll(async () => ((await (await api("/auftraege", nutzer)).json()) as { auftraege: unknown[] }).auftraege.length, { timeout: 15_000 }).toBe(1);
  // … der Dienst holt den verpassten Termin nach und setzt den nächsten in die Zukunft
  await expect.poll(async () => ((await (await api("/laeufe?auftraege=1", nutzer)).json()) as { status: string }[]).map((l) => l.status).join(), { timeout: 30_000 }).toBe("fertig");
  const stand = (await (await api("/auftraege", nutzer)).json()) as { auftraege: { naechsterLauf: string; letzterLauf: string }[] };
  expect(Date.parse(stand.auftraege[0].naechsterLauf)).toBeGreaterThan(Date.now());
  expect(stand.auftraege[0].letzterLauf).not.toBe("");
  // Der Verlauf in Mein Hub zeigt das Ergebnis, ohne dass der Browser gerechnet hat
  await expect(page.getByRole("tab", { name: /Verlauf \(1\)/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /Verlauf/ }).click();
  await page.getByText("Wochenbericht", { exact: true }).first().click();
  await expect(page.locator(".mh-detail")).toContainText("Ergebnis der Attrappe");
  // E-Mail über Graph (die Attrappe protokolliert sie)
  await expect.poll(async () => {
    const post = (await (await fetch(`${DIENST}/attrappe/post`)).json()) as { nachricht: { message: { subject: string; toRecipients: { emailAddress: { address: string } }[] } } }[];
    return post.some((p) => p.nachricht.message.subject === "KI-Hub: Wochenbericht" && p.nachricht.message.toRecipients[0].emailAddress.address === `${nutzer}@test.local`);
  }, { timeout: 15_000 }).toBe(true);
  // Ohne Dienst wäre der Auftrag im Browser gelaufen: der zweite Lauf darf nicht doppelt sein
  const laeufe = (await (await api("/laeufe?auftraege=1", nutzer)).json()) as unknown[];
  expect(laeufe).toHaveLength(1);
});

test("Dienst: ohne Anmeldung nichts, fremde Läufe unsichtbar", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const info_ = (await (await fetch(`${DIENST}/api/dienst`)).json()) as { dienst: string; testmodus: boolean };
  expect(info_).toMatchObject({ dienst: "KI-Hub", testmodus: true });
  expect((await fetch(`${DIENST}/api/laeufe`)).status).toBe(401);
  expect((await fetch(`${DIENST}/api/laeufe`, { headers: { Authorization: "Bearer kein-test-token" } })).status).toBe(401);
  const r = await api("/laeufe", "anna", { method: "POST", body: JSON.stringify({ app: APP, aktion: "alle", werte: { thema: "x" }, files: {}, ergebnisse: {}, titel: "Annas Lauf" }) });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  expect((await api(`/laeufe/${id}`, "bernd")).status).toBe(404);
  expect((await api(`/laeufe/${id}`, "anna")).status).toBe(200);
  // Ungültige App wird abgewiesen
  expect((await api("/laeufe", "anna", { method: "POST", body: JSON.stringify({ app: { kaputt: true }, aktion: "alle" }) })).status).toBe(500);
});

test("Jetzt ausführen im Dienst: Meldung beim Start und wenn der Auftrag fertig ist", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const nutzer = `jetzt${Date.now()}`;
  const jetzt = new Date().toISOString();
  await hubMitDienst(page, nutzer, {
    v: 1, nutzer: "lokal", pins: [{ appId: "dienst-app", seit: jetzt }], laeufe: [], automatisch: true,
    voreinstellungen: [{ id: "v1", appId: "dienst-app", name: "Standard", werte: { thema: "Inventur" }, dateien: {}, erstellt: jetzt, geaendert: jetzt }],
    // Termin in der Zukunft: läuft nur über „Jetzt ausführen“
    auftraege: [{ id: "a1", name: "Inventurbericht", appId: "dienst-app", voreinstellungId: "v1", zeitplan: { art: "woechentlich", uhrzeit: "07:00", wochentag: 1, tag: 1 }, ziel: { art: "hub", adresse: "" }, aktiv: true, naechsterLauf: "2099-01-05T06:00:00.000Z", letzterLauf: "", erstellt: jetzt }],
  });
  await page.goto("/mein");
  await page.getByRole("tab", { name: /Aufträge/ }).click();
  await page.getByRole("button", { name: "Jetzt ausführen" }).click();
  await expect(page.getByText("Auftrag „Inventurbericht“ läuft im Hub-Dienst.", { exact: false })).toBeVisible();
  // Früher kam diese Meldung nur, wenn der Browser den Auftrag selbst ausführte
  await expect(page.getByText("Auftrag „Inventurbericht“ ist fertig.", { exact: false })).toBeVisible({ timeout: 30_000 });
  // Der Auftrag bleibt in der Liste
  await expect(page.locator(".mh-karte")).toContainText("Inventurbericht");
});
