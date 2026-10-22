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
| `VITE_SP_ORDNER_URL` | Gemeinsamer Speicher: Adresse eines SharePoint-Ordners (leer = Browser bzw. `public/hub-config.json`) |
| `VITE_ADMINS` | Feste Verwaltung, E-Mails mit Komma (Standard `dario.keller@koerber.com`) |
| `VITE_DIENST_URL` | Adresse des Hub-Dienstes, wenn er den Hub nicht selbst ausliefert (sonst `public/hub-config.json` → `dienst.url`) |

In der App-Registrierung als Redirect-URI (Typ „Single-page application“) `https://<host>/auth-redirect.html` eintragen.

## Hub-Dienst: Läufe ohne offenen Tab

Mit dem Hub-Dienst (`server/`) laufen Läufe und Aufträge auf dem eigenen Linux-Server weiter, auch wenn der Tab
geschlossen oder der PC aus ist; Aufträge laufen nach Zeitplan und gehen auf Wunsch per E-Mail raus. Einrichtung,
Azure-Schritte und Betrieb: [SERVER.md](SERVER.md). Ohne Dienst läuft alles wie bisher im Browser.

## Lernschicht für Fachexperten-Chats

Ein Chat-Experte lernt nicht im Modell, sondern über das System drumherum: Die Rolle (Tonfall, Belegregel) bleibt
fest; dazu kommt je KI-Schritt ein Block **Hausregeln**, der nur durch Freigabe wächst. Unter jeder Antwort gibt es
Daumen hoch/runter mit Kommentar, Antworten ohne Fundstelle werden vermerkt. Im Baukasten (Reiter „Lernen“) wertet
die KI die Rückmeldungen aus und macht Vorschläge (Begriffe, häufige Fragen, Hausregeln); eine Person nimmt an, ändert
oder verwirft. Jede Übernahme ist eine Fassung mit Datum und Grund und lässt sich zurückdrehen. Mit Hub-Dienst liegen
Rückmeldungen zentral und die Auswertung läuft von selbst, sobald genug neue da sind.

Die Hausregeln sind Kontext, kein Wissen: Sie stehen in der Anfrage nach der Wissensgrenze und sagen der KI
ausdrücklich, dass die Antwort weiterhin aus den Auszügen der Quellen kommt und ein Begriff aus den Hausregeln die
Suche in den Unterlagen nie ersetzt. Sagt eine Antwort „nichts gefunden“, steht der Grund sichtbar darunter: Quelle
ohne Adresse, Quelle nicht lesbar, keine Treffer zur Suche oder gelesen, aber ohne Beleg; „Was die KI bekommen hat“
zeigt die Einzelheiten. Eine Quelle ohne Adresse zählt nicht als fehlende Unterlage.

**Häufige Fragen:** Freigegebene Frage-Antwort-Paare (aus der Auswertung, aus dem Chat per „Als häufige Frage
vorschlagen“ oder von Hand) beantwortet der Experte sofort, ohne KI, mit Hinweis „Gespeicherte Antwort“; ein Klick
fragt trotzdem die KI. Das spart Wartezeit bei wiederkehrenden Fragen.

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

### Tabelle

Der Baustein **Tabelle** (Palette, Gruppe „Eingaben“) ist für Listen mit wechselnder Zeilenzahl, etwa die Positionen
einer Kalkulation, und daneben Spalten zum Eintragen, etwa Stunden je Gewerk.

- **Spalten** legt man im Baukasten an: Titel, Typ (Text, Zahl, Datum), Werte „Aus dem KI-Ergebnis“ oder „Trägt die
  Person ein“, bei Zahlen optional eine Summenzeile. Der Schlüssel jeder Spalte folgt ihrem Titel.
- **Zeilen** kommen aus einer Liste im JSON-Ergebnis eines Lese-Schritts: „Vorbelegen aus“ `lesen.positionen`, jedes
  Objekt eine Zeile. Den Aufbau der Liste mit den Schlüsseln der KI-Spalten bekommt der Lese-Schritt automatisch
  in seine Aufgabe. Schreibweise der Schlüssel ist egal, leere Zeilen fallen weg.
- Werte aus dem KI-Ergebnis sind nur lesbar, außer „dürfen korrigiert werden“ ist gesetzt. Zeilen lassen sich von
  Hand ergänzen und löschen. Mit „weitere Zahlenspalten anlegen“ fügt die Person beim Ausfüllen eigene Spalten
  hinzu, z. B. je Mitarbeiter, jeweils mit Summe.
- Enter springt in dieselbe Spalte der nächsten Zeile. Zahlen dürfen deutsch („1.234,5“) oder mit Punkt geschrieben
  werden. Kopf- und Summenzeile bleiben stehen, nur die Zeilen scrollen. Steht die Tabelle allein auf ihrer Seite,
  nutzt sie die volle Höhe.
- Spätere Schritte bekommen die Tabelle über `{{key}}` als Markdown-Tabelle samt Summenzeile. Pflicht heißt:
  mindestens eine Zeile.

## Fachexperten-Chat

Der Baustein „Chat“ (Gruppe KI) macht einen KI-Schritt zum Gesprächspartner: Rolle, Wissen, Quellen und Wissensmodus
stehen am Schritt, die erste Frage geht mit Rolle, Wissen und Auszügen aus den Quellen an die KI, die Antwort wächst
sichtbar mit. Bei Copilot wird dasselbe Gespräch weitergeführt, Folgefragen bleiben kurz. Quellen nennt der Experte als
Link, der in einem neuen Tab öffnet. Im Chat lassen sich Dateien und Bilder anhängen (Büroklammer, Einfügen aus der
Zwischenablage oder Ablegen im Chat): Word, Excel, PDF und Text gehen als Text mit, Bilder beim eigenen Schlüssel direkt
als Bild, bei Copilot als Datei über den App-Ordner in OneDrive (braucht die zusätzliche delegierte Berechtigung `Files.ReadWrite.AppFolder` mit Administratorzustimmung). Mit dem Mikrofon
lässt sich eine Frage diktieren (Spracherkennung des Browsers, Chrome und Edge). Steht in einer Frage ein SharePoint-Link
auf eine Datei, liest der Experte diese Datei direkt, auch Office-Links aus der Adressleiste (`Doc.aspx?…&file=…`).
Verweisen die gefundenen Stellen auf ein anderes Dokument, schlägt der Experte dort nach (bis zu zwei weitere
Suchdurchläufe je Frage) und antwortet erst dann. Der Schritt läuft nie im Durchlauf, nur auf Frage. Vorlage: „Fachexperte Cyber Resilience Act“ mit
Belegregel (nur aus Unterlagen, Quelle nennen, Unbelegtes als solches sagen); die Unterlagen trägt man unter
App-Einstellungen → Wissen ein.

## Agentenbibliothek

Unter **Agenten** (Navigation, für alle mit Baukasten-Recht) werden Agenten einmal global angelegt: Name,
Kurzbeschreibung, Rolle und eine **Feinjustierung** (Regeln, Tonfall, Grenzen, die immer gelten). Ein Probelauf zeigt,
wie der Agent mit dem ungespeicherten Stand antwortet. Im Baukasten holt ein Agenten-Team Agenten „Aus der Bibliothek“
oder nimmt einen eigenen Teamagenten „In die Bibliothek“ auf; verknüpfte Agenten sind im Team schreibgeschützt und
bekommen beim Lauf (Browser, Mein Hub und Hub-Dienst-Start) Name und Rolle aus der Bibliothek. Eine Feinjustierung
wirkt damit sofort in allen Apps, ohne sie neu zu speichern. „Verknüpfung lösen“ macht die aktuelle Fassung zur eigenen
Kopie; wird ein Bibliotheksagent gelöscht, behalten Teams die zuletzt gespeicherte Fassung. Ablage wie die Apps:
im Browser oder im gemeinsamen SharePoint-Ordner (`agenten/`).

## Postfach (Microsoft 365)

Der Baustein **Postfach** (Palette, Gruppe „Microsoft 365“) zeigt das Postfach der angemeldeten Person wie in Outlook:
links die Ordner (bekannte zuerst, Unterordner aufklappbar), in der Mitte die Nachrichten des gewählten Ordners mit
Absender, Datum, Betreff, Anhang und Vorschau, rechts die geöffnete Nachricht (HTML bereinigt). Suche im Ordner und
„Mehr laden“ für ältere Nachrichten. Erster Schritt, nur lesen: Microsoft Graph `me/mailFolders` und `me/messages`
mit der delegierten Berechtigung Mail.Read, die die Copilot-Anbindung ohnehin verlangt. Ohne Copilot-Anbindung zeigt
der Baustein ein Beispielpostfach. Einstellbar: Titel, Nachrichten je Seite, Vorschau.

**KI zur geöffneten Mail:** Unter der Nachricht stehen „Zusammenfassen“, „Antwort entwerfen“, „Aufgaben herausziehen“,
„Übersetzen“ und eine freie Frage; die Mail (Kopf und Text) geht als Kontext mit. Ein Antwortentwurf lässt sich als
Entwurf in Outlook anlegen (Antwort an den Absender, Original darunter). **Prozeduren:** „Mails zu Thema X der letzten
N Tage in Ordner Y ablegen“, vordefiniert am Baustein oder ad hoc. Der Hub holt die Mails des Zeitraums (ohne Gelöschte,
Junk, Entwürfe, Gesendete), wählt per Wortsuche und auf Wunsch per KI thematisch aus, zeigt die Auswahl zur Bestätigung
(an- und abwählbar) und verschiebt dann; der Zielordner wird angelegt, wenn es ihn nicht gibt. Verschieben, Ordner und
Entwürfe brauchen die delegierte Berechtigung Mail.ReadWrite (Zustimmung beim ersten Mal im Anmeldefenster).

## Rechte und Verwaltung

**Applikationen verwalten:** In der Verwaltung stehen alle Applikationen in einer Tabelle: eigene bearbeiten, sperren,
löschen; mitgelieferte Vorlagen übernehmen (die bearbeitete Fassung ersetzt unter derselben ID das Original, Links und
Mein Hub bleiben gültig) oder aus dem Hub nehmen (und jederzeit wieder einblenden). Dieselben Aktionen bietet die
App-Seite: „Im Baukasten bearbeiten“ bzw. für die Verwaltung „Vorlage übernehmen und bearbeiten“, „Sperren“ und
„Löschen“. Eine gesperrte Applikation (Status „Gesperrt“) können nur noch Personen mit Bearbeiten-Recht öffnen; alle
anderen sehen einen Hinweis. „Entsperren“ setzt sie auf „Freigegeben“. Gelöschte Applikationen landen im
**Papierkorb** (Browser bzw. SharePoint-Ordner `papierkorb/`), bleiben dort 30 Tage und lassen sich in der Verwaltung
wiederherstellen; direkt nach dem Löschen bietet der Hinweis „Rückgängig“ an.

- **Personen:** Wer sich mit dem Firmenkonto anmeldet, erscheint in der Verwaltung (Menüpunkt „Verwaltung“, nur für
  die Verwaltung sichtbar). Feste Verwaltung ist die Pilotleitung (`VITE_ADMINS`, Standard `dario.keller@koerber.com`);
  sie hat alle Rechte und kann sie nicht verlieren.
- **Globale Rechte:** „Verwaltung“ (alles), „Baukasten“ (Applikationen bauen und bearbeiten), „KI-Assistent“
  (Applikationen per Beschreibung bauen lassen), „Freigeben“ (Status „Freigegeben“ setzen). Ohne Baukasten-Recht gibt es
  keinen Baukasten-Menüpunkt, kein „Als Kopie im Baukasten öffnen“ und keine „Neue Applikation“. Personen lassen sich
  per E-Mail vormerken, bevor sie sich zum ersten Mal anmelden.
- **Feste Rechte ohne gemeinsamen Speicher:** `public/hub-config.json` → `"rechte": {"e-mail": ["bauen", "assistent", "freigeben", "admin"]}`
  gilt in jedem Browser (die Datei wird mit der Seite veröffentlicht). In der Verwaltung sind diese Rechte nicht
  abwählbar. Übergangslösung, bis der SharePoint-Ordner eingerichtet ist; Apps bleiben bis dahin im jeweiligen Browser.
- **Rechte je Applikation** (Baukasten → App-Einstellungen → Freigabe): „Bearbeiten dürfen“ und „Nutzen dürfen“ als
  Personenliste. Wer eine App anlegt, darf sie immer bearbeiten; leere Nutzen-Liste heißt alle; die Verwaltung darf immer.
  Wer nicht nutzen darf, sieht die App nicht in der Übersicht.
- **Speicher:** wie die Applikationen im gemeinsamen SharePoint-Ordner (siehe unten), sonst im Browser. Ohne Anmeldung
  (Simulation, eigener Schlüssel) gelten keine Einschränkungen; zum Testen setzt
  `localStorage.kihub-testnutzer = {"id","name","email"}` eine Testperson.

## Git-Speicher (Repository des Hubs)

Neben Browser und SharePoint gibt es einen dritten gemeinsamen Speicher: JSON-Dateien im Repository unter
`public/hub-daten/` (`apps.json`, `agenten.json`, `papierkorb.json`, `rechte.json`, je Sammlung eine Datei mit
id → Inhalt). Sie werden mit der Seite veröffentlicht; **lesen** kann sie damit jedes Gerät ohne Anmeldung.
**Schreiben** geht über die GitHub-Contents-API mit einem persönlichen Token (fein abgestuft, nur dieses Repository,
„Contents: Read and write“), den eine Person in der Verwaltung hinterlegt; er bleibt in ihrem Browser. Jedes Speichern
ist ein Commit auf den Branch, danach veröffentlicht GitHub Pages die Seite neu (etwa eine Minute); andere Geräte sehen
den Stand nach dem nächsten Laden. Ohne Token bleiben eigene Änderungen im Browser, gemeinsame Daten werden gelesen;
„In den Git-Speicher übernehmen“ bringt Apps, Agenten und Rechte aus dem Browser ins Repository. Konfiguration für
alle in `public/hub-config.json` unter `speicher.git` (`repo`, `branch`, `pfad`), zum Testen je Browser in der
Verwaltung. Anmeldungen bleiben im Git-Speicher im Browser (jede Anmeldung wäre sonst ein Commit).

## Gemeinsamer Speicher (SharePoint)

Ohne Einrichtung liegen Applikationen und Rechte nur im Browser. Für den gemeinsamen Betrieb:

1. Einen Ordner in einer SharePoint-Bibliothek anlegen, z. B. `…/Freigegebene Dokumente/KI-Hub`.
2. In der App-Registrierung die delegierte Berechtigung `Sites.ReadWrite.All` ergänzen und die Administratorzustimmung
   erteilen (Lesen braucht nur das vorhandene `Sites.Read.All`).
3. In SharePoint die Rechte setzen: alle lesen; Schreiben in `apps/` nur, wer bauen darf; `rechte.json` nur die
   Verwaltung; in `anmeldungen/` alle. So setzt SharePoint die Rechte des Hubs auch technisch durch.
4. Verwaltung → „Gemeinsamer Speicher“: Ordneradresse eintragen, „Verbindung prüfen“, „In diesem Browser verwenden“,
   dann „In den SharePoint-Ordner übernehmen“ (bringt Apps und Rechte aus dem Browser mit).
5. Für alle einschalten: die Ordneradresse in `public/hub-config.json` unter `speicher.ordner` eintragen (oder Build-
   Variable `VITE_SP_ORDNER_URL`) und veröffentlichen.

Aufbau des Ordners: `apps/<id>.json` je App, `rechte.json`, `anmeldungen/<email>.json` je Person. Jede Anmeldung schreibt
nur ihre eigene Datei, gleichzeitige Anmeldungen überschreiben also nie die Rechte. Ohne Schreibrecht bleibt die Anmeldung
still unvermerkt, es öffnet sich kein Fenster.

## Wissen steuern

- **App-Einstellungen → Wissen:** Modus für alle Schritte („Nur Eingaben und hinterlegte Quellen“, „Zusätzlich Wissen
  aus Microsoft 365“, „Zusätzlich Websuche“), Hintergrundwissen als Text und Wissensquellen (SharePoint-Bereich,
  einzelne Datei, Webseite). Einzelne KI-Schritte können im Reiter „Wissen“ davon abweichen und eigene Quellen ergänzen.
- **Quellen wirken:** Vor jedem Schritt holt der Hub passende Auszüge aus SharePoint-Bereichen (Copilot Retrieval API)
  und den Inhalt einzelner Dateien und hängt sie der Anfrage an (`src/lib/ki/wissen.ts`). Webseiten bleiben ein Hinweis.
  Damit keine Datei unsichtbar bleibt, gilt für jeden Agenten: Der Hub listet die Dateien eines Bereichs (Inventar über
  die SharePoint-Suche mit `path:`, jede Tiefe, höchstens 400; Text- und Excel-Dateien eigens abgefragt; geht die Suche
  nicht, durch die Ordner bis drei Ebenen) und gibt die Liste der KI mit, damit sie Dateien nennen oder nachschlagen kann.
  Textdateien (.md, .txt, .csv, .json …) und **Excel** (.xlsx) wertet die Retrieval API nicht aus; der Hub liest sie
  selbst (höchstens 40, passende Dateinamen zuerst, je bis 5 MB), Excel Zeile für Zeile als „Spalte: Wert“ (Kopfzeile =
  Zeile mit den meisten Werten, Titelzeilen darüber gehen mit). Word und PDF, deren Dateiname zur Frage
  passt, liest er zusätzlich ganz (höchstens drei). Retrieval-Stellen (Suche nach Bedeutung) und die selbst gelesenen
  Dateien (Wortsuche, findet auch Namen, Kürzel und Tabellenzeilen) werden gleichzeitig geholt und zusammengelegt:
  kleine Bestände ganz, große als die passenden Abschnitte mit Überschrift als Fundstelle; seltene Suchwörter zählen
  mehr als häufige, Wörter werden auf ihren Stamm gekürzt (namen → name); Tabellen zählen Zeile für Zeile, damit alle
  passenden Zeilen mitkommen, und 40 % des Platzes sind für sie reserviert (sonst verdrängen lange Abschnitte sie, wenn
  mehrere Fragen auf einmal kommen). Die selbst gelesenen Stellen stehen vor den Retrieval-Stellen (gekürzt wird hinten). Bei
  Fragen nach Personen nennt jeder Agent die Namen aus Tabellen und Listen vollständig, bei Zuständigkeit auch Leitung
  und Verantwortliche (`PERSONEN_REGEL`), auch in anderer Schreibweise wie „Software R&D“ (`VARIANTEN_REGEL`);
  mehrdeutige Begriffe benennt er mit seiner Lesart (`MEHRDEUTIG_REGEL`); falsche Annahmen in der Frage stellt er mit
  Beleg richtig (`ANNAHMEN_REGEL`); Empfehlungen und Zusammenfassungen leitet er aus Belegtem ab und kennzeichnet sie
  (`ABLEITUNG_REGEL`); Quellen
  verlinkt er auf das Dokument, nie auf die Bibliothek, jede einmal (`QUELLEN_REGEL`). Diese Regeln gelten für jeden
  Agenten mit Wissensquellen, unabhängig von seiner Rolle. Je SharePoint-Bereich gehen höchstens 24.000 Zeichen und
  12 Retrieval-Stellen an Copilot (`MAX_BEREICH`, auch nach dem Nachschlagen; einzelne Dateien bis 40.000): mehr Text
  lässt Copilot spürbar später anfangen. Beim Öffnen
  einer App lädt der Hub Inventar und Dateien vor (nur mit stiller Anmeldung), die Konsole zeigt je Frage die Zeiten
  (`[Wissen] … Inventar · Dateien · Bedeutungssuche`). **Sammelfragen:** Stehen mehrere nummerierte Fragen in einer
  Nachricht („1. … 2. …“, `teilfragen`), sucht der Hub je Frage getrennt und gleichzeitig; Tabellenzeilen bekommen einen
  gemeinsamen Teil (30 %), der Rest wird gleichmäßig auf die Fragen verteilt. Die Zerlegung läuft lokal, ohne KI.
  Alles läuft mit der Anmeldung der fragenden Person, SharePoint prüft die Rechte. Inventar und gelesene Dateien
  bleiben zehn Minuten im Speicher, **je Person getrennt** (`nutzerKennung`, im Hub-Dienst die Person des Laufs; ohne
  bekannte Person wird nichts gespeichert). Ebenso der Vorrat an Copilot-Gesprächen.
  Adressen aus der Bibliotheksansicht (`…/Forms/…aspx?id=/sites/…`)
  werden in die direkte Ordner- bzw. Dateiadresse umgewandelt, auch wenn sie in einer Chat-Frage stehen.
- **Wissensbibliothek:** Mit dem Lesezeichen an einer Quelle landet sie in der Bibliothek (`src/lib/wissensbibliothek.ts`,
  im Browser) und ist in jeder App über „Aus der Wissensbibliothek …“ wählbar.
- Der Modus ist eine Anweisung an Copilot; technisch abschaltbar ist nur die Websuche.
- Ein Ergebnis-Element kann mit „Nur diesen Teil zeigen“ einen Teil des JSON als Text, Liste oder Tabelle zeigen.
- Buttons starten einzelne Schritte („Nur: …“), mehrere Schritte oder „Ab: …“ bis zum Ende; die Ergebnisübersicht
  startet dann nur die Schritte ihrer Kacheln, nicht den Lese-Schritt.
- Ausgabeformat „Dateipaket (ZIP)“ erzeugt eine Ordnerstruktur zum Herunterladen; Dateien mit Endung .docx,
  .xlsx, .pdf oder .pptx werden aus Markdown erzeugt.
- **Vorlage für Aufbau und Design** (KI-Schritt → Feineinstellungen): Beispieldatei hochladen (Word, PDF, Markdown,
  Text) oder Gerüst selbst schreiben. Die KI übernimmt Gliederung, Tabellen und Tonfall, nicht die Beispielinhalte.
  Mit einer Word-Vorlage (.docx/.dotx bis 1 MB) bekommt die erzeugte Word-Datei deren Design: Seitenformat, Kopf-
  und Fußzeile mit Logo, und für den Inhalt klont der Hub echte Beispielabsätze der Vorlage (Titelzeile, jede
  Kapitelebene, Fließtext, Aufzählung, Nummerierung, Tabelle mit Kopfzeile und abwechselnden Zeilenfarben). Das gilt
  auch für eigene Stilnamen und von Hand formatierten Text. Ein Absatz `{{inhalt}}` in der Vorlage bestimmt, wo das
  Ergebnis hinkommt (Deckblatt, Briefkopf und Unterschriften bleiben); `{{titel}}` und `{{datum}}` werden ersetzt.
- **Ampel (globale Regel):** Auswahlwerte wie „Widersprüchlich“, „Abweichend“, „Fehlt“ werden rot, „Unsicher“, „Offen“,
  „Zu klären“ gelb, „Sicher“, „Bestätigt“ dezent grün markiert; im Text lösen Marken wie „[offen]“ Gelb aus. Ein
  Inhaltsfeld übernimmt die Farbe seines Felds „Status <Feldname>“. Ja/Nein und Prioritäten bleiben neutral
  (`src/lib/ampel.ts`).
  Unter jedem rot oder gelb markierten Feld steht in kleiner Schrift, warum: Lese-Schritte von Prüfseiten bekommen
  automatisch die Anweisung, zu unsicheren und widersprüchlichen Werten {"wert", "hinweis"} mit einem Satz und Fundstelle
  zu liefern (auch als eigener Schlüssel „<feld>_hinweis“, ausdrücklich je Status-Feld am Ende der Aufgabe verlangt);
  fehlt der Satz, steht ein kurzer Standardhinweis da. Inhaltsfeld und Status-Feld werden als Paar erkannt, auch bei
  abweichenden Namen („Lagerplätze und Kapazitäten“ ↔ „Status Lagerplätze“) oder wenn das Status-Feld direkt dahinter
  steht; die Begründung steht genau einmal, unter dem Status-Feld. Oben auf der Seite fasst „Bitte prüfen“ alle
  Widersprüche und unsicheren Punkte zusammen, ein Klick führt zum Feld.
- **Mitwachsende Textfelder:** Textfelder in Apps und lange Texte im Baukasten wachsen mit dem Inhalt (bis etwa zum halben
  Bildschirm), statt intern zu scrollen.
- **Ein Startweg:** Neue Apps haben keinen eigenen „Ausführen“-Knopf mehr, „Ergebnisse erstellen“ im Blättern startet.
  Ein gesperrtes „Weiter“ springt beim Klick zum ersten fehlenden Pflichtfeld und markiert es.
- **Neu aus Grundgerüst:** „Neue Applikation“ bietet fünf fertig verdrahtete Gerüste (Formular → Word, Datei lesen →
  prüfen → Bericht, Fachexperten-Chat, Dateipaket, Agenten-Team); neue Apps zeigen im Baukasten einen geführten Start.
- **KI-Assistent schnell auch bei großen Apps:** Die KI schreibt nur geänderte oder neue Seiten und Schritte vollständig
  zurück; unveränderte kommen als `{"id", "unveraendert": true}`, unverändertes Wissen und Design als „unveraendert“, und der
  Baukasten setzt die bisherigen wieder ein (`ergaenzen` in `src/lib/assistant.ts`). Der Kontext lässt Standardwerte weg.
  Während des Umbaus zeigt der Assistent Wartezeit und empfangene Zeichen.
- **Zeitlimit:** Copilot-Antworten kommen immer als Strom; abgebrochen wird nur, wenn 3 Minuten lang nichts mehr
  ankommt (`KI_CONFIG.timeoutMs`), nie eine Antwort, die noch entsteht. Kommt nach 90 Sekunden noch gar kein erstes
  Zeichen (`KI_CONFIG.ersteZeichenMs`), hängt Copilot: der Hub fragt einmal in einem frischen Gespräch neu, im Chat mit
  vollem Verlauf. Ohne Streaming (Tenant ohne `chatOverStream`) gilt für die Antwort am Stück 8 Minuten.
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
Für eine Sichtprüfung aller Seiten und Zustände (Hub, Apps, Ergebnisse, Mein Hub, Baukasten mit Panels und Dialogen, 404) in beiden Breiten gibt es ein Screenshot-Audit: `AUDIT=1 npx playwright test e2e/audit.spec.ts` legt rund 100 Bilder in `screenshots/audit/` ab (auch Chat, Agenten, Verwaltung, Postfach, Lernen). `AUDIT=1 npx playwright test e2e/axe.spec.ts` prüft die Kernseiten mit axe-core nach WCAG 2.1 A/AA und schreibt die Verstöße nach `screenshots/audit/axe-<projekt>.json`. Ergebnisse der letzten Oberflächenprüfung: `pruefung/oberflaeche-2026-10-18.md`.

### Prüf-Skills für Claude Code

Im Ordner `.claude/skills` liegen Leitfäden, die Claude Code bei einer umfangreichen Prüfung des Hubs nutzt (Aufruf per `/name` oder von selbst, wenn die Aufgabe passt): `design-critique` (Oberfläche und Abläufe), `accessibility-review` (Barrierefreiheit nach WCAG 2.1 AA), `ux-copy` (Beschriftungen, Meldungen, Leerzustände), `web-design-guidelines` (Web-Interface-Regeln), `frontend-design` (Gestaltung), `user-research` und `research-synthesis` (Nutzertests planen und auswerten), `review-pr` und `code-review` (Code-Prüfung mit Spezialagenten aus `.claude/agents`) sowie `sicherheitspruefung` (Sicherheitsbericht mit Bedrohungsmodell, Suche und unabhängiger Prüfung jedes Befunds; verändert keinen Code). Die Design- und Review-Leitfäden stammen aus den öffentlichen Anthropic-Plugins (knowledge-work-plugins, claude-plugins-official). Für Barrierefreiheitsprüfungen in Playwright ist `@axe-core/playwright` installiert.

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
