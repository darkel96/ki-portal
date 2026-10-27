import { test, expect, type Page } from "@playwright/test";

/**
 * Git-Speicher über den Hub-Dienst: Niemand braucht einen GitHub-Token im Browser. Der Dienst schreibt mit seinem
 * Token (Testmodus: GitHub-Attrappe im Dienst) und prüft die Rechte wie der Hub.
 */
const DIENST = "http://localhost:8787";
const DATEI = "public/hub-daten";
const api = (pfad: string, nutzer: string, init: RequestInit = {}) => fetch(`${DIENST}/api${pfad}`, { ...init, headers: { Authorization: `Bearer test:${nutzer}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
const dateien = async () => (await (await fetch(`${DIENST}/attrappe/github-dateien`)).json()) as Record<string, { inhalt: Record<string, { name?: string; erstelltVon?: string }>; nachricht: string }>;
const setzen = (datei: string, inhalt: unknown) => fetch(`${DIENST}/attrappe/github-setzen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datei: `${DATEI}/${datei}`, inhalt }) });

async function hub(page: Page, nutzer: string, lokaleApps: unknown[] = []) {
  // Lesen ohne Token: die ausgelieferten Hub-Daten (auf dem Server frisch aus GitHub), hier aus der Attrappe
  await page.route("**/hub-daten/*.json", async (route) => {
    const datei = route.request().url().split("?")[0]!.split("/").pop()!;
    const r = await fetch(`${DIENST}/attrappe/github/repos/test/hub/contents/${DATEI}/${datei}`, { headers: { Authorization: "Bearer test-git", Accept: "application/vnd.github.raw" } });
    await route.fulfill({ status: r.status, headers: { "content-type": "application/json" }, body: r.ok ? await r.text() : "" });
  });
  await page.addInitScript(({ nutzer, lokaleApps }) => {
    localStorage.setItem("kihub-speicher", JSON.stringify({ git: { repo: "test/hub", branch: "main", pfad: "public/hub-daten" } }));
    localStorage.setItem("kihub-dienst-url", "http://localhost:8787");
    localStorage.setItem("kihub-dienst-nutzer", nutzer);
    localStorage.setItem("kihub-testnutzer", JSON.stringify({ id: `test-${nutzer}`, name: nutzer, email: `${nutzer}@test.local` }));
    if (lokaleApps.length && !sessionStorage.getItem("gesetzt")) { localStorage.setItem("kihub-apps-v3", JSON.stringify(lokaleApps)); sessionStorage.setItem("gesetzt", "1"); }
  }, { nutzer, lokaleApps });
}

test("Speichern ohne Token: der Dienst schreibt ins Repository, mit Rechteprüfung", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const bau = `bau${Date.now()}`, fremd = `fremd${Date.now()}`, ohne = `ohne${Date.now()}`;
  await setzen("rechte.json", { nutzer: [{ email: `${bau}@test.local`, rechte: ["bauen"] }, { email: `${fremd}@test.local`, rechte: ["bauen"] }], ausgeblendet: [] });
  expect(((await (await fetch(`${DIENST}/api/dienst`)).json()) as { hubDaten: boolean }).hubDaten).toBe(true);
  await hub(page, bau);
  await page.goto("/baukasten?kopie=protokoll");
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/„Meeting-Protokoll \(Kopie\)“ gespeichert, Version 1\./)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/nur in diesem Browser/)).toHaveCount(0);
  const apps = (await dateien())[`${DATEI}/apps.json`]!;
  const [id, app] = Object.entries(apps.inhalt).find(([, a]) => a.name === "Meeting-Protokoll (Kopie)")!;
  expect(app.erstelltVon).toBe(`${bau}@test.local`);
  expect(apps.nachricht).toContain(`(${bau}@test.local)`);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("kihub-apps-v3"))) || "[]")).toEqual([]);
  // Verwaltung nennt den Weg (die Seite selbst sieht nur die Verwaltung; hier reicht die Logik)
  expect(await page.evaluate(async () => (await import("/src/lib/speicher.ts")).speichertUeberDienst())).toBe(true);
  // Rechte: fremde App nicht ändern, ohne Baukasten-Recht nichts, Rechte nur die Verwaltung, kein fremder Besitzer
  const r1 = await api(`/hub-daten/apps/${id}.json`, fremd, { method: "PUT", body: JSON.stringify({ ...app, name: "Übernommen" }) });
  expect(r1.status).toBe(403);
  expect(((await r1.json()) as { fehler: string }).fehler).toContain("nicht ändern");
  expect((await api("/hub-daten/apps/neu1.json", ohne, { method: "PUT", body: JSON.stringify({ id: "neu1", name: "X" }) })).status).toBe(403);
  expect((await api("/hub-daten/rechte.json", bau, { method: "PUT", body: JSON.stringify({ nutzer: [], ausgeblendet: [] }) })).status).toBe(403);
  // Ausbruch aus dem Ordner: kodiertes „..“ wird abgewiesen (ein offenes „../“ kürzt schon die Adresse weg)
  expect((await api("/hub-daten/apps/%2E%2E%2F%2E%2E%2Fgeheim.json", bau, { method: "PUT", body: "{}" })).status).toBe(400);
  expect((await api("/hub-daten/apps/neu2.json", fremd, { method: "PUT", body: JSON.stringify({ id: "neu2", name: "Y", erstelltVon: `${bau}@test.local` }) })).status).toBe(200);
  expect((await dateien())[`${DATEI}/apps.json`]!.inhalt.neu2!.erstelltVon).toBe(`${fremd}@test.local`);
  // Löschen über den Dienst: App in den Papierkorb
  expect((await api(`/hub-daten/apps/${id}.json`, bau, { method: "DELETE" })).status).toBe(200);
  expect((await dateien())[`${DATEI}/apps.json`]!.inhalt[id]).toBeUndefined();
});

test("Apps, die nur im Browser lagen: Hinweis in der Übersicht, „Für alle speichern“ bringt sie ins Repository", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const bau = `alt${Date.now()}`;
  await setzen("rechte.json", { nutzer: [{ email: `${bau}@test.local`, rechte: ["bauen"] }], ausgeblendet: [] });
  const lokal = { id: `app-lokal-${Date.now()}`, name: "Themen-Briefing Test", bereich: "Allgemein", status: "entwurf", version: 2, steps: [], blocks: [{ id: "p1", type: "seite", props: { titel: "Start" }, children: [] }] };
  await hub(page, bau, [lokal]);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Themen-Briefing Test/ })).toBeVisible();
  await expect(page.getByText("„Themen-Briefing Test“ liegt nur in diesem Browser, andere sehen sie noch nicht.")).toBeVisible();
  await page.getByRole("button", { name: "Für alle speichern" }).click();
  await expect(page.getByText("„Themen-Briefing Test“ ist jetzt für alle gespeichert.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/liegt nur in diesem Browser/)).toHaveCount(0);
  expect((await dateien())[`${DATEI}/apps.json`]!.inhalt[lokal.id]!.name).toBe("Themen-Briefing Test");
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("kihub-apps-v3"))) || "[]")).toEqual([]);
  await expect(page.getByRole("link", { name: /Themen-Briefing Test/ })).toBeVisible();
});

test("Verwaltung sieht alle, die sich angemeldet haben (der Dienst vermerkt sie), auch aus anderen Browsern", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const chef = `chef${Date.now()}`, kollege = `kollege${Date.now()}`, ohne = `ohne${Date.now()}`;
  await setzen("rechte.json", { nutzer: [{ email: `${chef}@test.local`, rechte: ["admin"] }], ausgeblendet: [] });
  // Der Kollege öffnet den Hub in seinem eigenen Browser
  const k = await browser.newContext();
  const kp = await k.newPage();
  await hub(kp, kollege);
  await kp.goto("/");
  await expect.poll(async () => (await (await api("/personen", chef)).json() as { email: string }[]).some((p) => p.email === `${kollege}@test.local`), { timeout: 15_000 }).toBe(true);
  await k.close();
  // Ohne Verwaltung oder Baukasten keine Personenliste
  expect((await api("/personen", ohne)).status).toBe(403);
  // Die Verwaltung im anderen Browser zeigt ihn mit Datum, Nutzen gilt für alle
  const c = await browser.newContext();
  const cp = await c.newPage();
  await hub(cp, chef);
  await cp.goto("/verwaltung");
  const zeile = cp.getByRole("row").filter({ hasText: `${kollege}@test.local` });
  await expect(zeile).toBeVisible({ timeout: 15_000 });
  await expect(zeile).not.toContainText("noch nie");
  await expect(zeile.getByRole("checkbox", { name: /Applikationen nutzen/ })).toBeChecked();
  await expect(zeile.getByRole("checkbox", { name: /Baukasten/ })).not.toBeChecked();
  await c.close();
});
