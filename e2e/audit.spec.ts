import { test, type Page } from "@playwright/test";

/**
 * Screenshot-Audit: fotografiert alle Seiten und Zustände in Desktop- und Handy-Ansicht nach screenshots/audit/.
 * Läuft nur auf Wunsch: AUDIT=1 npx playwright test e2e/audit.spec.ts
 */
test.skip(!process.env.AUDIT, "nur mit AUDIT=1");

async function shot(page: Page, name: string, p: string, full = false) {
  try { await page.screenshot({ path: `screenshots/audit/${p}-${name}.png`, fullPage: full }); } catch (e) { console.log("shot failed", name, e); }
}
const klick = async (page: Page, f: () => Promise<void>) => { try { await f(); await page.waitForTimeout(400); } catch (e) { console.log("klick failed", String(e).slice(0, 160)); } };
const T = { timeout: 4000 };

test("audit", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  await page.goto("/"); await page.waitForTimeout(600);
  await shot(page, "01-hub", p, true);
  await klick(page, () => page.locator(".ki-pill").click(T)); await shot(page, "02-kimenue", p); await page.keyboard.press("Escape");
  for (const id of ["serviceangebot", "cra-experte", "protokoll", "agenten-team", "angebotsvergleich"]) {
    await page.goto(`/app/${id}`); await page.waitForTimeout(600); await shot(page, `03-app-${id}`, p, true);
  }
  // Serviceangebot: Seite 2, 3
  await page.goto("/app/serviceangebot"); await page.waitForTimeout(500);
  await klick(page, () => page.getByRole("button", { name: "Details" }).click(T)); await shot(page, "04-app-details", p, true);
  await page.goto("/mein"); await page.waitForTimeout(600); await shot(page, "05-mein-apps", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Aufträge/ }).click(T)); await shot(page, "05-mein-auftraege", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Verlauf/ }).click(T)); await shot(page, "05-mein-verlauf", p, true);
  await page.goto("/neu"); await page.waitForTimeout(600); await shot(page, "06-neu", p, true);
  await page.goto("/baukasten?kopie=serviceangebot"); await page.waitForTimeout(800); await shot(page, "07-bk-oberflaeche", p);
  await klick(page, () => page.locator(".b[data-bid]").nth(1).click(T));
  await shot(page, "07-bk-block-gewaehlt", p);
  await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T)); await shot(page, "08-bk-ki", p);
  await klick(page, () => page.getByRole("tab", { name: "Wissen" }).first().click(T)); await shot(page, "08-bk-ki-wissen", p);
  await klick(page, () => page.getByRole("tab", { name: "Technische Vorschau" }).click(T)); await shot(page, "08-bk-ki-vorschau", p);
  await klick(page, () => page.getByRole("tab", { name: "Oberfläche" }).click(T));
  await klick(page, () => page.getByRole("button", { name: /Vorschau testen|Vorschau/ }).first().click(T)); await shot(page, "09-bk-vorschau", p);
  await klick(page, () => page.getByRole("button", { name: /Vorschau beenden|Zurück/ }).first().click(T));
  for (const t of ["Gestaltung", "Wissen", "Freigabe", "App"]) {
    await klick(page, () => page.getByRole("tab", { name: t, exact: true }).first().click(T)); await shot(page, `10-bk-app-${t}`, p);
  }
  await klick(page, () => page.getByRole("button", { name: /Export/ }).click(T)); await shot(page, "11-bk-export", p); await page.keyboard.press("Escape");
  await klick(page, () => page.getByRole("link", { name: "Applikationen" }).click(T)); await shot(page, "12-bk-verwerfen", p); await page.keyboard.press("Escape");
  await page.goto("/gibtsnicht"); await page.waitForTimeout(400); await shot(page, "13-404", p);
});

test("audit2", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  // Ergebnisse (Simulation): Meeting-Protokoll
  const menue = async (name: RegExp) => {
    if (p === "mobil") { await klick(page, () => page.getByRole("button", { name: "Weitere Aktionen" }).click(T)); await klick(page, () => page.getByRole("menuitem", { name }).click(T)); }
    else await klick(page, () => page.getByRole("button", { name }).first().click(T));
  };
  await page.goto("/app/protokoll"); await page.waitForTimeout(500);
  await menue(/Beispieldaten einsetzen/);
  await klick(page, () => page.getByRole("button", { name: /Ergebnisse erstellen|Erstellen/ }).first().click(T));
  await page.waitForTimeout(800); await shot(page, "20-ergebnis-uebersicht", p, true);
  await klick(page, () => page.getByText("Öffnen", { exact: true }).first().click(T));
  await page.waitForTimeout(500); await shot(page, "21-ergebnis-detail", p, true);
  // Mein Hub mit Inhalt
  await page.goto("/app/angebot"); await page.waitForTimeout(500);
  await menue(/Zu Mein Hub/);
  await page.goto("/app/protokoll"); await page.waitForTimeout(400);
  await menue(/Zu Mein Hub/);
  await page.goto("/mein"); await page.waitForTimeout(600); await shot(page, "22-mein-mit-inhalt", p, true);
  await klick(page, () => page.getByRole("tab", { name: /Verlauf/ }).click(T)); await shot(page, "22-mein-verlauf-inhalt", p, true);
  // Baukasten: Feld gewählt, App-Einstellungen, Panels auf dem Handy
  await page.goto("/baukasten?kopie=protokoll"); await page.waitForTimeout(800);
  if (p === "mobil") {
    await klick(page, () => page.getByRole("button", { name: "Bausteine" }).click(T)); await shot(page, "23-bk-bausteine", p);
    await klick(page, () => page.getByRole("button", { name: "Fläche" }).click(T));
  }
  await klick(page, () => page.locator(".b[data-bid]").filter({ hasText: "Besprechungsnotizen" }).first().click(T));
  if (p === "mobil") await klick(page, () => page.getByRole("button", { name: "Eigenschaften" }).click(T));
  await shot(page, "24-bk-feld", p, p === "mobil");
  await klick(page, () => page.getByRole("button", { name: "App-Einstellungen" }).click(T));
  for (const t of ["Gestaltung", "Wissen", "Freigabe"]) {
    await klick(page, () => page.getByRole("tab", { name: t, exact: true }).first().click(T)); await shot(page, `25-bk-app-${t}`, p, p === "mobil");
  }
  if (p === "mobil") {
    await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T));
    await klick(page, () => page.getByRole("button", { name: /Prüfung und Vorschau/ }).click(T)); await shot(page, "26-bk-ki-pruefung", p, true);
  }
});

/** Nachgebaute KI für den Chat (fester Text mit Quelle) */
async function kiNachbau(page: Page) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const text = "Laut **Art. 13** gelten die Herstellerpflichten ab dem 11. Dezember 2027.\n\nQuelle: [Verordnungstext, Art. 13](https://firma.sharepoint.com/sites/cra/Verordnung.pdf)";
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
}

const POST_APP = {
  id: "post-app", name: "Mein Postfach", bereich: "Allgemein", status: "freigegeben", version: 1, steps: [],
  blocks: [{ id: "p1", type: "seite", props: { titel: "Postfach" }, children: [
    { id: "h1", type: "heading", props: { text: "Postfach", level: 1, align: "left", color: "" } },
    { id: "pf", type: "postfach", props: { titel: "Posteingang und Ordner", anzahl: 25, vorschau: true, prozeduren: [{ name: "CRA ablegen", thema: "CRA", tage: 30, zielordner: "CRA-Ablage", ki: true }] } },
  ] }],
};

test("audit3", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  await kiNachbau(page);
  // Chat mit Antwort und Quelle
  await page.goto("/app/cra-experte"); await page.waitForTimeout(500);
  const chat = page.locator(".o-chat");
  await klick(page, () => chat.getByLabel("Frage", { exact: true }).fill("Welche Pflichten gelten für Hersteller?"));
  await klick(page, () => chat.getByLabel("Frage", { exact: true }).press("Enter"));
  await page.waitForTimeout(2500); await shot(page, "30-chat-antwort", p, true);
  await klick(page, () => page.getByRole("button", { name: /Was die KI bekommen hat/ }).first().click(T)); await shot(page, "30-chat-diagnose", p, true);
  // Agenten
  await page.goto("/agenten"); await page.waitForTimeout(600); await shot(page, "31-agenten", p, true);
  await klick(page, () => page.getByRole("button", { name: /Neuer Agent/ }).first().click(T)); await shot(page, "31-agenten-neu", p, true);
  // Verwaltung
  await page.goto("/verwaltung"); await page.waitForTimeout(800); await shot(page, "32-verwaltung", p, true);
  // Baukasten: Lernen, Agenten-Team, KI-Schritt Prompt
  await page.goto("/baukasten/cra-experte"); await page.waitForTimeout(800);
  await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T)); await shot(page, "33-bk-ki-chat", p, p === "mobil");
  await klick(page, () => page.getByRole("tab", { name: "Lernen" }).click(T)); await shot(page, "33-bk-lernen", p, p === "mobil");
  await page.goto("/baukasten?kopie=agenten-team"); await page.waitForTimeout(800);
  await klick(page, () => page.getByRole("tab", { name: /KI-Ablauf/ }).click(T)); await shot(page, "34-bk-agenten-team", p, p === "mobil");
  // Postfach mit KI und Prozedur
  await page.addInitScript((app) => localStorage.setItem("kihub-apps-v3", JSON.stringify([app])), POST_APP);
  await page.goto("/app/post-app"); await page.waitForTimeout(800); await shot(page, "35-postfach", p, true);
  const post = page.locator(".o-post");
  await klick(page, () => post.getByRole("button", { name: /CRA Attest/ }).first().click(T)); await page.waitForTimeout(400);
  await shot(page, "35-postfach-mail", p, true);
  await klick(page, () => post.getByRole("region", { name: "KI zu dieser Mail" }).getByRole("button", { name: "Zusammenfassen" }).click(T));
  await page.waitForTimeout(1500); await shot(page, "35-postfach-ki", p, true);
  await klick(page, () => post.getByRole("button", { name: "Prozeduren" }).click(T)); await shot(page, "35-postfach-prozeduren", p, true);
  await klick(page, () => post.getByRole("button", { name: "CRA ablegen" }).click(T)); await page.waitForTimeout(1500); await shot(page, "35-postfach-treffer", p, true);
  // Löschen-Dialog und gesperrte App
  await page.goto("/app/cra-experte"); await page.waitForTimeout(500);
  await klick(page, () => page.getByRole("button", { name: "Vorlage übernehmen und bearbeiten" }).click(T)); await page.waitForTimeout(600);
  await klick(page, () => page.getByRole("button", { name: /^Speichern/ }).click(T)); await page.waitForTimeout(400);
  await page.goto("/app/cra-experte"); await page.waitForTimeout(500); await shot(page, "36-app-eigene", p, true);
  await klick(page, () => page.getByRole("button", { name: "Verwalten" }).click(T)); await shot(page, "36-app-verwalten", p);
  await klick(page, () => page.getByRole("menuitem", { name: "Löschen" }).click(T)); await shot(page, "36-app-loeschen-dialog", p);
  await page.keyboard.press("Escape");
  await klick(page, () => page.getByRole("button", { name: "Verwalten" }).click(T));
  await klick(page, () => page.getByRole("menuitem", { name: "Sperren" }).click(T)); await page.waitForTimeout(400); await shot(page, "36-app-gesperrt", p, true);
  await page.goto("/verwaltung"); await page.waitForTimeout(800); await shot(page, "37-verwaltung-mit-apps", p, true);
});
