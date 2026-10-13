import { test, expect } from "@playwright/test";
test("Wissen der App: Modus, Bibliothek, Schritt-Modus", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/baukasten");
  await expect(page.getByRole("heading", { name: "Applikation", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Wissen" }).click();
  await expect(page.getByRole("combobox", { name: "Womit die KI arbeiten darf" })).toContainText("Nur Eingaben");
  await page.getByLabel("Aus der Wissensbibliothek übernehmen").selectOption({ index: 1 });
  await expect(page.getByLabel("Adresse der Quelle")).toHaveValue(/sharepoint\.com/);
  await page.screenshot({ path: "screenshots/desktop-wissen.png" });
  // Schritt: Wissensmodus „Wie die App“
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: "Wissen" }).click();
  await expect(page.getByRole("combobox", { name: "Wissensmodus" })).toContainText("Wie die App");
});
