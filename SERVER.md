# Hub-Dienst: Läufe und Aufträge ohne offenen Tab

Der KI-Hub ist eine reine Webseite: Jeder Lauf passiert im Browser der Person. Wird der Tab geschlossen oder der PC
ausgeschaltet, endet der Lauf. Der **Hub-Dienst** (`server/`) ändert das: Er führt Läufe und Aufträge auf dem
eigenen Linux-Server aus, im Namen der angemeldeten Person, und liefert den Hub gleich mit aus.

Was sich dadurch ändert:

- **Lauf starten, Tab zu.** Die App übergibt den Lauf an den Dienst und zeigt „Läuft im Hub-Dienst weiter“. Beim
  nächsten Öffnen der Applikation stehen Eingaben und Ergebnisse wieder da. Liegt der Tab nur im Hintergrund,
  meldet sich der Browser, sobald der Lauf fertig ist.
- **Aufträge laufen nach Zeitplan**, auch wenn niemand den Hub offen hat. Verpasste Termine (Dienst war aus) laufen
  einmal nach. Ziel „Per E-Mail an mich“ funktioniert (über Microsoft Graph).
- **Dienst-Neustart:** angefangene Läufe werden mit den fertigen Schritten fortgesetzt.
- Ohne Dienst (oder wenn er nicht antwortet) läuft alles wie bisher im Browser.

Die Ablauf-Logik ist dieselbe wie im Browser (`src/lib`), der Dienst setzt nur Anmeldung und Konfiguration anders ein.
Word, Excel, PDF und PowerPoint erzeugt weiterhin der Browser beim Öffnen des Ergebnisses.

## Aufbau

```
Browser (Hub)  ──Token für api://…/Laeufe.Ausfuehren──▶  Hub-Dienst (Node, Port 8787)
                                                          │  On-Behalf-Of: Graph-Token + Auffrischungs-Token
                                                          │  (verschlüsselt unter HUB_DATEN/nutzer/<id>/zugang.json)
                                                          ▼
                                                   Microsoft Graph / Copilot
```

Daten liegen als JSON-Dateien unter `HUB_DATEN`: `laeufe/<id>.json` (Lauf mit Eingaben und Ergebnissen),
`nutzer/<id>/auftraege.json` (Aufträge, Voreinstellungen, Abbild der Applikationen), `nutzer/<id>/zugang.json`
(verschlüsselte Anmeldung). Fertige Läufe werden nach `HUB_AUFBEWAHRUNG_TAGE` (Standard 30) gelöscht.

## Schnellstart auf dem Linux-Server (Docker)

Voraussetzungen: Docker mit Compose, ein DNS-Name für den Server (z. B. `ki-hub.firma.de`), Port 443 erreichbar.

```bash
git clone <Repository> ki-hub && cd ki-hub
cp server/.env.example server/.env        # ausfüllen, siehe unten
docker compose -f server/docker-compose.yml up -d --build
curl http://127.0.0.1:8787/api/dienst      # {"dienst":"KI-Hub", ...}
```

Davor gehört ein Reverse-Proxy mit HTTPS. Beispiel mit Caddy (`/etc/caddy/Caddyfile`), Zertifikate holt Caddy selbst:

```
ki-hub.firma.de {
    reverse_proxy 127.0.0.1:8787
}
```

Der Hub ist dann unter `https://ki-hub.firma.de/` erreichbar, der Dienst unter `/api`. GitHub Pages wird nicht mehr
gebraucht; die bisherige Adresse kann bleiben (siehe „Hub bleibt auf GitHub Pages“).

Aktualisieren: `git pull && docker compose -f server/docker-compose.yml up -d --build`. Die Daten liegen im
Volume `hub-daten` und bleiben erhalten. Protokoll: `docker compose -f server/docker-compose.yml logs -f`.

## Azure: Was in der App-Registrierung dazukommt

Der Dienst nutzt **dieselbe App-Registrierung** wie der Hub. Im Azure-Portal unter *Microsoft Entra ID → App-Registrierungen → KI-Hub*:

1. **Authentifizierung:** Weiterleitungs-URI (Typ „Single-page application“) für den neuen Host ergänzen:
   `https://ki-hub.firma.de/auth-redirect.html`.
2. **Zertifikate & Geheimnisse:** neuen geheimen Clientschlüssel anlegen, Wert sofort nach `HUB_CLIENT_SECRET`
   kopieren (er wird nur einmal angezeigt). Ablauf notieren und rechtzeitig erneuern.
3. **Eine API verfügbar machen:**
   - Anwendungs-ID-URI setzen (Vorschlag `api://<Client-ID>` übernehmen).
   - Bereich hinzufügen: Name `Laeufe.Ausfuehren`, Zustimmung „Administratoren und Benutzer“, Anzeigename
     „Läufe im KI-Hub-Dienst ausführen“, Beschreibung „Erlaubt dem KI-Hub-Dienst, Läufe und Aufträge im Namen der
     Person auszuführen.“
   - Unter „Autorisierte Clientanwendungen“ die eigene Client-ID mit diesem Bereich eintragen (dann erscheint keine
     zusätzliche Zustimmungsabfrage).
4. **API-Berechtigungen** (delegiert, Microsoft Graph): zu den sieben der Copilot-Chat-API kommen
   `Mail.Send` (Aufträge per E-Mail) und `offline_access` (der Dienst darf nach Ablauf des Tokens weiterarbeiten).
   Anschließend **Administratorzustimmung erteilen**.
5. Werte nach `server/.env`: `HUB_TENANT_ID`, `HUB_CLIENT_ID`, `HUB_CLIENT_SECRET`, dazu dieselben IDs als
   `VITE_ENTRA_CLIENT_ID` / `VITE_ENTRA_TENANT_ID` für den Hub.

Technischer Hintergrund: Der Browser holt sich bei Microsoft ein Token für `api://<Client-ID>/Laeufe.Ausfuehren`
und schickt es dem Dienst. Der prüft Unterschrift, Herausgeber, Empfänger und Ablauf und tauscht es per
**On-Behalf-Of** gegen ein Graph-Token samt Auffrischungs-Token. Damit arbeitet er weiter, solange die Person
Aufträge hat; abgemeldet wird mit `DELETE /api/konto` (Hub-Menü „KI-Anbindung“, folgt) oder durch Löschen der Datei.

## Hub bleibt auf GitHub Pages (Dienst nur für die API)

Soll der Hub weiter von GitHub Pages kommen, liefert der Dienst nur die API:

- `HUB_STATISCH` leer lassen, `HUB_URSPRUNG=https://darkel96.github.io` setzen (CORS).
- Im Hub die Adresse eintragen: `public/hub-config.json` → `"dienst": { "url": "https://ki-hub.firma.de" }`
  (oder beim Bauen `VITE_DIENST_URL`).

## Einstellungen

| Variable | Bedeutung |
|---|---|
| `HUB_PORT` | Port des Dienstes (Standard 8787) |
| `HUB_DATEN` | Verzeichnis für Läufe, Aufträge, Anmeldungen (im Container `/daten`) |
| `HUB_STATISCH` | Verzeichnis mit dem gebauten Hub, das der Dienst ausliefert (im Container `/app/dist`); leer = nur API |
| `HUB_TENANT_ID`, `HUB_CLIENT_ID`, `HUB_CLIENT_SECRET` | App-Registrierung |
| `HUB_API_SCOPE` | Berechtigung des Dienstes (Standard `api://<Client-ID>/Laeufe.Ausfuehren`) |
| `HUB_GRAPH_SCOPES` | Graph-Berechtigungen des Dienstes (Standard: Copilot-Chat-API plus `Mail.Send`) |
| `HUB_SCHLUESSEL` | 64 Hex-Zeichen für die Verschlüsselung der Anmeldungen (`openssl rand -hex 32`); fehlt er, legt der Dienst einen unter `HUB_DATEN/schluessel.json` an |
| `HUB_URSPRUNG` | Erlaubte Ursprünge (CORS), wenn der Hub woanders liegt |
| `HUB_PARALLEL` | Gleichzeitige Läufe (Standard 3) |
| `HUB_AUFBEWAHRUNG_TAGE` | Fertige Läufe so lange behalten (Standard 30) |
| `HUB_TESTMODUS` | `1` = Copilot-Attrappe, keine Microsoft-Anmeldung (nur lokal und in Tests) |

## Sicherheit und Datenschutz

- Das Client-Geheimnis liegt nur auf dem Server (`server/.env`, Rechte `600`). Niemals in den Hub bauen.
- Anmeldungen (Graph-Token und Auffrischungs-Token) liegen **verschlüsselt** (AES-256-GCM) unter `HUB_DATEN`.
  `HUB_SCHLUESSEL` getrennt davon sichern: Ohne Schlüssel sind die Ablagen wertlos, mit Schlüssel und Dateien
  kann jemand im Namen der Personen auf Graph zugreifen. Zugriff auf das Verzeichnis entsprechend beschränken.
- Läufe enthalten die Eingaben (auch den Text hochgeladener Dateien) und die Ergebnisse. Sie sind nur für die
  Person sichtbar, die sie gestartet hat, und werden nach der Aufbewahrungsfrist gelöscht.
- Der Dienst arbeitet ausschließlich im Namen der Person (delegierte Berechtigungen); er hat keine eigenen
  Rechte auf Daten im Tenant.
- Backup: das Verzeichnis `HUB_DATEN` (bzw. Volume `hub-daten`) plus `server/.env`.

## Schnittstelle (für die IT)

Alle Aufrufe außer `/api/dienst` brauchen `Authorization: Bearer <Token>`.

| Aufruf | Zweck |
|---|---|
| `GET /api/dienst` | Erreichbarkeit, Version, Testmodus, benötigte Berechtigung |
| `GET /api/konto`, `DELETE /api/konto` | Angemeldete Person; gespeicherte Anmeldung löschen |
| `POST /api/laeufe` | Lauf starten (App, Aktion, Eingaben) |
| `GET /api/laeufe?app=&auftraege=1&seit=` | Eigene Läufe |
| `GET /api/laeufe/{id}?ab=<version>` | Stand eines Laufs (nur Neues ab Version) |
| `DELETE /api/laeufe/{id}` | Laufenden Lauf abbrechen, fertigen löschen |
| `POST /api/laeufe/{id}/gesehen` | Ergebnis als gesehen markieren |
| `GET /api/auftraege`, `PUT /api/auftraege` | Aufträge der Person lesen/übergeben |
| `POST /api/auftraege/{id}/jetzt` | Auftrag sofort ausführen |

## Lokal ausprobieren (ohne Microsoft-Konto)

```bash
npm run build:server
HUB_TESTMODUS=1 npm run dienst          # Dienst mit Copilot-Attrappe auf Port 8787
npm run dev                             # Hub auf Port 5173
```

Im Browser (Konsole) die Adresse eintragen und neu laden: `localStorage.setItem("kihub-dienst-url", "http://localhost:8787")`.
Läufe zeigen dann „Läuft im Hub-Dienst weiter“; die Antworten kommen von der Attrappe. Die Tests in
`e2e/dienst.spec.ts` starten den Dienst im Testmodus selbst.
