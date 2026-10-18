import { test, expect, type Page } from "@playwright/test";

/** Git-Speicher: Sammlungen als JSON im Repository; mit Token über die GitHub-API, ohne Token von der veröffentlichten Seite */
const REPO = "darkel96/ki-portal", PFAD = "public/hub-daten";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Nachbau der GitHub-Contents-API mit Dateien im Speicher (Sha zählt hoch) und der veröffentlichten Dateien */
async function githubNachbau(page: Page, dateien: Record<string, unknown> = {}) {
  const ablage = new Map<string, { inhalt: string; sha: number }>();
  for (const [k, v] of Object.entries(dateien)) ablage.set(k, { inhalt: JSON.stringify(v), sha: 1 });
  const commits: { datei: string; nachricht: string; inhalt: unknown }[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    const m = new RegExp(`^/repos/${REPO}/contents/${PFAD}/([^?]+)`).exec(url.pathname);
    if (!m) { await route.fulfill({ status: 404, json: { message: "Not Found" } }); return; }
    const datei = m[1];
    // Token ohne Schreibrecht: GitHub lehnt jeden Schreibversuch ab
    if (route.request().method() === "PUT" && !route.request().headers()["authorization"]?.includes("ghp_gut")) { await route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } }); return; }
    if (route.request().method() === "GET") {
      const d = ablage.get(datei);
      if (!d) { await route.fulfill({ status: 404, json: { message: "Not Found" } }); return; }
      await route.fulfill({ json: { content: b64(d.inhalt), sha: `sha${d.sha}`, encoding: "base64" } });
      return;
    }
    const body = route.request().postDataJSON() as { message: string; content: string; sha?: string; branch: string };
    const d = ablage.get(datei);
    if (d && body.sha !== `sha${d.sha}`) { await route.fulfill({ status: 409, json: { message: "Conflict" } }); return; }
    const inhalt = Buffer.from(body.content, "base64").toString("utf8");
    ablage.set(datei, { inhalt, sha: (d?.sha ?? 0) + 1 });
    commits.push({ datei, nachricht: body.message, inhalt: JSON.parse(inhalt) });
    await route.fulfill({ json: { content: { sha: `sha${(d?.sha ?? 0) + 1}` } } });
  });
  // Veröffentlichte Seite: /hub-daten/<datei>
  await page.route("**/hub-daten/*.json", async (route) => {
    if (new URL(route.request().url()).hostname === "api.github.com") { await route.fallback(); return; }
    const datei = route.request().url().split("/").pop()!;
    const d = ablage.get(datei);
    if (!d) { await route.fulfill({ status: 404, body: "" }); return; }
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: d.inhalt });
  });
  return { ablage, commits };
}

test("Git-Speicher: mit Token schreibt Speichern ins Repository, Agenten und Papierkorb inklusive", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const { commits, ablage } = await githubNachbau(page);
  await page.addInitScript(({ repo, pfad }) => {
    localStorage.setItem("kihub-speicher", JSON.stringify({ git: { repo, branch: "main", pfad } }));
    localStorage.setItem("kihub-github-token", "ghp_gut");
  }, { repo: REPO, pfad: PFAD });
  // Verwaltung: Prüfung meldet Lesen und Schreiben
  await page.goto("/verwaltung");
  await expect(page.getByText(/Dieser Browser nutzt den Git-Speicher/)).toBeVisible();
  await page.getByRole("button", { name: "Git prüfen" }).click();
  await expect(page.getByText(/Lesen ✓ · Schreiben ✓/)).toBeVisible();
  expect(commits.some((c) => c.datei === "verbindungstest.json")).toBe(true);
  // Token ohne Schreibrecht: Prüfung meldet die Ursache mit dem Text von GitHub
  await page.getByLabel("GitHub-Token").fill("ghp_nur_lesen");
  await page.getByRole("button", { name: "Git prüfen" }).click();
  await expect(page.getByText(/Lesen ✓ · Schreiben ✗ .*Contents: Read and write.*Resource not accessible by personal access token/)).toBeVisible();
  await page.getByLabel("GitHub-Token").fill("ghp_gut");
  // App speichern → Commit in apps.json
  await page.goto("/baukasten?kopie=protokoll");
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  expect(commits.some((c) => c.datei === "apps.json" && /Hub-Daten: apps\//.test(c.nachricht))).toBe(true);
  const apps = JSON.parse(ablage.get("apps.json")!.inhalt) as Record<string, { name: string }>;
  expect(Object.values(apps).map((a) => a.name)).toContain("Meeting-Protokoll (Kopie)");
  // Agent speichern → agenten.json
  await page.goto("/agenten");
  await page.getByRole("button", { name: "Neuer Agent" }).click();
  await page.getByLabel("Name").fill("Git-Prüfer");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/gespeichert\. Agenten-Teams/)).toBeVisible();
  expect(Object.values(JSON.parse(ablage.get("agenten.json")!.inhalt) as Record<string, { name: string }>).map((a) => a.name)).toContain("Git-Prüfer");
  // Löschen → Papierkorb im Repository, App aus apps.json raus
  const id = Object.keys(apps)[0];
  await page.goto(`/app/${id}`);
  await page.getByRole("button", { name: "Verwalten" }).click();
  await page.getByRole("menuitem", { name: "Löschen" }).click();
  await page.getByRole("button", { name: "Löschen" }).last().click();
  await expect(page.getByText(/gelöscht\./)).toBeVisible();
  expect(Object.keys(JSON.parse(ablage.get("apps.json")!.inhalt) as object)).not.toContain(id);
  expect(Object.keys(JSON.parse(ablage.get("papierkorb.json")!.inhalt) as object)).toContain(id);
  expect(await page.evaluate(() => localStorage.getItem("kihub-apps-v3"))).toBeNull();
});

test("Git-Speicher ohne Token: gemeinsame Apps von der veröffentlichten Seite, eigene Änderungen bleiben im Browser", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const gemeinsam = { "git-app": { id: "git-app", name: "Gemeinsame Git-App", bereich: "Allgemein", status: "freigegeben", version: 3, steps: [], blocks: [{ id: "p1", type: "seite", props: { titel: "Start" }, children: [] }] } };
  const { commits } = await githubNachbau(page, { "apps.json": gemeinsam });
  await page.addInitScript(({ repo, pfad }) => localStorage.setItem("kihub-speicher", JSON.stringify({ git: { repo, branch: "main", pfad } })), { repo: REPO, pfad: PFAD });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Gemeinsame Git-App/ })).toBeVisible();
  await page.goto("/verwaltung");
  await expect(page.getByText(/zum Schreiben braucht dieser Browser einen GitHub-Token/)).toBeVisible();
  await page.getByRole("button", { name: "Git prüfen" }).click();
  await expect(page.getByText(/Lesen ✓ · Schreiben ✗/)).toBeVisible();
  // Eigene App speichern: bleibt im Browser, kein Commit
  await page.goto("/baukasten?kopie=protokoll");
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  expect(commits).toHaveLength(0);
  const lokal = JSON.parse((await page.evaluate(() => localStorage.getItem("kihub-apps-v3"))) || "[]") as { name: string }[];
  expect(lokal.map((a) => a.name)).toContain("Meeting-Protokoll (Kopie)");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Gemeinsame Git-App/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Meeting-Protokoll \(Kopie\)/ })).toBeVisible();
});
