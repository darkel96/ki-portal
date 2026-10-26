import { test, expect } from "@playwright/test";
import JSZip from "jszip";

/** Links haben überall einen sprechenden Text (keine Kennungen, Nummern, „owa“) und sind in Word, PDF und PowerPoint klickbar */
const OWA = "https://outlook.office365.com/owa/?ItemID=AAMkAGI2TG93AAA%3D&exvsurl=1&viewmodel=ReadMessageItem";
const OWA2 = "https://outlook.office365.com/owa/?ItemID=BBMkAGI2TG93BBB%3D&exvsurl=1&viewmodel=ReadMessageItem";
const TEAMS = "https://teams.microsoft.com/l/message/19:abc@thread.v2/1792743491983?context=%7B%7D";
const LISTE = "https://koerbercorp.sharepoint.com/sites/PROJECT_IT/Lists/Pipeline%20Done%20Projects/DispForm.aspx?ID=58";
const inner = Buffer.from(JSON.stringify({ u: LISTE, r: false })).toString("base64");
const LOOP = `https://loop.cloud.microsoft/p/${inner}`;

test("Linknamen: E-Mail, Teams, Liste, versteckte Adresse; Datei bleibt Dateiname", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const r = await page.evaluate(async (a) => {
    const v = await import("/src/lib/verweise.ts");
    return {
      owa: v.dokumentName(a.OWA), mail: v.dokumentName("https://outlook.office.com/mail/inbox/id/AAQkADU3"), termin: v.dokumentName("https://outlook.office.com/calendar/item/AAMkAD"),
      teams: v.dokumentName(a.TEAMS), chat: v.dokumentName("https://teams.microsoft.com/l/chat/19:x@unq.gbl.spaces/0"),
      liste: v.dokumentName(a.LISTE), loop: v.dokumentName(a.LOOP), datei: v.dokumentName("https://x.sharepoint.com/sites/KSC/Shared%20Documents/CRA_Cheat_Sheet.docx"),
      kennung: v.dokumentName("https://x.sharepoint.com/sites/A/1234567890123"),
      gruppe: v.verweiseAufloesen(`Termin steht fest. [1](${a.OWA})[2](${a.OWA2})[3](${a.TEAMS})`),
      benannt: v.linksBenennen(`Siehe [owa](${a.OWA}), [1792743491983](${a.TEAMS}), [Plan Q4](https://x.de/plan) und ${a.LISTE}.\n\n\`${a.OWA}\`\n\n\`\`\`\n${a.OWA}\n\`\`\``, [{ titel: "E-Mail: AW: Angebot 190014936", link: a.OWA }]),
      html: (await import("/src/lib/markdown.ts")).markdown(`Alt: [eyJ1IjoiaHR0cHM6Ly9rb2VyYmVyY29ycC5zaGFyZXBvaW50LmNvbS9zaXRlcy9QUk9KRUNU](${a.LOOP}) und [owa](${a.OWA})`),
    };
  }, { OWA, OWA2, TEAMS, LISTE, LOOP });
  expect(r.owa).toBe("E-Mail");
  expect(r.mail).toBe("E-Mail");
  expect(r.termin).toBe("Termin in Outlook");
  expect(r.teams).toBe("Teams-Nachricht");
  expect(r.chat).toBe("Teams-Chat");
  expect(r.liste).toBe("Liste „Pipeline Done Projects“, Eintrag 58");
  expect(r.loop).toBe("Liste „Pipeline Done Projects“, Eintrag 58");
  expect(r.datei).toBe("CRA Cheat Sheet.docx");
  expect(r.kennung).toBe("SharePoint");
  // Mehrere Nummern hintereinander: Aufzählung, gleiche Namen nummeriert
  expect(r.gruppe).toBe(`Termin steht fest. [E-Mail](${OWA}), [E-Mail 2](${OWA2}), [Teams-Nachricht](${TEAMS})`);
  // Bekannter Titel aus den Auszügen gewinnt; guter Text bleibt; nackte Adresse wird Link; Code bleibt unberührt
  const [zeile, , code, , zaun] = r.benannt.split("\n");
  expect(zeile).toBe(`Siehe [E-Mail: AW: Angebot 190014936](${OWA}), [Teams-Nachricht](${TEAMS}), [Plan Q4](https://x.de/plan) und [Liste „Pipeline Done Projects“, Eintrag 58](${LISTE}).`);
  expect(code).toBe(`\`${OWA}\``);
  expect(zaun).toBe("```");
  expect(r.benannt).toContain(`\`\`\`\n${OWA}\n\`\`\``);
  // Anzeige alter Ergebnisse: nichtssagende Linktexte werden ersetzt
  expect(r.html).toContain(">Liste „Pipeline Done Projects“, Eintrag 58</a>");
  expect(r.html).toContain(">E-Mail</a>");
  expect(r.html).not.toContain(">owa<");
  expect(r.html).not.toContain(">eyJ1Ijoi");
});

test("Word, PDF und PowerPoint: Links sind echte Hyperlinks mit sprechendem Text", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "einmal reicht");
  await page.goto("/");
  const md = `# Bericht\n\nDie Freigabe kam per [owa](${OWA}). Details im [Pflichtenheft KTE](https://x.sharepoint.com/sites/A/Pflichtenheft.docx) und unter ${LISTE}.\n\n- Teams: [1792743491983](${TEAMS})\n\n| Thema | Quelle |\n|---|---|\n| Angebot | [owa](${OWA}) |`;
  const r = await page.evaluate(async (md) => {
    const dok = await import("/src/lib/dokument.ts");
    const b64 = async (blob: Blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const meta = { titel: "Bericht", app: "Test" };
    return {
      laeufe: dok.laeufe("Siehe [owa](https://outlook.office365.com/owa/?ItemID=1) und **fett**."),
      docx: await b64(await dok.dateiErzeugen("docx", md, meta)),
      pptx: await b64(await dok.dateiErzeugen("pptx", md, meta)),
      pdf: await (await dok.dateiErzeugen("pdf", md, meta)).text(),
    };
  }, md);
  expect(r.laeufe).toEqual([{ text: "Siehe " }, { text: "E-Mail", link: "https://outlook.office365.com/owa/?ItemID=1" }, { text: " und " }, { text: "fett", fett: true }, { text: "." }]);
  const docx = await JSZip.loadAsync(Buffer.from(r.docx, "base64"));
  const xml = await docx.file("word/document.xml")!.async("string");
  const rels = await docx.file("word/_rels/document.xml.rels")!.async("string");
  expect((xml.match(/<w:hyperlink /g) ?? []).length).toBe(5);
  expect(xml).toContain(">E-Mail<");
  expect(xml).toContain(">Pflichtenheft KTE<");
  expect(xml).toContain(">Teams-Nachricht<");
  expect(xml).not.toContain("](");
  expect(xml).not.toContain(">owa<");
  expect(rels).toContain('TargetMode="External"');
  expect(rels).toContain("Pflichtenheft.docx");
  const pptx = await JSZip.loadAsync(Buffer.from(r.pptx, "base64"));
  const folien = await Promise.all(Object.keys(pptx.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).map((p) => pptx.file(p)!.async("string")));
  expect(folien.join("")).toContain("hlinkClick");
  expect(folien.join("")).not.toContain("](");
  // PDF: Link-Anmerkungen mit Adresse
  expect(r.pdf).toMatch(/\/URI\s*\(https:\/\/x\.sharepoint\.com\/sites\/A\/Pflichtenheft\.docx\)/);
});
