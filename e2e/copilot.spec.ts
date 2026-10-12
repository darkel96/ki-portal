import { test, expect } from "@playwright/test";
test("Copilot im KI-Menü einrichten", async ({ page }) => {
  await page.goto("/");
  await page.locator(".ki-pill").click();
  await expect(page.getByText("Mit Copilot testen")).toBeVisible();
  await page.getByText("Mit Copilot testen").click(); // Einrichtung ist eingeklappt
  await expect(page.getByText("/auth-redirect.html").first()).toBeVisible();
  await page.getByPlaceholder("Client-ID (Anwendungs-ID)").fill("nicht-gueltig");
  await page.getByPlaceholder("Tenant-ID (Verzeichnis-ID)").fill("firma.onmicrosoft.com");
  await page.getByRole("button", { name: "Copilot einrichten" }).click();
  await expect(page.getByText(/Client-ID ist eine GUID/)).toBeVisible();
  await page.getByPlaceholder("Client-ID (Anwendungs-ID)").fill("11111111-2222-3333-4444-555555555555");
  await page.getByRole("button", { name: "Copilot einrichten" }).click();
  await expect(page.locator(".ki-pill")).toContainText("Copilot");
  await expect(page.getByRole("button", { name: "Jetzt anmelden" })).toBeVisible();
  // Mit Copilot-Anbindung ist der Hub erst nach der Anmeldung nutzbar: das Anmeldetor erscheint (Testverbindung leitet nie von selbst weiter)
  await expect(page.getByRole("button", { name: "Mit Firmenkonto anmelden" })).toBeVisible();
  await page.getByText("Technische Angaben").click();
  await page.getByRole("button", { name: "Entfernen" }).click();
  await expect(page.locator(".ki-pill")).toContainText("KI-Simulation");
});
