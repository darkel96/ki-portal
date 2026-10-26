import { test, expect } from "@playwright/test";

/** Ergebnis-Karte eines Laufs im Hub-Dienst: Hinweis nicht von der Leiste „Alle Ergebnisse“ verdeckt, lange Zeilen in den technischen Details sprengen die Karte nicht */
const LANG = "Kennung" + "x".repeat(400);
const APP = {
  id: "dar-app", name: "Darstellung", bereich: "Test", status: "freigegeben", version: 1,
  steps: [
    { id: "s1", key: "eins", name: "Erster Schritt", prompt: `Schreib zu {{thema}} ${LANG}` },
    { id: "s2", key: "zwei", name: "Zweiter Schritt", prompt: "Fasse zusammen: {{eins}}" },
  ],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Angaben" }, children: [{ id: "f1", type: "input", props: { key: "thema", label: "Thema", pflicht: true } }] },
    { id: "p2", type: "seite", props: { titel: "Ergebnis 1" }, children: [{ id: "o1", type: "output", props: { titel: "Erster Schritt", quelle: "s1" } }] },
    { id: "p3", type: "seite", props: { titel: "Ergebnis 2" }, children: [{ id: "o2", type: "output", props: { titel: "Zweiter Schritt", quelle: "s2" } }] },
  ],
};
test("Lauf im Dienst: Hinweis frei, technische Details bleiben in der Karte", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript((app) => {
    localStorage.setItem("kihub-apps-v3", JSON.stringify([app]));
    localStorage.setItem("kihub-dienst-url", "http://localhost:8787");
    localStorage.setItem("kihub-dienst-nutzer", `dar${Date.now()}`);
  }, APP);
  await page.goto("/app/dar-app");
  await page.getByLabel("Thema").fill("Leergut");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /erstellen/i }).click();
  await expect(page.getByText("Läuft im Hub-Dienst weiter")).toBeVisible();
  await page.locator(".e-kachel").first().click();
  const hinweis = await page.locator(".o-hintergrund").isVisible();   // Die Attrappe ist schnell; ist der Lauf schon fertig, fehlt der Hinweis
  await page.getByText("Technische Details").first().click();
  const m = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const hint = document.querySelector(".o-hintergrund")?.getBoundingClientRect() ?? { top: Infinity }, zur = r(".e-zurueck"), card = r(".o-out"), pre = document.querySelector(".o-out pre.code")!.getBoundingClientRect();
    const inner = document.querySelector(".app-inner") as HTMLElement;
    return { hintOben: hint.top, zurUnten: zur.bottom, cardRechts: card.right, preRechts: pre.right, quer: inner.scrollWidth - inner.clientWidth };
  });
  if (hinweis) expect(m.hintOben).toBeGreaterThanOrEqual(m.zurUnten);
  expect(m.preRechts).toBeLessThanOrEqual(m.cardRechts);
  expect(m.quer).toBeLessThanOrEqual(0);
});
