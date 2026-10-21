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

test("Wissen: Textdateien (.md) und Bibliotheksansichten werden gelesen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    const l = await import("/src/lib/links.ts");
    const ansicht = "https://koerbergroup.sharepoint.com/sites/KSCCybersecurity/KSC_Cybersecurity_Library/Forms/KPSS%20Default.aspx?id=%2Fsites%2FKSCCybersecurity%2FKSC%5FCybersecurity%5FLibrary%2FKPSS%20Templates%2F10%20Knowledge%20Base%2FCyber%20Resilience%20Act%20%28CRA%29%20EU%202024%5F2847%2FKPSS%5FCRA%5FQuick%5FReference%5FGuide%5FDE%2Emd&parent=%2Fsites";
    const qrg = "# CRA Schnellreferenz\n\n## Regulatorischer Zeitplan\n| Datum | Beschreibung |\n|---|---|\n| 10.12.2024 | Inkrafttreten des CRA |\n| 11.12.2027 | Vollständige Anwendbarkeit des CRA |\n\n## Meldefristen\nFrühwarnung innerhalb von 24 Stunden.";
    const klein = w.textAuszug([{ name: "KPSS_CRA_Quick_Reference_Guide_DE.md", link: "https://x/qrg.md", text: qrg }], "Ab wann gilt der CRA?");
    // Großer Bestand: nur die passenden Abschnitte, mit Überschrift als Fundstelle
    const fuell = Array.from({ length: 40 }, (_, i) => `## Kapitel ${i}\n${"Allgemeiner Text ohne Bezug. ".repeat(40)}`).join("\n\n");
    const gross = w.textAuszug([{ name: "Handbuch.md", link: "https://x/h.md", text: fuell + "\n\n## Meldefristen\nFrühwarnung innerhalb von 24 Stunden, Vollmeldung nach 72 Stunden." }], "Welche Meldefristen gelten für Schwachstellen?", 6000);
    return {
      adresse: w.bereichAdresse(ansicht),
      normal: w.bereichAdresse("https://x.sharepoint.com/sites/a/Shared%20Documents/Ordner"),
      klein, gross,
      link: l.linkQuellen(`Was steht hier: ${ansicht}`),
      md: w.TEXT_DATEI.test("x.md"),
    };
  });
  expect(r.adresse).toBe("https://koerbergroup.sharepoint.com/sites/KSCCybersecurity/KSC_Cybersecurity_Library/KPSS%20Templates/10%20Knowledge%20Base/Cyber%20Resilience%20Act%20(CRA)%20EU%202024_2847/KPSS_CRA_Quick_Reference_Guide_DE.md");
  expect(r.normal).toBe("https://x.sharepoint.com/sites/a/Shared%20Documents/Ordner");
  expect(r.klein).toContain("11.12.2027 | Vollständige Anwendbarkeit des CRA");
  expect(r.klein).toContain("Link: https://x/qrg.md");
  expect(r.gross).toContain("Stelle 1 (Abschnitt „Meldefristen“)");
  expect(r.gross).toContain("72 Stunden");
  expect(r.gross.length).toBeLessThan(7000);
  expect(r.link).toEqual([{ typ: "datei", titel: "KPSS_CRA_Quick_Reference_Guide_DE.md", url: expect.stringContaining("KPSS%20Default.aspx") }]);
  expect(r.md).toBe(true);
});

test("Wissen: Excel-Tabellen werden zeilenweise gelesen, Namen in Tabellen gefunden, passende Dateinamen erkannt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    // Wie der KSCA Stakeholder+Communication Plan: Titelzeile, dann Kopfzeile, dann Kontakte (Namen erfunden)
    const tabelle = w.tabelleAlsText([
      { sheet: "Kontakte", data: [["KSCA Stakeholder"], ["Name", "Rolle", "Bereich", "Position", "RACI"], ["Max Muster", "PSSA", "Project IT", "Teamleiter", "Responsible"], ["Erika Beispiel", "Product Owner", "Vertrieb", null, "Accountable"]] },
      { sheet: "Leer", data: [[null]] },
    ]);
    // Ein großer Bestand: Die Zeile mit der Rolle muss als Stelle mitkommen, auch wenn viel anderes Material daneben liegt
    const fuell = Array.from({ length: 30 }, (_, i) => `## Kapitel ${i}\n${"Allgemeine Rollenbeschreibung ohne Namen. ".repeat(40)}`).join("\n\n");
    const auszug = w.textAuszug([
      { name: "PSSA Rollenbeschreibung.md", link: "https://x/rolle.md", text: fuell },
      { name: "KSCA_Stakeholder+Communication_Plan.xlsx", link: "https://x/plan.xlsx", text: tabelle },
    ], "Wer ist technischer PSSA?", 6000);
    const namen = w.namensTreffer([{ name: "Allgemeine Rollenbeschreibung.pdf" }, { name: "KSCA_Stakeholder+Communication_Plan.docx" }, { name: "Schulung.pdf" }], "Wer steht im Stakeholder Plan?").map((d) => d.name);
    return { tabelle, auszug, namen, xlsx: w.TABELLE.test("Plan.xlsx"), docx: w.NAME_LESBAR.test("a.docx") };
  });
  expect(r.tabelle).toContain("## Tabellenblatt Kontakte");
  expect(r.tabelle).toContain("Name: Max Muster | Rolle: PSSA | Bereich: Project IT | Position: Teamleiter | RACI: Responsible");
  expect(r.tabelle).toContain("Name: Erika Beispiel | Rolle: Product Owner | Bereich: Vertrieb | RACI: Accountable");
  expect(r.tabelle).not.toContain("Leer");
  expect(r.auszug).toContain("Dokument: KSCA_Stakeholder+Communication_Plan.xlsx");
  expect(r.auszug).toContain("Max Muster | Rolle: PSSA");
  expect(r.auszug.length).toBeLessThan(7000);
  expect(r.namen).toEqual(["KSCA_Stakeholder+Communication_Plan.docx"]);
  expect(r.xlsx).toBe(true);
  expect(r.docx).toBe(true);
});
