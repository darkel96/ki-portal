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
  expect(r.link).toEqual([{ typ: "datei", titel: "KPSS_CRA_Quick_Reference_Guide_DE.md", url: expect.stringContaining("KPSS%20Default.aspx"), tage: 7, filter: "" }]);
  expect(r.md).toBe(true);
});

test("Wissen: Excel-Tabellen werden zeilenweise gelesen, Namen in Tabellen gefunden, passende Dateinamen erkannt", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    // Aufbau wie der KSCA Stakeholder+Communication Plan, Blatt „Kontakte“: Titelzeile mit zwei Werten, darunter die
    // eigentliche Kopfzeile mit „CRA Rolle“ (Namen erfunden). Früher galt die Titelzeile als Kopfzeile.
    const tabelle = w.tabelleAlsText([
      { sheet: "Kontakte", data: [
        ["CRA Contacts KSCA Leingarten", null, null, null, null, "Roll-out", "Prozess", null],
        ["Name", "1st Name", "e-mail", "Department", "Position", "RACI", "RACI2", "CRA Rolle"],
        ["Muster", "Max", "max.muster@example.com", "Software Project Processing", "PL", "Responsible", "Responsible", "PSSA"],
        ["Beispiel", "Erika", "erika.beispiel@example.com", "R&D Software", "Specialist", "Responsible", "Responsible", "PSSA"],
        ["Probe", "Paul", "paul.probe@example.com", "Einkauf", null, null, null, null],
      ] },
      { sheet: "Leer", data: [[null]] },
    ]);
    // Großer Bestand: Die Tabellenzeilen müssen als Stelle mitkommen, auch wenn viel Rollenbeschreibung daneben liegt
    const fuell = Array.from({ length: 30 }, (_, i) => `## Kapitel ${i}\n${"Allgemeine Rollenbeschreibung des technischen PSSA ohne Namen. ".repeat(30)}`).join("\n\n");
    const dateien = [
      { name: "PSSA Rollenbeschreibung.md", link: "https://x/rolle.md", text: fuell },
      { name: "KSCA_Stakeholder+Communication_Plan.xlsx", link: "https://x/plan.xlsx", text: tabelle },
    ];
    const software = w.textAuszug(dateien, "Wer ist technisch verantwortlich als PSSA für die Software?", 6000);
    const namen = w.textAuszug(dateien, "Ich brauche Namen der Personen", 6000);
    const datei = w.namensTreffer([{ name: "Allgemeine Rollenbeschreibung.pdf" }, { name: "KSCA_Stakeholder+Communication_Plan.docx" }, { name: "Schulung.pdf" }], "Wer steht im Stakeholder Plan?").map((d) => d.name);
    const anfrage = w.auszuegeText([{ titel: "CRA-Bibliothek", url: "https://x/bib", text: "Dokument: a", dateien: ["KSCA_Stakeholder+Communication_Plan.xlsx", "Rollen.md"], dateienGesamt: 312 }]);
    return { tabelle, software, namen, datei, anfrage, xlsx: w.TABELLE.test("Plan.xlsx"), docx: w.NAME_LESBAR.test("a.docx") };
  });
  expect(r.tabelle).toContain("## Tabellenblatt Kontakte\nCRA Contacts KSCA Leingarten · Roll-out · Prozess");
  expect(r.tabelle).toContain("Name: Muster | 1st Name: Max | e-mail: max.muster@example.com | Department: Software Project Processing | Position: PL | RACI: Responsible | RACI2: Responsible | CRA Rolle: PSSA");
  expect(r.tabelle).toContain("Name: Probe | 1st Name: Paul | e-mail: paul.probe@example.com | Department: Einkauf");
  expect(r.tabelle).not.toContain("Roll-out: ");
  expect(r.tabelle).not.toContain("Leer");
  for (const a of [r.software, r.namen]) {
    expect(a).toContain("Dokument: KSCA_Stakeholder+Communication_Plan.xlsx");
    expect(a).toContain("Department: Software Project Processing | Position: PL");
    // Tabellen zählen Zeile für Zeile: alle PSSA-Zeilen kommen mit, beisammen als eine Stelle des Tabellenblatts
    expect(a).toContain("Name: Beispiel | 1st Name: Erika");
    expect(a).toContain("(Abschnitt „Tabellenblatt Kontakte“):\nName: ");
    expect(a).not.toContain("CRA Contacts KSCA Leingarten");
    expect(a.length).toBeLessThan(7000);
  }
  // Regel für Personenfragen gilt für jeden Agenten; die Dateiliste nennt die Gesamtzahl
  expect(r.anfrage).toContain("nenne die konkreten Personen aus Tabellen und Listen");
  expect(r.anfrage).toContain("Dateien in diesem Bereich (312, davon die 2 passendsten): KSCA_Stakeholder+Communication_Plan.xlsx; Rollen.md");
  expect(r.datei).toEqual(["KSCA_Stakeholder+Communication_Plan.docx"]);
  expect(r.xlsx).toBe(true);
  expect(r.docx).toBe(true);
});

test("Wissen: Bei mehreren Fragen auf einmal kommen die Tabellenzeilen trotzdem mit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    // Kontakttabelle (Namen erfunden) neben langer Knowledge Base, die viele Wörter aller Fragen enthält
    const tabelle = w.tabelleAlsText([{ sheet: "Kontakte", data: [
      ["Name", "1st Name", "Department", "Position", "RACI", "CRA Rolle"],
      ["Eins", "Anna", "Cyber Security Advisor", "CISO", "Responsible", "CISO"],
      ["Zwei", "Bert", "Product and Solution Security Officer", "Specialist", "Responsible", "PSSO"],
      ["Drei", "Cora", "R&D Automation", "Specialist", "Responsible", "PSSA"],
      ["Vier", "Dirk", "Automation Fördertechnik", "Abteilungsleiter", "Responsible", "PSSA"],
      ["Fünf", "Emil", "Elektrokonstruktion", "Abteilungsleiter", "Responsible", null],
      ["Sechs", "Fritz", "Elektrokonstruktion", null, null, "PSSA"],
      ["Sieben", "Gabi", "Einkauf", null, null, null],
    ] }]);
    const absatz = "Der CRA gilt vollständig ab 2027. Der PSSA unterstützt das Threat Modeling, bewertet Schwachstellen und Meldepflichten, arbeitet mit CISO und PSSO zusammen und ist für Automation und Elektrokonstruktion Ansprechpartner. ";
    const kb = Array.from({ length: 20 }, (_, i) => `## Kapitel ${i}\n${absatz.repeat(9)}`).join("\n\n");
    const frage = "Beantworte bitte die folgenden sieben Fragen:\n1. Wer ist der CISO und wer der PSSO?\n2. Welche PSSA gibt es in Abteilungen mit „Automation“ im Namen?\n3. Ab wann gilt der CRA vollständig?\n4. Was muss ich als PSSA beim Threat Modeling konkret tun?\n5. Welche Meldepflichten gibt es bei Schwachstellen?\n6. Wer ist für Elektrokonstruktion zuständig?\n7. Wie lautet die interne Telefonnummer der CRA-Hotline?";
    return w.textAuszug([{ name: "Knowledge Base.md", link: "https://x/kb.md", text: kb }, { name: "Plan.xlsx", link: "https://x/plan.xlsx", text: tabelle }], frage, 12_000);
  });
  for (const zeile of ["Name: Eins", "Name: Zwei", "Name: Drei", "Name: Vier", "Name: Fünf", "Name: Sechs"]) expect(r).toContain(zeile);
  expect(r).toContain("Dokument: Knowledge Base.md");
  expect(r.length).toBeLessThan(13_000);
});

test("Wissen: Zwischenspeicher sind je Person getrennt, ohne Person wird nichts gespeichert", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    const url = "https://x.sharepoint.com/sites/a/Bibliothek";
    // Im Hub-Dienst teilen sich alle Personen einen Prozess: dieselbe Quelle darf nie denselben Schlüssel bekommen
    return { anna: w.schluesselFuer("anna", url), bernd: w.schluesselFuer("bernd", url), niemand: w.schluesselFuer(null, url), leer: w.schluesselFuer("", url) };
  });
  expect(r.anna).not.toBe(r.bernd);
  expect(r.anna).toContain("anna");
  expect(r.niemand).toBeNull();
  expect(r.leer).toBeNull();
});

test("Wissen: Nummerierte Sammelfragen werden für die Suche zerlegt, die Regel für falsche Annahmen geht mit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    const acht = "CRA-Experte: Beantworte bitte die folgenden Fragen:\n\n1. Wie viele Personen sind als PSSA eingetragen?\n2) Warum gilt der CRA erst ab 2029?\n 3. Welche Meldefristen gelten?";
    return {
      teile: w.teilfragen(acht),
      eine: w.teilfragen("Wer ist der CISO? Und wer der PSSO?"),
      liste: w.teilfragen("Nenne die Fristen:\n1. 24 h"),
      anfrage: w.auszuegeText([{ titel: "B", url: "https://x/b", text: "Dokument: a" }]),
    };
  });
  expect(r.teile).toEqual(["Wie viele Personen sind als PSSA eingetragen?", "Warum gilt der CRA erst ab 2029?", "Welche Meldefristen gelten?"]);
  // Eine Frage ohne Nummern bzw. nur eine nummerierte Zeile: keine Zerlegung
  expect(r.eine).toEqual([]);
  expect(r.liste).toEqual([]);
  expect(r.anfrage).toContain("stelle sie zuerst richtig");
});

test("Wissen: Bei knappem Platz kommt der Anfang eines passenden Abschnitts mit, die Regel für Ableitungen geht mit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    // Wie bei acht Fragen auf einmal: je Frage um 1.000 Zeichen, der passende Abschnitt ist länger
    const zeitplan = "## Regulatorischer Zeitplan\nDer CRA ist am 10.12.2024 in Kraft getreten.\nVollständige Anwendbarkeit ab 11.12.2027.\n" + "Erläuterung zu Übergangsfristen und Konformitätsbewertung. ".repeat(40);
    const fuell = Array.from({ length: 10 }, (_, i) => `## Kapitel ${i}\n${"Allgemeiner Text ohne Bezug. ".repeat(60)}`).join("\n\n");
    const knapp = w.textAuszug([{ name: "Leitfaden.md", link: "https://x/l.md", text: fuell + "\n\n" + zeitplan }], "Warum gilt der CRA erst ab 2029?", 1000);
    return { knapp, anfrage: w.auszuegeText([{ titel: "B", url: "https://x/b", text: "Dokument: a" }]) };
  });
  expect(r.knapp).toContain("Vollständige Anwendbarkeit ab 11.12.2027.");
  expect(r.knapp).toContain(" …");
  expect(r.knapp.length).toBeLessThan(1200);
  expect(r.anfrage).toContain("kennzeichne sie als Ableitung");
  expect(r.anfrage).toContain("nenne den belegten richtigen Wert");
});
