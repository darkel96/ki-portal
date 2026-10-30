import { test, expect } from "@playwright/test";

/** Wissensquelle „Netzlaufwerk / Graph-Connector“: Stellen über die Retrieval-API, sonst die Microsoft-Suche; Ordnerfilter */
test("Connector: Retrieval-API mit Ordnerfilter, Rückfall auf die Suche, verständliche Fehler", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const anfragen: { pfad: string; body: Record<string, unknown> }[] = [];
  let retrieval = true;
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const pfad = new URL(req.url()).pathname;
    const body = req.postDataJSON() as Record<string, unknown>;
    anfragen.push({ pfad, body });
    const ok = (wert: unknown) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(wert) });
    const conn = JSON.stringify(body);
    if (conn.includes("gesperrt")) return route.fulfill({ status: 403, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { code: "Forbidden" } }) });
    if (pfad.endsWith("/copilot/retrieval")) {
      if (!retrieval) return route.fulfill({ status: 404, headers: cors, body: "{}" });
      return ok({ retrievalHits: [
        { webUrl: "file://fs01/daten/Projekte/KTE/Pflichtenheft.docx", resourceMetadata: { title: "Pflichtenheft KTE" }, extracts: [{ text: "Abnahme bis 30.11." }, { text: "Ansprechpartner Marcel Huck" }] },
        { webUrl: "file://fs01/daten/Personal/Gehalt.xlsx", resourceMetadata: { title: "Gehalt" }, extracts: [{ text: "geheim" }] },
      ] });
    }
    if (pfad === "/v1.0/search/query") return ok({ value: [{ hitsContainers: [{ hits: [{ summary: "Die <c0>Abnahme</c0> erfolgt<ddd/>", resource: { properties: { title: "Abnahmeprotokoll", url: "\\\\fs01\\daten\\Projekte\\KTE\\Abnahme.pdf" } } }] }] }] });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const c = await import("/src/lib/ki/connector.ts");
    const q = { typ: "connector", titel: "Laufwerk Y", url: "laufwerky", tage: 7, filter: "Y:\\Projekte\\KTE" } as never;
    return { a: await c.connectorAuszug(q, "Wann ist die Abnahme?", "tok") };
  });
  // Retrieval: Verbindung im Body, nur der Ordner Projekte/KTE (Laufwerksbuchstabe zählt nicht), Stellen mit Link
  const ret = anfragen.find((a) => a.pfad === "/v1.0/copilot/retrieval")!;
  expect(ret.body).toMatchObject({ dataSource: "externalItem", dataSourceConfiguration: { externalItem: { connections: [{ connectionId: "laufwerky" }] } }, queryString: "Wann ist die Abnahme?" });
  expect(r.a.text).toContain("#### Pflichtenheft KTE\nLink: file://fs01/daten/Projekte/KTE/Pflichtenheft.docx\nAbnahme bis 30.11.\n…\nAnsprechpartner Marcel Huck");
  expect(r.a.text).not.toContain("Gehalt");
  expect(r.a.fehler).toBeUndefined();
  // Ohne Retrieval-API: Microsoft-Suche, Markierungen entfernt
  retrieval = false;
  const s = await page.evaluate(async () => {
    const c = await import("/src/lib/ki/connector.ts");
    return c.connectorAuszug({ typ: "connector", titel: "Y", url: "laufwerky", tage: 7, filter: "" } as never, "Abnahme", "tok");
  });
  expect(s.text).toContain("#### Abnahmeprotokoll");
  expect(s.text).toContain("Die Abnahme erfolgt");
  expect(anfragen.find((a) => a.pfad === "/v1.0/search/query")!.body).toMatchObject({ requests: [{ entityTypes: ["externalItem"], contentSources: ["/external/connections/laufwerky"] }] });
  // Fehler: kein Zugriff, ungültige ID
  const f = await page.evaluate(async () => {
    const c = await import("/src/lib/ki/connector.ts");
    const fehler = async (url: string) => { try { const a = await c.connectorAuszug({ typ: "connector", titel: "Y", url, tage: 7, filter: "" } as never, "x", "tok"); return a.fehler ?? ""; } catch (e) { return (e as Error).message; } };
    return [await fehler("gesperrt"), await fehler("Y:\\Projekte")];
  });
  expect(f[0]).toContain("ExternalItem.Read.All");
  expect(f[1]).toContain("Keine gültige Verbindungs-ID");
});

test("Baukasten: Netzlaufwerk als Wissensquelle mit Verbindungs-ID und Ordner", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/baukasten?kopie=protokoll");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: /^Wissen/ }).click();
  await page.getByRole("button", { name: "Netzlaufwerk" }).first().click();
  await expect(page.getByLabel("Art der Quelle").last()).toHaveValue("connector");
  await expect(page.getByLabel("Bezeichnung der Quelle").last()).toHaveValue("Laufwerk Y");
  await page.getByLabel("Verbindungs-ID des Connectors").fill("laufwerky");
  await page.getByLabel("Nur dieser Ordner (optional)").fill("\\\\fs01\\daten\\Projekte\\KTE");
  await expect(page.getByText("Gefunden wird nur, was die angemeldete Person auf dem Laufwerk lesen darf.")).toBeVisible();
});
