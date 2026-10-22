import { test, expect } from "@playwright/test";

const SPALTEN = [
  { key: "pos", titel: "Pos.", typ: "text", art: "ki" },
  { key: "bezeichnung", titel: "Bezeichnung", typ: "text", art: "ki" },
  { key: "menge", titel: "Menge", typ: "zahl", art: "ki" },
  { key: "elektrik", titel: "Elektrik (Std)", typ: "zahl", art: "eingabe", summe: true },
  { key: "software", titel: "Software (Std)", typ: "zahl", art: "eingabe", summe: true },
];

const APP = {
  id: "retrofit", name: "Retrofit-Kalkulation", bereich: "Test", status: "freigegeben", version: 1,
  steps: [
    { id: "s1", key: "lesen", name: "Kalkulation lesen", format: "json", prompt: "Lies {{kalkulation}}" },
    { id: "s2", key: "angebot", name: "Angebot", prompt: "Schreib ein Angebot aus {{positionen}}" },
  ],
  blocks: [
    { id: "p1", type: "seite", props: { titel: "Hochladen" }, children: [{ id: "f0", type: "textarea", props: { key: "kalkulation", label: "Kalkulation", pflicht: true } }] },
    { id: "p2", type: "seite", props: { titel: "Stunden" }, children: [
      { id: "t1", type: "tabelle", props: { key: "positionen", label: "Positionen", aus: "lesen.positionen", pflicht: true, spalten: SPALTEN, spaltenHinzufuegen: true } },
    ] },
    { id: "p3", type: "seite", props: { titel: "Angebot" }, children: [{ id: "o1", type: "output", props: { titel: "Angebot", quelle: "s2" } }] },
  ],
};

test("Tabelle: Vorbelegung aus einer Liste, Markdown mit Summen für den nächsten Schritt, Pflicht", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (a) => {
    const s = await import("/src/lib/sanitize.ts");
    const rq = await import("/src/lib/request.ts");
    const v = await import("/src/lib/vorbelegung.ts");
    const run = await import("/src/lib/runner.ts");
    const t = await import("/src/lib/tabelle.ts");
    const x = s.loadApp(a)!;
    const antwort = JSON.stringify({ positionen: [
      { Pos: "10", Bezeichnung: "Steuerung S7-1500 | Schaltschrank", menge: 1, elektrik: "99" },
      { pos: 20, bezeichnung: "HMI-Panel", Menge: "2" },
      { pos: "", bezeichnung: "", menge: "" },
    ] });
    const wert = v.vorbelegungen(x, "lesen", antwort)!.positionen.wert as string;
    const tab = t.tabelleLesen(wert);
    // Die Person trägt Stunden ein und legt eine Spalte für einen Mitarbeiter an
    tab.zeilen[0].elektrik = "12,5"; tab.zeilen[1].elektrik = "4"; tab.zeilen[1].software = "1.234,5";
    tab.zusatz = ["Erika"]; tab.zeilen[0][t.zusatzKey("Erika")] = "3";
    const werte = { kalkulation: "x", positionen: t.tabelleSchreiben(tab) };
    const ctx = run.kontext(x, werte, {});
    return {
      zeilen: tab.zeilen.length, erste: t.tabelleLesen(wert).zeilen[0],
      md: ctx.positionen,
      lesen: rq.buildRequest(x, x.steps[0], ctx).nachricht,
      fehltLeer: run.fehlendePflichtfelder(x, [x.steps[1]], { kalkulation: "x", positionen: "" }, {}),
      fehltVoll: run.fehlendePflichtfelder(x, [x.steps[1]], werte, {}),
      zahlen: ["1.234,5", "12,5", "12.5", "1,234.5", "abc", ""].map(t.zahlAus),
      kaputteSpalten: s.loadApp({ ...a, blocks: [{ id: "p", type: "seite", props: { titel: "S" }, children: [{ id: "t", type: "tabelle", props: { key: "t", spalten: [{ titel: "Stunden Müller", typ: "zahl", art: "eingabe" }, { key: "Ungültig!", titel: "Menge", typ: "quatsch" }, { titel: "" }] } }] }] })!.blocks[0].children![0].props,
    };
  }, APP);
  // Nur KI-Spalten aus dem Ergebnis, Schreibweise egal, leere Zeilen fallen weg; Eingabespalten bleiben leer
  expect(r.zeilen).toBe(2);
  expect(r.erste).toEqual({ pos: "10", bezeichnung: "Steuerung S7-1500 | Schaltschrank", menge: "1" });
  expect(r.md).toContain("| Pos. | Bezeichnung | Menge | Elektrik (Std) | Software (Std) | Erika |");
  expect(r.md).toContain("Steuerung S7-1500 \\| Schaltschrank");
  expect(r.md).toContain("| **Summe** |  |  | **16,5** | **1.234,5** | **3** |");
  expect(r.lesen).toContain('unter "positionen": eine Liste mit einem Objekt je Zeile');
  expect(r.lesen).toContain('"menge" (Menge, Zahl ohne Tausenderpunkte)');
  expect(r.lesen).not.toContain('"elektrik"');
  expect(r.fehltLeer).toEqual(["positionen"]);
  expect(r.fehltVoll).toEqual([]);
  expect(r.zahlen.slice(0, 4)).toEqual([1234.5, 12.5, 12.5, 1234.5]);
  expect(r.zahlen.slice(4).every((n: number) => Number.isNaN(n))).toBe(true);
  expect((r.kaputteSpalten as { spalten: unknown[] }).spalten).toEqual([
    { key: "stunden_mueller", titel: "Stunden Müller", typ: "zahl", art: "eingabe", summe: false },
    { key: "ungueltig", titel: "Menge", typ: "text", art: "eingabe", summe: false },
  ]);
});

test("Tabelle ausfüllen: Zeilen und Mitarbeiter-Spalte anlegen, Summe rechnet mit, Blatt scrollt nicht", async ({ page }, info) => {
  const app = {
    ...APP, id: "tab-ui",
    steps: [{ id: "s2", key: "angebot", name: "Angebot", prompt: "Schreib aus {{positionen}}" }],
    blocks: [
      { id: "p2", type: "seite", props: { titel: "Stunden" }, children: [
        { id: "t1", type: "tabelle", props: { key: "positionen", label: "Positionen", spalten: SPALTEN.map((c) => ({ ...c, art: c.key === "bezeichnung" || c.art === "eingabe" ? "eingabe" : "ki" })), spaltenHinzufuegen: true } },
      ] },
      { id: "p3", type: "seite", props: { titel: "Angebot" }, children: [{ id: "o1", type: "output", props: { titel: "Angebot", quelle: "s2" } }] },
    ],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/tab-ui");
  const tab = page.locator('.o-tab[data-key="positionen"]');
  await expect(tab).toContainText("Noch keine Zeilen.");
  await tab.getByRole("button", { name: "Zeile hinzufügen" }).click();
  await tab.getByRole("button", { name: "Zeile hinzufügen" }).click();
  await tab.getByLabel("Bezeichnung, Zeile 1").fill("Steuerung");
  await tab.getByLabel("Elektrik (Std), Zeile 1").fill("12,5");
  // Enter springt in dieselbe Spalte der nächsten Zeile
  await tab.getByLabel("Elektrik (Std), Zeile 1").press("Enter");
  await expect(tab.getByLabel("Elektrik (Std), Zeile 2")).toBeFocused();
  await page.keyboard.type("4");
  await expect(tab.locator("tfoot")).toContainText("16,5");
  await tab.getByRole("button", { name: "Spalte hinzufügen" }).click();
  await tab.getByLabel("Titel der neuen Spalte").fill("Erika");
  await tab.getByRole("button", { name: "Anlegen" }).click();
  await tab.getByLabel("Erika, Zeile 2").fill("7");
  await expect(tab.locator("thead")).toContainText("Erika");
  await expect(tab.locator("tfoot td").nth(5)).toHaveText("7");
  // KI-Spalten ohne „korrigierbar“ sind nur Text
  await expect(tab.getByLabel("Pos., Zeile 1")).toHaveCount(0);
  await tab.getByRole("button", { name: "Zeile 1 entfernen" }).click();
  await expect(tab.locator("tbody tr")).toHaveCount(1);
  await expect(tab.locator("tfoot")).toContainText("4");
  if (info.project.name === "desktop") {
    const scrollt = await page.evaluate(() => { const b = document.querySelector<HTMLElement>(".app-inner")!; return b.scrollHeight - b.clientHeight; });
    expect(scrollt).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: `screenshots/${info.project.name}-tabelle.png` });
});

test("Baukasten: Tabelle in der Palette, Spalten bearbeiten", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/model.ts");
    const c = await import("/src/components/builder/catalog.ts");
    const b = m.makeBlock("tabelle", { blocks: [], steps: [] });
    return { label: c.BT.tabelle.label, gruppe: c.BT.tabelle.group, key: (b.props as { key: string }).key, spalten: (b.props as { spalten: unknown[] }).spalten.length };
  });
  expect(r).toEqual({ label: "Tabelle", gruppe: "Eingaben", key: "tabelle", spalten: 3 });
});
