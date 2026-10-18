# Prüfung der Oberfläche: Design, Nutzbarkeit, PC- und Handy-Ansicht

Stand: 18. Oktober 2026. Geprüft wurde der Hub im Testmodus (KI-Simulation bzw. nachgebaute Claude-Antworten) in 1440 px und 390 px Breite: 104 Screenshots aller Seiten und Zustände (`AUDIT=1 npx playwright test e2e/audit.spec.ts`), dazu axe-core nach WCAG 2.1 A/AA auf acht Kernseiten (`AUDIT=1 npx playwright test e2e/axe.spec.ts`), und Sichtprüfung gegen die Leitfäden design-critique, accessibility-review, ux-copy und web-design-guidelines.

## Zusammenfassung

Der Hub ist auf dem PC stimmig: klare Hierarchie, einheitliche Bausteine, gut lesbare Texte, nachvollziehbare Abläufe (Eingaben → Ergebnisse, Baukasten mit Führung, Verwaltung). Die gravierenden Befunde lagen in der Handy-Ansicht und in der Barrierefreiheit: Bereiche der Navigation waren auf dem Handy unsichtbar, die Verwaltung lief über den Bildschirmrand, Kacheln verloren ihre Beschreibung, und axe meldete 14 Verstöße (2 kritisch). Alle Befunde der Schwere „kritisch“ und „hoch“ sind behoben; axe meldet auf den Kernseiten keine Verstöße mehr. Offen bleiben vier Punkte, die eine Entscheidung brauchen (unten).

## Befunde und Stand

Schwere: 🔴 hoch (blockiert eine Aufgabe oder verbirgt Funktionen), 🟡 mittel (stört, Umweg nötig), 🟢 gering (Politur).

### Handy-Ansicht

| # | Befund | Schwere | Stand |
|---|--------|---------|-------|
| 1 | Navigation: „Agenten“ und „Verwaltung“ lagen rechts außerhalb der Leiste und waren nur durch unsichtbares Wischen erreichbar; eine Verwaltungsperson fand ihre Seite auf dem Handy nicht. | 🔴 | Behoben: ab 560 px stehen Baukasten, Agenten und Verwaltung in einem Menü „Mehr“ (zeigt den aktiven Bereich als Namen). |
| 2 | Verwaltung: Personen- und Applikationstabelle sprengten die Seitenbreite (Seite 782 px breit bei 390 px Bildschirm), Statusspalte und Aktionen abgeschnitten. | 🔴 | Behoben: Tabellen rollen innerhalb ihres Bereichs; versteckte Beschriftungen bleiben im Rollbereich. |
| 3 | Kacheln auf der Startseite zeigen keine Beschreibung, nur Name und „3 Felder“. | 🟢 | Bleibt so: Die Kacheln haben auf dem Handy eine feste Höhe (96 px), damit drei bis vier je Seite ohne Rollen passen; mit Beschreibung ragte der Inhalt über die Kachel hinaus (erster Versuch zurückgenommen). |
| 4 | Postfach-Kopf: Hinweis „Beispielpostfach (ohne Copilot-Anbindung)“ brach dreizeilig um, „Prozeduren“ war abgeschnitten. | 🟡 | Behoben: Hinweis heißt „Beispielpostfach“ (Erklärung als Tooltip), Kopf darf umbrechen. |
| 5 | Baukasten mit Reiter „Lernen“: Leiste brach in zwei Zeilen, Rückgängig/Wiederholen/Vorschau rutschten unter die Reiter. | 🟡 | Behoben: engere Reiter, „Wiederholen“ nur ab 640 px; Reiter eines KI-Schritts (Aufgabe, Agenten, Feineinstellungen, Wissen) brechen um statt abgeschnitten zu werden. |
| 6 | Chat-Kopf: Titel brach neben den Knöpfen um. | 🟢 | Behoben: Kopf darf umbrechen. |
| 7 | „Neue Applikation“: Grundgerüst-Karten rollen seitlich ohne sichtbaren Hinweis. | 🟢 | Offen (Entscheidung): Karten untereinander stapeln (länger) oder Rollhinweis. |
| 8 | Startseite: Kacheln sind auf dem Handy in Seiten geblättert („Seite 1 von 3“); üblich wäre eine durchlaufende Liste. | 🟢 | Offen (Entscheidung): bewusst ohne Scrollen gebaut; Liste wäre auf dem Handy gewohnter. |

### PC-Ansicht und Abläufe

| # | Befund | Schwere | Stand |
|---|--------|---------|-------|
| 9 | Verwaltung hieß „Personen und Rechte“, enthält aber auch Applikationen und Speicher. | 🟡 | Behoben: Seite „Verwaltung“ mit Unterbereichen „Personen und Rechte“, „Applikationen“, „Gemeinsamer Speicher“. |
| 10 | Applikationstabelle: Spalte „Status“ zeigte bei Vorlagen „Vorlage“ und doppelte damit „Herkunft“. | 🟢 | Behoben: Status zeigt „Freigegeben“. |
| 11 | App-Leiste: fünf Aktionen in einer Reihe, davon „Sperren“, „Löschen“ und „Aus dem Hub nehmen“ als nackter Text; Pflegeaktionen konkurrierten mit der Arbeit an der App. | 🟡 | Behoben: Pflegeaktionen in einem Menü „Verwalten“; „Zu Mein Hub“, „Voreinstellungen“, „Beispieldaten“ und „Bearbeiten“ bleiben sichtbar. |
| 12 | Kachelbeschreibungen auf dem PC auf eine Zeile mit „…“ gekürzt, obwohl Platz für zwei Zeilen war. | 🟢 | Behoben: Schwelle der Höhenregel korrigiert. |
| 13 | Baukasten: Knopf „Exportieren / Importieren …“ wurde mit „…“ abgeschnitten. | 🟢 | Behoben: „Export / Import …“. |
| 14 | Verwaltung: „Löschen“ und „Aus dem Hub nehmen“ sind Geist-Knöpfe (nur Text). | 🟢 | Offen (Entscheidung): bewusst zurückhaltend für zerstörende Aktionen; Alternative Umrandung in Rot. |
| 14a | Startseite mit Git-Speicher: Beim Öffnen stand erst „Applikationen werden geladen“ (mit sichtbarem Steuerzeichen), die Zähler zeigten „–“, die Kacheln kamen erst nach der Antwort von GitHub. | 🟡 | Behoben: Der Hub merkt sich die zuletzt geladenen eigenen Apps im Browser und zeigt sie sofort; der frische Stand aus dem Git-Speicher ersetzt sie im Hintergrund. Steuerzeichen entfernt. |

### Barrierefreiheit (axe-core, WCAG 2.1 AA)

| # | Befund | Kriterium | Stand |
|---|--------|-----------|-------|
| 15 | Statusgrün (#1f8a4c) als Text: 3,9:1 auf Weiß, 8 Stellen in der Verwaltung. | 1.4.3 Kontrast | Behoben: Text in #176b3b (≥ 4,5:1), der Punkt bleibt im Signalgrün. |
| 16 | Zahl in der aktiven Bereichs-Pille mit 75 % Deckkraft auf Blau. | 1.4.3 Kontrast | Behoben: volle Deckkraft. |
| 17 | Logo-Link: aria-label „KI-Hub“ enthielt den sichtbaren Text „KSCA“ nicht. | 2.5.3 Beschriftung im Namen | Behoben: „KSCA KI-Hub, zur Übersicht“. |
| 18 | Baukasten-Führung: Schritt-Knöpfe hatten auf dem Handy keinen Namen (Text per display:none). | 4.1.2 Name, Rolle, Wert | Behoben: Text nur visuell verborgen. |
| 19 | Baukasten-Reiter: aria-controls verwies auf ein nicht vorhandenes Element. | 4.1.2 | Behoben: leeres Ziel im Reiter. |
| 20 | Bausteine auf der Fläche: role=button mit Eingabefeldern darin (verschachtelte Bedienelemente). | 4.1.2 | Behoben: role=group mit Beschriftung; Tastaturbedienung (Enter, Leertaste, Entf) unverändert. |
| 21 | Überschriftenfolge im Baukasten (h3 nach h1). | 1.3.1 Struktur | Behoben: Inspektor-Überschriften sind h2. |
| 22 | „Neue Applikation“ auf dem Handy ohne h1 (display:none). | 1.3.1 | Behoben: nur visuell verborgen. |
| 23 | Zwei Landmarken „Applikationen“ (Abschnitt und Tabellenregion). | 1.3.1 | Behoben: „Tabelle der Applikationen“, „Tabelle der Personen“. |

Was axe nicht prüft und noch aussteht: Tastaturbedienung aller Dialoge und Menüs mit einem Screenreader (NVDA oder VoiceOver), Zoom auf 200 % auf dem PC. Beides braucht einen Menschen am Gerät.

### Texte und Beschriftungen

Geprüft wurden Leerzustände, Fehlermeldungen, Bestätigungen und Knopfbeschriftungen. Sie folgen durchgehend dem Muster „Was ist passiert, warum, was tun“ (z. B. Git-Prüfung, Postfach, Lernen), Bestätigungsdialoge benennen die Aktion („Änderungen verwerfen“, „Speichern und verlassen“) statt „OK/Abbrechen“. Keine Änderungen nötig.

## Nicht Teil dieser Prüfung

Sicherheit, Performance (Lighthouse) und Rechte im echten Tenant folgen als eigene Prüfungen. `npm audit` meldet 14 Schwachstellen in Abhängigkeiten (9 hoch); das ist der erste Punkt der Sicherheitsprüfung.

## Offene Entscheidungen

1. Startseite auf dem Handy: Seiten blättern (wie jetzt) oder durchlaufende Liste.
2. „Neue Applikation“: Grundgerüst-Karten auf dem Handy stapeln oder Rollhinweis.
3. Verwaltung: zerstörende Aktionen als Geist-Knopf (wie jetzt) oder rot umrandet.
4. Screenreader-Durchgang mit einer Person am Gerät einplanen.
