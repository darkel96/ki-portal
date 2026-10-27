import { test, expect, type Page } from "@playwright/test";

/** Agentenbibliothek: Agenten global anlegen, feinjustieren, ausprobieren; Agenten-Teams verknüpfen und bekommen beim Lauf die aktuelle Fassung */
async function kiNachbau(page: Page, antwort: string | ((prompt: string) => string)) {
  const prompts: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { content: string | { type: string; text?: string }[] }[] };
    const c = body?.messages?.[0]?.content ?? "";
    const prompt = typeof c === "string" ? c : c.map((t) => t.text ?? "").join("\n");
    prompts.push(prompt);
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const sse = [
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: typeof antwort === "function" ? antwort(prompt) : antwort } }),
      ev("content_block_stop", { index: 0 }), ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }), ev("message_stop", {}),
    ].join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: sse });
  });
  await page.addInitScript(() => localStorage.setItem("kihub-anthropic-key", "sk-ant-test"));
  return prompts;
}

test("Agenten: anlegen, feinjustieren, Probelauf; im Baukasten verknüpfen; Lauf nutzt die aktuelle Fassung", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  const prompts = await kiNachbau(page, "Drei Risiken: Termin, Budget, Schnittstellen.");
  await page.goto("/");
  await page.getByRole("link", { name: "Agenten" }).click();
  await expect(page.getByRole("heading", { name: "Agentenbibliothek" })).toBeVisible();
  await page.getByRole("button", { name: "Neuer Agent" }).click();
  await page.getByLabel("Name").fill("Prüfer global");
  await page.getByLabel("Kurzbeschreibung").fill("Sucht Lücken und Risiken");
  await page.getByLabel("Rolle").fill("Prüft Ergebnisse kritisch auf Lücken, Risiken und Widersprüche.");
  await page.getByLabel("Feinjustierung").fill("Nenne höchstens fünf Punkte, jeden mit Begründung.");
  // Probelauf nutzt Rolle und Feinjustierung
  await page.getByLabel("Aufgabe für den Probelauf").fill("Prüfe den Projektplan Retrofit.");
  await page.getByRole("button", { name: "Probelauf" }).click();
  await expect(page.getByText("Drei Risiken: Termin, Budget, Schnittstellen.")).toBeVisible();
  expect(prompts[0]).toContain("Du bist „Prüfer global“");
  expect(prompts[0]).toContain("Feinjustierung (gilt immer):\nNenne höchstens fünf Punkte");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/gespeichert\. Agenten-Teams/)).toBeVisible();
  const bib = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-agenten-v1") || "[]") as { id: string; name: string; hinweise: string }[]);
  expect(bib).toHaveLength(1);
  expect(bib[0].name).toBe("Prüfer global");
  // Baukasten: Teamagent aus der Bibliothek hinzufügen und einen eigenen in die Bibliothek aufnehmen
  await page.goto("/baukasten?kopie=agenten-team");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: /Agenten \(4\)/ }).click();
  await page.getByLabel("Aus der Bibliothek").click();
  await page.getByRole("option", { name: "Prüfer global" }).click();
  await expect(page.getByRole("tab", { name: /Agenten \(5\)/ })).toBeVisible();
  const neu = page.getByLabel("Name von Agent 5");
  await expect(neu).toHaveValue("Prüfer global");
  await expect(neu).toBeDisabled();
  await expect(page.getByLabel("Rolle von Prüfer global")).toHaveValue(/Feinjustierung \(gilt immer\)/);
  await page.getByRole("button", { name: "Planer: In die Bibliothek" }).click();
  await expect(page.getByText(/ist jetzt in der Agentenbibliothek/)).toBeVisible();
  await expect(page.getByLabel("Name von Agent 1")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Planer: Verknüpfung lösen" })).toBeVisible();
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  // Bibliothek: zwei Agenten, Nutzung in der gespeicherten App
  await page.goto("/agenten");
  await expect(page.getByRole("button", { name: /Planer/ })).toBeVisible();
  await page.getByRole("button", { name: /Prüfer global/ }).click();
  await expect(page.getByText(/Verwendet in: Agenten-Team \(Kopie\)/)).toBeVisible();
  // Feinjustierung ändern: der Lauf der App nutzt die neue Fassung, ohne die App zu speichern
  await page.getByLabel("Feinjustierung").fill("Antworte als Tabelle.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/gespeichert\. Agenten-Teams/)).toBeVisible();
  const eingesetzt = await page.evaluate(async () => {
    const ag = await import("/src/lib/agenten.ts");
    const apps = JSON.parse(localStorage.getItem("kihub-apps-v3") || "[]");
    const app = await ag.mitBibliotheksAgenten(apps[0]);
    return app.steps.find((s: { team?: unknown }) => s.team).team.agenten.map((a: { name: string; rolle: string; vorlage: string }) => [a.name, a.rolle.slice(-21), !!a.vorlage]);
  });
  expect(eingesetzt).toContainEqual(["Prüfer global", "Antworte als Tabelle.", true]);
  expect(eingesetzt).toContainEqual(["Planer", expect.stringContaining("Meilensteine vor."), true]);
  await page.screenshot({ path: `screenshots/${info.project.name}-agenten.png` });
});

test("Agenten: ohne Baukasten-Recht keine Bibliothek", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.addInitScript(() => localStorage.setItem("kihub-testnutzer", JSON.stringify({ id: "u1", name: "Max Muster", email: "max.muster@firma.de" })));
  await page.goto("/agenten");
  await expect(page.getByRole("heading", { name: "Dafür fehlt dir das Recht." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Agenten" })).toHaveCount(0);
});

test("Agent als Rolle eines KI-Schritts: Rolle als Agent speichern, in einer anderen App wählen, Feinjustierung wirkt beim Lauf", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  // KI: teilt die Rolle auf und stimmt die Aufgabe ab (Platzhalter bleiben)
  const prompts = await kiNachbau(page, (p) => p.includes("Teile die Rolle auf")
    ? JSON.stringify({ name: "Vertragsprüfer", beschreibung: "Prüft Projekte gegen den Vertrag", rolle: "Du bist ein sorgfältiger Projekt- und Vertragsüberwachungsassistent.", hinweise: "Erfinde keine Angaben.", aufgabe: "Beginne mit der Tabelle „Offene Punkte“." })
    : p.includes("Stimme die Aufgabe des Schritts")
      ? JSON.stringify({ aufgabe: `${/Aufgabe:\n"""\n([\s\S]*?)\n"""/.exec(p)?.[1] ?? ""}\nAbgestimmt.`, aenderungen: ["Doppelte Prüfregel gestrichen"] })
      : "ok");
  // App 1: eigene Rolle als Agent in die Bibliothek; die KI teilt sie in Agent und App-Teil auf
  await page.goto("/baukasten?kopie=protokoll");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: "Feineinstellungen" }).click();
  await page.getByLabel("Rolle und Regeln für die KI").fill("Du bist ein sorgfältiger Projekt- und Vertragsüberwachungsassistent. Erfinde keine Angaben. Beginne mit der Tabelle „Offene Punkte“.");
  await page.getByRole("button", { name: "Als Agent speichern" }).click();
  const dialog = page.getByRole("dialog", { name: "Als Agent speichern" });
  await expect(dialog.getByLabel("Name des Agenten")).toHaveValue("Vertragsprüfer");
  await expect(dialog.getByLabel("Feinjustierung (Regeln, die immer gelten)")).toHaveValue("Erfinde keine Angaben.");
  await expect(dialog.getByLabel("Kommt in die Aufgabe dieses Schritts")).toHaveValue("Beginne mit der Tabelle „Offene Punkte“.");
  await dialog.getByRole("button", { name: "Agent anlegen und verknüpfen" }).click();
  await expect(page.getByText(/ist jetzt in der Agentenbibliothek und hier als Rolle verknüpft\. Der App-Teil steht jetzt in der Aufgabe/)).toBeVisible();
  const gruppe = page.getByRole("group", { name: "Rolle von einem Agenten" });
  await expect(gruppe).toContainText("Rolle von Agent „Vertragsprüfer“");
  await expect(page.getByLabel("Rolle und Regeln für die KI")).toHaveCount(0);
  // Von selbst: Vorschlag, die Aufgabe auf den Agenten abzustimmen; Platzhalter bleiben erhalten
  const vorschlag = page.getByRole("group", { name: "Vorschlag für die Aufgabe" });
  await expect(vorschlag).toContainText("Doppelte Prüfregel gestrichen");
  await expect(vorschlag.getByLabel("Vorgeschlagene Aufgabe")).toHaveValue(/Beginne mit der Tabelle „Offene Punkte“\.\nAbgestimmt\.$/);
  await expect(vorschlag.getByRole("alert")).toHaveCount(0);
  await vorschlag.getByRole("button", { name: "Übernehmen" }).click();
  await expect(vorschlag).toHaveCount(0);
  await page.getByRole("tab", { name: "Aufgabe", exact: true }).click();
  await expect(page.getByLabel("Aufgabe für die KI")).toHaveValue(/Abgestimmt\.$/);
  expect(prompts.some((p) => p.includes("Teile die Rolle auf"))).toBe(true);
  const bib = await page.evaluate(() => JSON.parse(localStorage.getItem("kihub-agenten-v1") || "[]") as { id: string; name: string; rolle: string; hinweise: string }[]);
  expect(bib).toHaveLength(1);
  expect(bib[0].rolle).toContain("Vertragsüberwachungsassistent");
  expect(bib[0].hinweise).toBe("Erfinde keine Angaben.");
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  // App 2: denselben Agenten als Rolle wählen
  await page.goto("/baukasten?kopie=serviceangebot");
  await page.getByRole("tab", { name: /KI-Ablauf/ }).click();
  await page.getByRole("tab", { name: "Feineinstellungen" }).click();
  await page.getByLabel("Rolle von einem Agenten").click();
  await page.getByRole("option", { name: bib[0].name }).click();
  await expect(page.getByRole("group", { name: "Rolle von einem Agenten" })).toContainText(`Rolle von Agent „${bib[0].name}“`);
  // Auch hier schlägt der Hub von selbst eine abgestimmte Aufgabe vor; verwerfen lässt die Aufgabe, wie sie ist
  const vorschlag2 = page.getByRole("group", { name: "Vorschlag für die Aufgabe" });
  await expect(vorschlag2).toBeVisible();
  await vorschlag2.getByRole("button", { name: "Verwerfen" }).click();
  await expect(vorschlag2).toHaveCount(0);
  // Platzhalter, die ein Vorschlag verliert, werden genannt
  expect(await page.evaluate(async () => (await import("/src/lib/agentenabgleich.ts")).fehlendePlatzhalter("Kunde {{kunde}}, Thema {{thema}}", "Thema {{thema}}"))).toEqual(["kunde"]);
  await page.locator(".bar-speichern").click();
  await expect(page.getByText(/gespeichert/i).first()).toBeVisible();
  // Bibliothek: in beiden Apps verwendet; Feinjustierung ändern
  await page.goto("/agenten");
  await page.getByRole("button", { name: new RegExp(bib[0].name) }).click();
  await expect(page.getByText(/Verwendet in:/)).toContainText("Meeting-Protokoll (Kopie)");
  await page.getByLabel("Feinjustierung").fill("Antworte immer mit einer Tabelle.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/gespeichert\. Agenten-Teams/)).toBeVisible();
  // Beim Lauf gilt die neue Fassung in beiden Apps, ohne sie neu zu speichern
  const rollen = await page.evaluate(async (id) => {
    const ag = await import("/src/lib/agenten.ts");
    const apps = JSON.parse(localStorage.getItem("kihub-apps-v3") || "[]") as { steps: { agent: string; rolle: string }[] }[];
    const mit = apps.filter((a) => a.steps.some((s) => s.agent === id));
    return Promise.all(mit.map(async (a) => (await ag.mitBibliotheksAgenten(a as never)).steps.find((s: { agent: string }) => s.agent === id)!.rolle as string));
  }, bib[0].id);
  expect(rollen).toHaveLength(2);
  for (const r of rollen) { expect(r).toContain("Vertragsüberwachungsassistent"); expect(r).toContain("Feinjustierung (gilt immer):\nAntworte immer mit einer Tabelle."); }
});
