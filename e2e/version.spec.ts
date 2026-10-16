import { test, expect } from "@playwright/test";

test("Neue Version: fehlendes Programmteil führt zu einmaligem Neuladen statt Fehlerseite", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Wie nach einem Deployment: das Programmteil des Baukastens gibt es nicht mehr
  let anfragen = 0;
  await page.route(/BuilderPage[^/]*\.(tsx|js)/, (r) => (++anfragen === 1 ? r.abort() : r.continue()));
  const neu = page.waitForEvent("load");
  await page.getByRole("link", { name: "Baukasten" }).click();
  await neu;
  expect(anfragen).toBeGreaterThanOrEqual(1);
  // Nach dem Neuladen ist die neue Version da und der Baukasten offen
  await expect(page.getByLabel("Name der Applikation")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Diese Seite konnte nicht angezeigt werden.")).toHaveCount(0);
  const r = await page.evaluate(async () => {
    const v = await import("/src/lib/neueVersion.ts");
    return [v.istVersionsFehler(new TypeError("Failed to fetch dynamically imported module: https://x/assets/BuilderPage-DDyatPpI.js")), v.istVersionsFehler(new Error("x is undefined"))];
  });
  expect(r).toEqual([true, false]);
});
