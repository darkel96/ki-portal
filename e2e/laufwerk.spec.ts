import { test, expect, type Page } from "@playwright/test";

/**
 * Netzlaufwerk über den Hub-Dienst: Der Dienst liest nur freigegebene Ordner (hier e2e/laufwerk, im Test als
 * „Laufwerk Y“ mit UNC \\fs01\daten), holt den Text aus Word, Excel, PowerPoint, PDF und Text und liefert passende Stellen.
 */
const DIENST = "http://localhost:8787";
const api = (pfad: string, nutzer: string, init: RequestInit = {}) => fetch(`${DIENST}/api${pfad}`, { ...init, headers: { Authorization: `Bearer test:${nutzer}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
const setzen = (datei: string, inhalt: unknown) => fetch(`${DIENST}/attrappe/github-setzen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datei: `public/hub-daten/${datei}`, inhalt }) });
type Treffer = { text: string; fehler?: string; dateien?: string[] };
const suche = async (nutzer: string, pfad: string, frage: string) => (await (await api("/laufwerk/suche", nutzer, { method: "POST", body: JSON.stringify({ pfad, frage, titel: "Y" }) })).json()) as Treffer;

async function freigeben(chef: string) {
  await setzen("rechte.json", { nutzer: [{ email: `${chef}@test.local`, rechte: ["admin"] }], ausgeblendet: [] });
  const r = await api("/laufwerk/freigaben", chef, { method: "PUT", body: JSON.stringify([{ pfad: "Projekte", fuer: [], notiz: "Projektunterlagen" }, { pfad: "Personal", fuer: [`${chef}@test.local`], notiz: "" }]) });
  expect(r.status).toBe(200);
  await expect.poll(async () => { const i = await (await api("/laufwerk", chef)).json() as { stand: { dateien: number; laeuft: boolean } }; return JSON.stringify(i.stand); }, { timeout: 30_000 }).toMatch(/"dateien":6,.*"laeuft":false/);
}

test("Netzlaufwerk im Dienst: nur Freigaben, Text aus allen Formaten, Stellen mit UNC-Link", async ({}, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const chef = `lwchef${Date.now()}`, kollege = `lwkollege${Date.now()}`;
  await freigeben(chef);
  const i = await (await api("/laufwerk", chef)).json() as { aktiv: boolean; name: string; unc: string; admin: boolean };
  expect(i).toMatchObject({ aktiv: true, name: "Laufwerk Y", unc: "\\\\fs01\\daten", admin: true });
  // Ordner zum Freigeben (nur die Verwaltung sieht das ganze Laufwerk); kein Ausbruch nach oben
  expect((await (await api("/laufwerk/ordner?pfad=", chef)).json() as { name: string }[]).map((o) => o.name)).toEqual(["Kunden", "Personal", "Projekte"]);
  expect((await api("/laufwerk/ordner?pfad=..%2F..", chef)).status).toBeGreaterThanOrEqual(400);
  expect((await api("/laufwerk/ordner?pfad=", kollege)).status).toBe(403);
  expect((await api("/laufwerk/freigaben", kollege, { method: "PUT", body: "[]" })).status).toBe(403);
  // Der Kollege sieht nur die Freigabe für alle, ohne die Personenliste
  const ki = await (await api("/laufwerk", kollege)).json() as { admin: boolean; freigaben: { pfad: string }[] };
  expect(ki.admin).toBe(false);
  expect(ki.freigaben.map((f) => f.pfad)).toEqual(["Projekte"]);
  // Suche: Text, Stellen mit Link als UNC-Pfad, Wortanfang („Abnahme“ trifft „Abnahmeprotokoll“)
  const a = await suche(kollege, "Projekte/KTE", "Wann ist die Abnahme?");
  expect(a.fehler).toBeUndefined();
  expect(a.text).toContain("Link: \\\\fs01\\daten\\Projekte\\KTE\\Abnahme.txt");
  expect(a.text).toContain("30.11.2026");
  expect(a.dateien).toContain("Abnahme.txt");
  // Alle Formate: PDF, Excel, Word, PowerPoint
  expect((await suche(kollege, "Projekte", "Prioritäten Quartal")).dateien).toEqual(expect.arrayContaining(["Besprechung.pdf", "Bericht.docx"]));
  expect((await suche(kollege, "Projekte/KTE", "Lieferantenliste")).text).toContain("Lieferantenliste prüfen;Tom Kraus");
  expect((await suche(kollege, "Projekte/Retrofit", "Transkript Oktober")).dateien).toContain("Folien.pptx");
  // Nicht freigegeben: Personal nur für die Verwaltung; aus „Projekte“ nichts aus Personal
  expect((await suche(kollege, "Personal", "Gehälter")).fehler).toContain("nicht freigegeben");
  expect((await suche(kollege, "Projekte", "Gehaltsliste Gehälter")).text).not.toContain("Gehalt");
  expect((await suche(chef, "Personal", "Gehaltsliste")).dateien).toContain("Gehalt.txt");
});

async function hub(page: Page, nutzer: string) {
  await page.addInitScript((nutzer) => {
    localStorage.setItem("kihub-speicher", JSON.stringify({ git: { repo: "test/hub", branch: "main", pfad: "public/hub-daten" } }));
    localStorage.setItem("kihub-dienst-url", "http://localhost:8787");
    localStorage.setItem("kihub-dienst-nutzer", nutzer);
    localStorage.setItem("kihub-testnutzer", JSON.stringify({ id: `test-${nutzer}`, name: nutzer, email: `${nutzer}@test.local` }));
  }, nutzer);
  await page.route("**/hub-daten/*.json", async (route) => {
    const datei = route.request().url().split("?")[0]!.split("/").pop()!;
    const r = await fetch(`${DIENST}/attrappe/github/repos/test/hub/contents/public/hub-daten/${datei}`, { headers: { Authorization: "Bearer test-git", Accept: "application/vnd.github.raw" } });
    await route.fulfill({ status: r.status, headers: { "content-type": "application/json" }, body: r.ok ? await r.text() : "" });
  });
}

test("Verwaltung gibt Ordner frei; im Baukasten wählbar; der Chat bekommt die Stellen", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const chef = `lwui${Date.now()}`;
  await freigeben(chef);
  await hub(page, chef);
  // Verwaltung: Stand, Freigaben, Ordnerauswahl
  await page.goto("/verwaltung");
  const lw = page.locator(".rv-laufwerk");
  await expect(lw.getByRole("heading", { name: "Netzlaufwerk" })).toBeVisible({ timeout: 15_000 });
  await expect(lw).toContainText("Laufwerk Y (\\\\fs01\\daten)");
  await expect(lw).toContainText(/\d+ Dateien eingelesen/);
  await expect(lw.getByRole("list", { name: "Freigegebene Ordner" })).toContainText("Projekte");
  await lw.locator(".rv-lw-ordner").filter({ hasText: /^Projekte$/ }).click();
  await lw.locator(".rv-lw-ordner").filter({ hasText: /^KTE$/ }).click();
  await lw.getByRole("button", { name: "„KTE“ freigeben" }).click();
  await expect(lw.getByRole("list", { name: "Freigegebene Ordner" })).toContainText("Projekte/KTE");
  await expect(lw.getByRole("button", { name: "Freigaben speichern" })).toBeEnabled();
  // Baukasten: Quelle „Netzlaufwerk“ mit den Freigaben zur Auswahl
  await page.goto("/baukasten?kopie=protokoll");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: /^Wissen/ }).click();
  await page.getByRole("button", { name: "Netzlaufwerk" }).first().click();
  await expect(page.getByLabel("Art der Quelle").last()).toHaveValue("laufwerk");
  await expect(page.getByText(/Freigegeben: Projekte, Personal/)).toBeVisible({ timeout: 15_000 });
  // Lauf: die Stellen aus dem Laufwerk gehen mit der Anfrage an die KI
  const r = await page.evaluate(async () => {
    const w = await import("/src/lib/ki/wissen.ts");
    const a = await w.wissenAuszuege([{ typ: "laufwerk", titel: "Laufwerk Y", url: "Projekte/KTE", tage: 7, filter: "" }], "Wann ist die Abnahme?");
    return { a, text: w.auszuegeText(a) };
  });
  expect(r.a[0]!.fehler).toBeUndefined();
  expect(r.text).toContain("### Laufwerk Y");
  expect(r.text).toContain("Die Abnahme der Emulation ist für den 30.11.2026 geplant.");
});

test("Kunde zuerst: Kunde aus der Frage, nur dessen Ordner, Rückfrage bei unklarem Kunden, nur freigegebene Kunden", async ({}, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const chef = `lwkunde${Date.now()}`, kollege = `lwkk${Date.now()}`;
  await setzen("rechte.json", { nutzer: [{ email: `${chef}@test.local`, rechte: ["admin"] }], ausgeblendet: [] });
  const frei = async (liste: { pfad: string; fuer: string[] }[]) => expect((await api("/laufwerk/freigaben", chef, { method: "PUT", body: JSON.stringify(liste.map((f) => ({ ...f, notiz: "" }))) })).status).toBe(200);
  await frei([{ pfad: "Kunden", fuer: [] }]);
  // Der Kunde steht in der Frage: nur sein Ordner kommt zurück, mit Kopfzeile
  const a = await suche(kollege, "Kunden", "Was ist das aktuelle Projekt bei Amcor?");
  expect(a.fehler).toBeUndefined();
  expect(a.text).toContain("Kundenordner: Amcor_Singen");
  expect(a.text).toContain("Retrofit der Fördertechnik");
  expect(a.text).not.toContain("Printus");
  // Amcor steht im Suchindex (HUB_LAUFWERK_INDEX), AVS Römer nicht: dort liest der Dienst auf Nachfrage
  expect(a.text).toContain("Amcor_Singen · Suchindex");
  expect((await suche(kollege, "Kunden", "Wer ist bei Amcor für die Förder zuständig?")).text).toContain("Fördertechnik");
  // Umlaute: „Römer“ trifft den Ordner „Roemer“
  const avs = (await suche(kollege, "Kunden", "Wann ist die Inbetriebnahme bei AVS Römer?")).text;
  expect(avs).toContain("Kundenordner: AVS_Roemer_Grafenau");
  expect(avs).not.toContain("Suchindex");
  // Zwei Printus-Ordner: Rückfrage statt Auszügen; mit dem Ort ist es eindeutig
  const mehrdeutig = await suche(kollege, "Kunden", "Was ist bei Printus das aktuelle Projekt?");
  expect(mehrdeutig.text).toContain("nicht eindeutig");
  expect(mehrdeutig.text).toContain("Printus_Offenburg");
  expect(mehrdeutig.text).toContain("Printus_Hamburg");
  expect(mehrdeutig.text).not.toContain("Hochregallager");
  const offenburg = await suche(kollege, "Kunden", "Was ist bei Printus Offenburg das aktuelle Projekt?");
  expect(offenburg.text).toContain("Kundenordner: Printus_Offenburg");
  expect(offenburg.text).toContain("Hochregallagers");
  expect(offenburg.text).not.toContain("Sortieranlage");
  // Die jüngste Nennung im Chat gilt (Vorfragen stehen vor der aktuellen Frage)
  expect((await suche(kollege, "Kunden", "Was ist bei Printus Offenburg das Projekt? Und bei Amcor die Ansprechpartnerin?")).text).toContain("Kundenordner: Amcor_Singen");
  // Kein Kunde in der Frage: Anweisung zur Rückfrage, keine Auszüge
  const ohne = await suche(kollege, "Kunden", "Wie wird das Wetter morgen?");
  expect(ohne.text).toContain("kein Kunde erkennbar");
  expect(ohne.text).not.toContain("Kundenordner:");
  // Der Kunde steht schon im Ordner der Quelle: keine Kundenwahl nötig
  expect((await suche(kollege, "Kunden/Amcor_Singen", "Frau Beck")).text).toContain("Kundenordner: Amcor_Singen");
  // Nur ein Kunde freigegeben: andere Kunden sind weder auffindbar noch in der Rückfrage genannt
  await frei([{ pfad: "Kunden/Amcor_Singen", fuer: [] }]);
  const nurAmcor = await suche(kollege, "Kunden", "Was ist bei Printus Offenburg das Projekt?");
  expect(nurAmcor.text).toContain("kein Kunde erkennbar");
  expect(nurAmcor.text).not.toContain("Printus");
  expect(nurAmcor.text).not.toContain("Hochregallager");
  expect((await suche(kollege, "Kunden", "Retrofit bei Amcor")).text).toContain("Kundenordner: Amcor_Singen");
  // Nicht freigegeben und kein Ausbruch nach oben
  await frei([{ pfad: "Projekte", fuer: [] }]);
  expect((await suche(kollege, "Kunden", "Amcor")).fehler).toContain("nicht freigegeben");
  await expect(async () => { const r = await api("/laufwerk/suche", kollege, { method: "POST", body: JSON.stringify({ pfad: "Kunden/../Personal", frage: "Gehalt", titel: "Y" }) }); expect(r.status).toBeGreaterThanOrEqual(400); }).toPass();
});
