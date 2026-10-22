import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const PLAN = `## Terminplan

\`\`\`mermaid
gantt
  dateFormat YYYY-MM-DD
  section Elektrik
  Steuerung :a1, 2027-01-04, 5d
\`\`\`

| Nr | Vorgangsname | Dauer (Tage) | Anfang | Ende | Vorgänger | Gewerk |
|---:|---|---:|---|---|---|---|
| 1 | Steuerung S7-1500 & Schaltschrank | 5 | 2027-01-04 | 2027-01-08 |  | Elektrik |
| 2 | Software-Migration S5 → S7 | 15 | 04.01.2027 |  |  | Software |
| 3 | Inbetriebnahme vor Ort | 10 | | | 1; 2EA+2 | Inbetriebnahme |
| 4 | Abnahme | 0 | | | 3 | Inbetriebnahme |
| | **Summe** | 30 | | | | |

Annahmen: 8 Stunden je Tag.`;

/** Nachgebaute KI: antwortet mit dem Terminplan oben */
async function kiNachbau(page: Page, text: string) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
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

test("MS Project: Vorgangstabelle erkennen, MSPDI mit Sammelvorgängen, Vorgängern und Terminen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (plan) => {
    const m = await import("/src/lib/msproject.ts");
    const v = m.vorgaengeAus(plan);
    const text = m.msProjectXml(v, { titel: "Retrofit <Test>", heute: "2026-10-22" });
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const ns = "http://schemas.microsoft.com/project";
    const tasks = [...doc.getElementsByTagNameNS(ns, "Task")].map((t) => {
      const w = (n: string) => t.getElementsByTagNameNS(ns, n)[0]?.textContent ?? null;
      return { name: w("Name"), uid: w("UID"), ebene: w("OutlineLevel"), sammel: w("Summary"), start: w("Start"), finish: w("Finish"), dauer: w("Duration"), meilenstein: w("Milestone"), constraint: w("ConstraintType"),
        vorgaenger: [...t.getElementsByTagNameNS(ns, "PredecessorLink")].map((l) => [l.getElementsByTagNameNS(ns, "PredecessorUID")[0].textContent, l.getElementsByTagNameNS(ns, "Type")[0].textContent, l.getElementsByTagNameNS(ns, "LinkLag")[0].textContent]),
        reihenfolge: [...t.children].map((c) => c.localName) };
    });
    return { anzahl: v.length, v, fehler: doc.getElementsByTagName("parsererror").length, titel: doc.getElementsByTagNameNS(ns, "Title")[0].textContent, start: doc.getElementsByTagNameNS(ns, "StartDate")[0].textContent, tasks,
      keine: m.vorgaengeAus("| Pos | Bezeichnung |\n|---|---|\n| 1 | x |").length, datum: ["15.03.2027", "15.3.27", "2027-3-5", "x"].map(m.datumAus) };
  }, PLAN);
  expect(r.fehler).toBe(0);
  expect(r.anzahl).toBe(4); // Summenzeile fällt weg
  expect(r.v[2].vorgaenger).toEqual([{ nr: "1", typ: "EA", abstandTage: 0 }, { nr: "2", typ: "EA", abstandTage: 2 }]);
  expect(r.titel).toBe("Retrofit <Test>");
  expect(r.start).toBe("2027-01-04T08:00:00");
  expect(r.tasks.map((t: { name: string }) => t.name)).toEqual(["Elektrik", "Steuerung S7-1500 & Schaltschrank", "Software", "Software-Migration S5 → S7", "Inbetriebnahme", "Inbetriebnahme vor Ort", "Abnahme"]);
  const [elektrik, steuerung, , software, , ibn, abnahme] = r.tasks;
  expect(elektrik).toMatchObject({ ebene: "1", sammel: "1" });
  expect(steuerung).toMatchObject({ ebene: "2", sammel: "0", start: "2027-01-04T08:00:00", finish: "2027-01-08T17:00:00", dauer: "PT40H0M0S", constraint: "4" });
  // 15 Arbeitstage ab Montag, 4.1.: Freitag, 22.1.
  expect(software).toMatchObject({ start: "2027-01-04T08:00:00", finish: "2027-01-22T17:00:00" });
  expect(ibn.constraint).toBe("0");
  expect(ibn.vorgaenger).toEqual([[steuerung.uid, "1", "0"], [software.uid, "1", "9600"]]);
  expect(abnahme).toMatchObject({ meilenstein: "1", dauer: "PT0H0M0S" });
  // Reihenfolge der Elemente wie im MSPDI-Schema
  expect(steuerung.reihenfolge).toEqual(["UID", "ID", "Name", "Manual", "Type", "IsNull", "OutlineNumber", "OutlineLevel", "Start", "Finish", "Duration", "DurationFormat", "Milestone", "Summary", "ConstraintType", "ConstraintDate"]);
  expect(r.keine).toBe(0);
  expect(r.datum).toEqual(["2027-03-15", "2027-03-15", "2027-03-05", null]);
});

test("MS Project: Ergebnis mit Vorgangstabelle bietet die XML im Download-Menü an", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await kiNachbau(page, PLAN);
  const app = {
    id: "plan", name: "Retrofit", bereich: "Test", status: "freigegeben", version: 1,
    steps: [{ id: "s1", key: "terminplan", name: "Terminplan", prompt: "Plane {{eingabe}}" }],
    blocks: [{ id: "p1", type: "seite", props: { titel: "Eingabe" }, children: [{ id: "f1", type: "textarea", props: { key: "eingabe", label: "Anlage" } }] },
      { id: "p2", type: "seite", props: { titel: "Plan" }, children: [{ id: "o1", type: "output", props: { titel: "Terminplan", quelle: "s1" } }] }],
  };
  await page.addInitScript((a) => localStorage.setItem("kihub-apps-v3", JSON.stringify([a])), app);
  await page.goto("/app/plan");
  await page.getByLabel("Anlage", { exact: true }).fill("Retrofit BL-200");
  await page.getByRole("navigation", { name: "Seiten blättern" }).getByRole("button", { name: /Ergebnisse erstellen|Weiter/ }).click();
  // Ergebnis-Kachel öffnen: dort stehen die Download-Knöpfe
  await page.getByRole("button", { name: "Plan" }).click({ timeout: 15_000 });
  await expect(page.getByText("Software-Migration S5 → S7").first()).toBeVisible();
  await page.getByRole("button", { name: /Als Datei herunterladen|Anderes Format/ }).first().click();
  await expect(page.getByText("Terminplan (4 Vorgänge)")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "MS Project (.xml)" }).click()]);
  expect(download.suggestedFilename()).toBe("Retrofit_Terminplan.xml");
  const inhalt = readFileSync(await download.path(), "utf8");
  expect(inhalt).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
  expect(inhalt).toContain("<Name>Inbetriebnahme vor Ort</Name>");
});
