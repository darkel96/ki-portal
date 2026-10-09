# KI-Hub

Internes KI-Portal: Applikationen als Kacheln, nach Bereichen gefiltert, und ein Baukasten, in dem Fachanwender eigene KI-Applikationen ohne Programmierung zusammenstellen. Die KI läuft zentral über Microsoft 365 Copilot (Microsoft Graph); Applikationen enthalten keine Verbindungsdaten.

Fachliches Konzept und Datenmodell: [KI-Baukasten-Konzept.md](KI-Baukasten-Konzept.md). Der frühere Einzeldatei-Prototyp liegt unter [prototyp/](prototyp/).

## Technik

React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, React Router, Zod (App-Schema), dnd-kit (Ziehen und Ablegen, auch per Touch und Tastatur), Motion (Animationen), DOMPurify (Bereinigung von KI-Ausgaben), MSAL (Anmeldung), mammoth / read-excel-file / pdf.js (Datei-Uploads lesen), JSZip (Dateipakete), pdfmake / docx / write-excel-file / pptxgenjs (Ergebnisse als PDF, Word, Excel, PowerPoint).

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
| `VITE_GRAPH_SCOPES` | Delegierte Graph-Berechtigungen, durch Leerzeichen getrennt |
| `VITE_APP_STORE` | `local` (Browser) oder `sharepoint` |
| `VITE_SP_SITE_ID`, `VITE_SP_ORDNER` | Nur bei `sharepoint`: Website und Ordner für die App-Dateien |

In der App-Registrierung als Redirect-URI (Typ „Single-page application“) `https://<host>/auth-redirect.html` eintragen.

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
- Ohne KI-Konfiguration läuft die Seite im Simulationsmodus. Eigene Apps und Mein Hub liegen im Browser der jeweiligen Nutzer.
- Lokal prüfen: `npm run build:pages` und `npx vite preview --mode pages`.

## Offen (mit der IT zu klären)

- App-Registrierung: bestehende Registrierung der EPLAN/Visio-Anbindung weiterverwenden oder eigene für den Hub
- Graph-Aufruf direkt aus dem Browser oder über einen Backend-Dienst (für Protokollierung und Mengenbegrenzung)
- Speicherort der Apps in SharePoint und Schreibrechte
- Microsoft-365-Copilot-Lizenzen für alle Nutzer
- Lizenzierte Hausschrift (`fontKoerber`) und offizielles Logo; Farben mit `vorlagen/koerber.potx` abgleichen
- Copilot-Endpunkte (teils Beta) vor Inbetriebnahme mit der aktuellen Graph-Dokumentation abgleichen
- Mein Hub im Betrieb: Speicher je Nutzer, Hintergrunddienst für regelmäßige Aufträge (z. B. Azure Function), Refresh-Token (`offline_access`) in Key Vault, Ziele E-Mail/SharePoint/Teams (siehe Konzept Abschnitt 24.4)

## Testfassung mit Claude

`npm run build:artifact` erzeugt eine Fassung für claude.ai (`dist-artifact/hub.html` samt `assets/`). Dort beantwortet Claude die KI-Anfragen statt Copilot (Testmodus). PDF-Lesen ist in dieser Fassung nicht verfügbar.
