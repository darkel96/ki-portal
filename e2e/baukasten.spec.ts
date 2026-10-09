import { test, expect, type Page, type Locator } from "@playwright/test";

/** Zieht mit echter Maus von a nach b (dnd-kit braucht mehrere Bewegungen). */
async function ziehen(page: Page, von: Locator, nach: Locator, oben: boolean | "unten" = false) {
  await nach.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
  const a = (await von.boundingBox())!;
  const b = (await nach.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
  const zy = oben === "unten" ? b.y + b.height - 12 : oben ? b.y + 6 : b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, zy, { steps: 14 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Liste der aktuell gezeigten Seite auf der Fläche */
const seitenListe = (page: Page) => page.locator(".stage .app-inner > .b-list");
const oben = (page: Page) => seitenListe(page).locator(":scope > .b");

test.describe("Baukasten", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "Ziehen und Ablegen wird auf Desktop geprüft; mobil gibt es Klick-zum-Hinzufügen");

  test("Spalten auf die Seite ziehen, Bausteine hinein und umsortieren", async ({ page }, info) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const n = await oben(page).count();
    await ziehen(page, page.getByRole("button", { name: "Spalten hinzufügen" }), seitenListe(page), "unten");
    await expect(oben(page)).toHaveCount(n + 1);

    const links = page.locator('[data-list$=":0"]').first();
    const rechts = page.locator('[data-list$=":1"]').first();
    await ziehen(page, page.getByRole("button", { name: "Auswahlliste hinzufügen" }), rechts);
    await expect(rechts.locator(':scope > .b[aria-label^="Auswahlliste"]')).toHaveCount(1);

    await ziehen(page, rechts.locator(":scope > .b").first(), links, true);
    await expect(links.locator(':scope > .b[aria-label^="Auswahlliste"]')).toHaveCount(1);
    await expect(rechts.locator(":scope > .b")).toHaveCount(0);

    // Ein Container darf nicht in sich selbst landen.
    const spalten = page.locator(".b:has(> .o-cols)").first();
    await ziehen(page, spalten.locator(".b-tag").first().locator(".."), rechts);
    await expect(oben(page)).toHaveCount(n + 1);
    await page.screenshot({ path: `screenshots/${info.project.name}-baukasten.png` });
  });

  test("Seiten: neue Seite anlegen und Baustein auf einen Seiten-Reiter ziehen", async ({ page }) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const reiter = page.getByRole("tab", { name: /Ergebnis/ }).filter({ has: page.locator(".s-no") });
    await expect(page.locator(".s-tab")).toHaveCount(2);
    const n = await oben(page).count();
    await ziehen(page, oben(page).first(), reiter);
    // Die Fläche wechselt auf Seite 2, dort liegt jetzt auch der verschobene Baustein.
    await expect(page.locator(".s-tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(oben(page)).toHaveCount(2);
    await page.locator(".s-tab").first().click();
    await expect(oben(page)).toHaveCount(n - 1);

    await page.getByRole("button", { name: "Seite" }).filter({ hasText: "Seite" }).last().click();
    await expect(page.locator(".s-tab")).toHaveCount(3);
    await expect(page.locator(".s-tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Titel der Seite")).toBeVisible();
  });

  test("Rückgängig nach dem Löschen", async ({ page }) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    const n = await oben(page).count();
    await oben(page).first().click();
    await page.getByRole("button", { name: "Löschen" }).first().click();
    await expect(oben(page)).toHaveCount(n - 1);
    await page.getByRole("button", { name: "Rückgängig (Strg+Z)" }).click();
    await expect(oben(page)).toHaveCount(n);
  });

  test("KI-Ablauf: Agenten-Team anlegen", async ({ page }, info) => {
    await page.goto("/baukasten");
    await oben(page).first().waitFor();
    await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
    await page.getByRole("button", { name: "Agenten-Team" }).last().click();
    await expect(page.getByRole("region", { name: /Schritt 2: Agenten-Team/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Agenten/ }).click();
    await expect(page.getByLabel("Name von Agent 1")).toHaveValue("Planer");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `screenshots/${info.project.name}-ki-ablauf.png` });
  });
});

test("Baukasten mobil: Baustein per Klick hinzufügen", async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 800, "nur mobil");
  await page.goto("/baukasten");
  await oben(page).first().waitFor();
  const n = await page.locator(".b").count();
  await page.getByRole("button", { name: "Bausteine", exact: true }).click();
  await page.getByRole("button", { name: "Hinweis hinzufügen" }).click();
  // Nach dem Hinzufügen zeigt der Baukasten wieder die Fläche.
  await expect(seitenListe(page)).toBeVisible();
  await expect(page.locator(".b")).toHaveCount(n + 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `screenshots/${info.project.name}-baukasten.png` });
});
