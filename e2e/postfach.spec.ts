import { test, expect } from "@playwright/test";

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
  await expect(post.getByText("Beispielpostfach (ohne Copilot-Anbindung)")).toBeVisible();
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
