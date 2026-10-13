# KI-Hub

Internes KI-Portal: Applikationen als Kacheln, nach Bereichen gefiltert, und ein Baukasten, in dem Fachanwender eigene KI-Applikationen ohne Programmierung zusammenstellen. Die KI läuft zentral über Microsoft 365 Copilot (Microsoft Graph); Applikationen enthalten keine Verbindungsdaten.

Fachliches Konzept und Datenmodell: [KI-Baukasten-Konzept.md](KI-Baukasten-Konzept.md). Der frühere Einzeldatei-Prototyp liegt unter [prototyp/](prototyp/).

## Technik

React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, React Router, Zod (App-Schema), dnd-kit (Ziehen und Ablegen, auch per Touch und Tastatur), Motion (Animationen), DOMPurify (Bereinigung von KI-Ausgaben), MSAL (Anmeldung), Anthropic-SDK (Testmodus mit eigenem Schlüssel), mammoth / read-excel-file / pdf.js (Datei-Uploads lesen), JSZip (Dateipakete), pdfmake / docx / write-excel-file / pptxgenjs (Ergebnisse als PDF, Word, Excel, PowerPoint).

## Starten

```bash
npm install
npm run dev
```

Ohne Konfiguration läuft der Hub im **Simulationsmodus**: Apps zeigen die Anfrage, die an die KI ginge, und speichern im Browser.

## Konfiguration

Werte in `.env.local` eintragen (Vorlage: [.env.example](.env.example)):

| Variable | Bedeutung |
|---|---|
| `VITE_ENTRA_CLIENT_ID` | Client-ID der zentralen Azure-Anwendung (App-Registrierung) |
| `VITE_ENTRA_TENANT_ID` | Tenant-ID |
| `VITE_GRAPH_SCOPES` | Delegierte Graph-Berechtigungen, durch Leerzeichen getrennt; leer = die sieben der Copilot-Chat-API (siehe unten) |
| `VITE_APP_STORE` | `local` (Browser) oder `sharepoint` |
| `VITE_SP_SITE_ID`, `VITE_SP_ORDNER` | Nur bei `sharepoint`: Website und Ordner für die App-Dateien |

In der App-Registrierung als Redirect-URI (Typ „Single-page application“) `https://<host>/auth-redirect.html` eintragen.

## Anmeldung (Betrieb mit Copilot)

Ist die Copilot-Anbindung eingerichtet (Build-Umgebung), ist der Hub erst nach der Anmeldung mit dem Firmenkonto nutzbar. Der Ablauf ist auf „kein Klick“ ausgelegt:

1. **Still**: zuerst der Zwischenspeicher (angemeldet bleiben über Tabs und Neustarts), sonst Single Sign-on über die bestehende Microsoft-Sitzung des Browsers (höchstens 3 s).
2. **Automatische Weiterleitung**: klappt das nicht, leitet der Hub einmal je Browsersitzung zu Microsoft weiter (kein Pop-up, auch auf dem Handy). Mit angemeldetem Windows-/Microsoft-Konto geht das ohne Eingabe durch; zurück geht es auf dieselbe Seite.
3. **Anmeldemaske**: nur wenn die Weiterleitung mit einem Fehler zurückkommt oder abgebrochen wurde, erscheint eine Maske mit „Mit Firmenkonto anmelden“ und einem verständlichen Hinweis (technische Details für die IT kopierbar).

Die Weiterleitung nutzt die registrierte Seite `auth-redirect.html`; in der App-Registrierung ist nichts weiter nötig. „Abmelden“ im KI-Menü vergisst das Konto nur im Hub (die Microsoft-Sitzung bleibt). Eine im KI-Menü eingetragene Testverbindung leitet nie von selbst weiter, sondern zeigt die Maske.

## Copilot testen

Ohne Build-Konfiguration lässt sich Copilot direkt im Browser testen, z. B. am Firmenrechner auf der Testseite oder mit `npm run dev`:

1. **App-Registrierung** in Microsoft Entra ID (bestehende oder neue):
   - „Authentifizierung“ → Plattform **„Single-page application“** mit der Weiterleitungsadresse, die das KI-Menü anzeigt (z. B. `https://darkel96.github.io/ki-portal/auth-redirect.html` oder `http://localhost:5173/auth-redirect.html`). Als „Web“ eingetragen klappt die Anmeldung aus dem Browser nicht.
   - „API-Berechtigungen“ → Microsoft Graph, **delegiert**, alle sieben, die die Copilot-Chat-API verlangt: `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`, jeweils mit **Administratorzustimmung**. Für Bilder im Fachexperten-Chat dazu `Files.ReadWrite.AppFolder` (delegiert, nur der App-eigene OneDrive-Ordner), ebenfalls mit Administratorzustimmung; ohne sie funktionieren Chat und Dokument-Anhänge trotzdem.
   - Automatisch: [scripts/entra-einrichten.ps1](scripts/entra-einrichten.ps1) (PowerShell mit Azure CLI) legt die Registrierung „KI-Hub“ an oder erweitert eine bestehende (`-ClientId …`), trägt Weiterleitungsadressen und Berechtigungen ein und versucht die Administratorzustimmung.
2. Nutzer mit **Microsoft-365-Copilot-Lizenz**.
3. Im Hub oben rechts das KI-Menü öffnen → „Mit Copilot testen“ → Client-ID und Tenant-ID eintragen (bleiben im Browser) → „Verbindung testen“. Fehler werden mit Hinweis angezeigt, was in der Registrierung fehlt (z. B. AADSTS50011 = Weiterleitungsadresse fehlt, Graph 403 = Lizenz oder Berechtigung fehlt).

Die Copilot-Chat-API ist Beta (`/beta/copilot/conversations`); Microsoft unterstützt sie nicht für den Produktivbetrieb.

## Prüfseite und Dateipakete

Eine Applikation kann die Person prüfen und korrigieren lassen, was die KI gelesen hat (Vorbild: die
Serviceangebote-App auf CHARLESTOWN):

- Ein KI-Schritt mit Ausgabeformat „JSON-Daten“ liest z. B. eine hochgeladene Checkliste.
- Eingabefelder auf einer späteren Seite bekommen im Baukasten unter „Vorbelegen aus KI-Ergebnis“ den Pfad
  `schritt.feld` (etwa `lesen.produkte.wartungsvertrag.status`). Sobald der Schritt fertig ist, stehen die Werte in
  den Feldern; Auswahllisten werden auf ihre Optionen abgebildet. Was die Person von Hand ändert, bleibt
  bei einem erneuten Lauf erhalten. „Weiter“ auf eine solche Seite startet den Lese-Schritt von selbst, wenn er
  noch nicht gelaufen ist; ein Hinweis auf der Seite zeigt Laufen, Fehler und „Erneut versuchen“.
- Liefert die KI für ein Feld ein Objekt `{"wert", "hinweis", "klaeren"}`, steht der Hinweis unter dem Feld
  (z. B. Fundstelle) und `klaeren: true` markiert es gelb mit „Zu klären“, bis die Person es setzt.
- Schritte, deren Ergebnis nur Felder vorbelegt, erscheinen nicht als Kachel in der Ergebnisübersicht.

## Fachexperten-Chat

Der Baustein „Chat“ (Gruppe KI) macht einen KI-Schritt zum Gesprächspartner: Rolle, Wissen, Quellen und Wissensmodus
stehen am Schritt, die erste Frage geht mit Rolle, Wissen und Auszügen aus den Quellen an die KI, die Antwort wächst
sichtbar mit. Bei Copilot wird dasselbe Gespräch weitergeführt, Folgefragen bleiben kurz. Quellen nennt der Experte als
Link, der in einem neuen Tab öffnet. Im Chat lassen sich Dateien und Bilder anhängen (Büroklammer, Einfügen aus der
Zwischenablage oder Ablegen im Chat): Word, Excel, PDF und Text gehen als Text mit, Bilder beim eigenen Schlüssel direkt
als Bild, bei Copilot als Datei über den App-Ordner in OneDrive (braucht die zusätzliche delegierte Berechtigung `Files.ReadWrite.AppFolder` mit Administratorzustimmung). Mit dem Mikrofon
lässt sich eine Frage diktieren (Spracherkennung des Browsers, Chrome und Edge). Der Schritt läuft nie im Durchlauf, nur auf Frage. Vorlage: „Fachexperte Cyber Resilience Act“ mit
Belegregel (nur aus Unterlagen, Quelle nennen, Unbelegtes als solches sagen); die Unterlagen trägt man unter
App-Einstellungen → Wissen ein.

## Wissen steuern

- **App-Einstellungen → Wissen:** Modus für alle Schritte („Nur Eingaben und hinterlegte Quellen“, „Zusätzlich Wissen
  aus Microsoft 365“, „Zusätzlich Websuche“), Hintergrundwissen als Text und Wissensquellen (SharePoint-Bereich,
  einzelne Datei, Webseite). Einzelne KI-Schritte können im Reiter „Wissen“ davon abweichen und eigene Quellen ergänzen.
- **Quellen wirken:** Vor jedem Schritt holt der Hub passende Auszüge aus SharePoint-Bereichen (Copilot Retrieval API)
  und den Inhalt einzelner Dateien und hängt sie der Anfrage an (`src/lib/ki/wissen.ts`). Webseiten bleiben ein Hinweis.
- **Wissensbibliothek:** Mit dem Lesezeichen an einer Quelle landet sie in der Bibliothek (`src/lib/wissensbibliothek.ts`,
  im Browser) und ist in jeder App über „Aus der Wissensbibliothek …“ wählbar.
- Der Modus ist eine Anweisung an Copilot; technisch abschaltbar ist nur die Websuche.
- Ein Ergebnis-Element kann mit „Nur diesen Teil zeigen“ einen Teil des JSON als Text, Liste oder Tabelle zeigen.
- Buttons starten einzelne Schritte („Nur: …“), mehrere Schritte oder „Ab: …“ bis zum Ende; die Ergebnisübersicht
  startet dann nur die Schritte ihrer Kacheln, nicht den Lese-Schritt.
- Ausgabeformat „Dateipaket (ZIP)“ erzeugt eine Ordnerstruktur zum Herunterladen; Dateien mit Endung .docx,
  .xlsx, .pdf oder .pptx werden aus Markdown erzeugt.
- Word-Dateien werden mit Kästchen gelesen: angekreuzt ☒, leer ☐ (Inhaltssteuerelemente, alte Formularfelder,
  Wingdings-Symbole und gezeichnete Kästchen, also kleine Textfelder mit „x“ wie in der Service-Checkliste),
  Tabellen zeilenweise mit „|“.

Die Vorlage „Serviceangebot vorbereiten“ zeigt den ganzen Ablauf: Checkliste hochladen, lesen, prüfen und
korrigieren, Hinweise von Copilot (plausibilisieren, unklare Kästchen, Rückfrage), Zusammenfassung als Word
und Angebotsstruktur als ZIP. Die Produktliste steht in `src/lib/seedServiceangebot.ts` (`SA_PRODUKTE`).

## Prüfen

```bash
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Die Playwright-Tests prüfen Startseite, App-Ansicht und Baukasten (inklusive Ziehen und Ablegen) in 1440 px und 390 px Breite und legen Screenshots in `screenshots/` ab.

## Betrieb

`npm run build` erzeugt `dist/`. Für Azure Static Web Apps liegt die Konfiguration (SPA-Weiterleitung, Sicherheits-Header, CSP) in [public/staticwebapp.config.json](public/staticwebapp.config.json).

## Web-App auf GitHub Pages

Jeder Push auf `main` baut den Hub und veröffentlicht ihn über GitHub Actions (`.github/workflows/pages.yml`, Build-Modus `pages`: relative Pfade, Adressen über `#/…`, weil Pages keine SPA-Weiterleitung kennt). Adresse: https://darkel96.github.io/ki-portal/

- Die Seite ist öffentlich erreichbar, auch wenn das Repository privat ist (Zugriffsschutz für Pages gibt es nur mit GitHub Enterprise). Für den Betrieb im Unternehmen ist Azure Static Web Apps mit Entra-ID-Anmeldung vorgesehen.
- Ohne KI-Konfiguration läuft die Seite im Simulationsmodus. Zum Testen mit echter KI trägt jede Person oben rechts im KI-Menü ihren eigenen Anthropic-API-Schlüssel ein (bleibt im Browser, Kosten über das eigene Konto); dann antwortet Claude Opus 5.5. Eigene Apps und Mein Hub liegen im Browser der jeweiligen Nutzer.
- Lokal prüfen: `npm run build:pages` und `npx vite preview --mode pages`.

## Offen (mit der IT zu klären)

- App-Registrierung: bestehende Registrierung der EPLAN/Visio-Anbindung weiterverwenden oder eigene für den Hub
- Graph-Aufruf direkt aus dem Browser oder über einen Backend-Dienst (für Protokollierung und Mengenbegrenzung)
- Speicherort der Apps in SharePoint und Schreibrechte
- Microsoft-365-Copilot-Lizenzen für alle Nutzer
- Lizenzierte Hausschrift (`fontKoerber`); Farben mit `vorlagen/koerber.potx` abgleichen (Logo ist eingebunden)
- Copilot-Endpunkte (teils Beta) vor Inbetriebnahme mit der aktuellen Graph-Dokumentation abgleichen
- Mein Hub im Betrieb: Speicher je Nutzer, Hintergrunddienst für regelmäßige Aufträge (z. B. Azure Function), Refresh-Token (`offline_access`) in Key Vault, Ziele E-Mail/SharePoint/Teams (siehe Konzept Abschnitt 24.4)

## Testfassung mit Claude

`npm run build:artifact` erzeugt eine Fassung für claude.ai (`dist-artifact/hub.html` samt `assets/`). Dort beantwortet Claude die KI-Anfragen statt Copilot (Testmodus). PDF-Lesen ist in dieser Fassung nicht verfügbar.
