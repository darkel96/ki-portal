# KI-Hub mit Baukasten – Konzept und technische Spezifikation

> Dieses Dokument beschreibt einen funktionierenden Prototyp (`prototyp.html`, eine einzelne HTML-Datei mit Vanilla-JS).
> Es dient als Wissensgrundlage, um das Konzept in ein **bestehendes Projekt** zu übernehmen.
> Es ist bewusst technologieneutral gehalten; Datentypen sind als TypeScript notiert.

---

## 1. Ziel

Ein internes **KI-Portal (Hub)**:

- **Startseite mit Kacheln**: Jede Kachel ist eine KI-Applikation bzw. ein Agent. Die Kacheln lassen sich nach **Bereichen** filtern (Allgemein, Vertrieb, Personal, Marketing, IT, Recht, Einkauf …) und durchsuchen.
- **Baukasten**: Neue Applikationen werden **ohne Programmierung** gebaut, indem man Elemente auf eine Fläche zieht, sie gestaltet und einen **KI-Ablauf** (Prompts) definiert.
- **Gecodete Apps** bleiben möglich: Selbst programmierte Applikationen stehen als Kachel (Typ `link`) neben Baukasten-Apps.
- **KI-Anbieter austauschbar**: Alle KI-Aufrufe laufen über ein neutrales Anfrageformat. Im Zielsystem läuft die KI über **Microsoft 365 Copilot über die Microsoft-Graph-Schnittstelle** (siehe Abschnitt 18), ohne dass Apps geändert werden müssen.
- **KI-Assistent im Baukasten**: Oberfläche und Ablauf lassen sich per Prompt bauen und ändern (siehe Abschnitt 17.1).
- Vorerst **kein Login**. Authentifizierung kommt später.

---

## 2. Grundprinzip: Eine App ist eine Konfiguration, kein Code

Jede Baukasten-App ist ein **JSON-Dokument**. Daraus erzeugt **ein generischer Renderer** sowohl:

1. die **Bearbeitungsansicht** im Baukasten (Elemente auswählbar, verschiebbar, Eingaben deaktiviert),
2. die **Ausführungsansicht** im Hub (Eingaben aktiv, KI-Buttons starten den Ablauf),
3. die **Kachel** auf der Startseite.

```
App-JSON ──► Renderer(mode = "edit" | "run") ──► HTML
         └─► Kachel (Name, Bereich, Beschreibung, Farbe, Anzahl Eingaben/Schritte)
```

Daraus folgt: Neue App = neues JSON-Dokument speichern. Kein Deployment, kein Code.

---

## 3. Datenmodell

```ts
interface App {
  id: string;                 // z. B. "app-lq2x9k3f" (bei neuer App beim Speichern vergeben)
  v: 2;                       // Formatversion
  typ: "baukasten" | "link";  // "link" = selbst gecodete App, öffnet url
  url?: string;               // nur bei typ "link"
  name: string;
  bereich: string;            // frei wählbar, bekannte Bereiche haben feste Reihenfolge/Farbe
  beschreibung: string;       // ein Satz für die Kachel
  theme: Theme;
  // Keine Verbindungsdaten in der App: Die KI-Anbindung ist zentral (Abschnitt 8 und 18).
  // Ein früheres Feld `ki` wird beim Laden ignoriert und beim Speichern nicht mehr geschrieben.
  blocks: Block[];            // Oberfläche (Baum)
  steps: Step[];              // KI-Ablauf (Reihenfolge = Ausführungsreihenfolge)
  geaendert: string;          // ISO-Datum
  status: "entwurf" | "pruefung" | "freigegeben";
  owner: string;              // Verantwortliche Person oder Abteilung
  schutz: "oeffentlich" | "intern" | "vertraulich";   // Schutzklasse der Daten
  version: number;            // wird bei jedem Speichern um 1 erhöht
}

interface Theme {
  accent: string;   // "" = Standard-Akzent, sonst "#RRGGBB" (Buttons, Fokus, Kachel-Monogramm)
  bg: string;       // "" = folgt Hell/Dunkel des Hubs, sonst "#RRGGBB"
  font: "sans" | "serif" | "display" | "mono";
  radius: "s" | "m" | "l";    // 3px / 10px / 18px
  width: "s" | "m" | "l";     // 680px / 960px / 1240px max. Inhaltsbreite
}

interface Block {
  id: string;                       // "b" + zufällige Zeichen
  type: BlockType;
  props: Record<string, any>;       // je nach Typ, siehe Katalog
  children?: Block[];               // nur "section"
  cols?: Block[][];                 // nur "columns" (2 oder 3 Spalten)
}

type BlockType =
  | "section" | "columns" | "spacer" | "divider"          // Layout
  | "heading" | "text" | "callout"                         // Inhalt
  | "input" | "textarea" | "select" | "radio"              // Eingaben
  | "checkbox" | "number" | "date" | "file"
  | "button" | "output";                                   // KI

interface Step {
  id: string;            // "s" + zufällige Zeichen (stabil, Buttons/Outputs referenzieren es)
  name: string;          // z. B. "Zusammenfassung"
  key: string;           // Ergebnis-Variable, z. B. "schritt1" -> in späteren Prompts {{schritt1}}
  rolle: string;         // Systemanweisung: Rolle und Regeln
  wissen: string;        // optionales festes Hintergrundwissen (darf Variablen enthalten)
  prompt: string;        // Aufgabe mit Platzhaltern {{variable}}
  modell: "quick" | "default" | "complex";   // abstrakte Stufe, Adapter mappt auf echtes Modell (bei Copilot ohne Wirkung)
  format: "markdown" | "text" | "json" | "dateien";  // "dateien" = Dateipaket (ZIP), siehe 17.4
  autoAll?: boolean;     // true = alle Eingabefelder automatisch an den Prompt anhängen
  web?: boolean;         // Websuche erlauben (nur Copilot: webContext.isWebEnabled)
  quellen?: Wissensquelle[];                 // SharePoint-Bereiche, Dateien, Webseiten
  bedingung?: { feld: string; op: "gleich" | "ungleich" | "gefuellt" | "leer"; wert: string } | null;
}

interface Wissensquelle {
  typ: "sharepoint" | "datei" | "web";   // Website/Bibliothek/Ordner | einzelne Datei | Webseite
  titel: string;
  url: string;                           // z. B. https://firma.sharepoint.com/sites/QM/Freigegebene Dokumente
}
```

---

## 4. Bausteine (Elementkatalog)

| Gruppe | Typ | Bezeichnung | Props |
|---|---|---|---|
| Layout | `section` | Bereich | `bg` (Farbe oder ""), `pad` (s/m/l), `border` (bool); hat `children` |
| Layout | `columns` | Spalten | `count` (2/3); hat `cols` |
| Layout | `spacer` | Abstand | `h` (12/24/48 px) |
| Layout | `divider` | Trennlinie | – |
| Inhalt | `heading` | Überschrift | `text`, `level` (1/2/3), `align`, `color` |
| Inhalt | `text` | Text | `text`, `size` (s/m/l), `align`, `color` |
| Inhalt | `callout` | Hinweis | `text`, `tone` (info/warn/ok) |
| Eingaben | `input` | Textzeile | Feld-Props + `placeholder` |
| Eingaben | `textarea` | Textfeld | Feld-Props + `placeholder`, `rows` |
| Eingaben | `select` | Dropdown | Feld-Props + `optionen: string[]` |
| Eingaben | `radio` | Auswahlknöpfe | Feld-Props + `optionen: string[]` |
| Eingaben | `checkbox` | Checkbox | Feld-Props (Wert wird „ja“/„nein“) |
| Eingaben | `number` | Zahl | Feld-Props + `placeholder` |
| Eingaben | `date` | Datum | Feld-Props |
| Eingaben | `file` | Datei | Feld-Props + `uebergabe` ("text" = Inhalt als Text, "referenz" = als Datei-Verweis für Copilot). Gelesen werden .docx, .xlsx, .pdf, .csv, .txt, .md |
| Inhalt | `image` | Bild / Logo | `src` (Data-URL, max. ca. 200 KB, auf 800 px verkleinert), `alt`, `size` (s/m/l/full), `align` |
| KI | `button` | KI-Button | `text`, `aktion` ("alle", Step-ID = nur dieser Schritt, `"ab:" + Step-ID` = ab diesem Schritt bis zum Ende), `stil` (filled/outline), `align`, `color` |
| KI | `output` | Ergebnis | `titel`, `quelle` (Step-ID), `stil` (card/plain) |

**Gemeinsame Feld-Props** (alle Eingaben):

```ts
{
  label: string;      // sichtbare Bezeichnung
  key: string;        // Variablenname, eindeutig in der App, z. B. "kunde"
  keyAuto: boolean;   // true = key folgt automatisch dem Label, bis der Nutzer ihn manuell ändert
  pflicht: boolean;
  hilfe: string;      // Hilfetext unter dem Feld
  beispiel: string;   // Beispielwert zum Testen ("Beispieldaten einsetzen", Anfrage-Vorschau)
}
```

---

## 5. Baukasten-Oberfläche

Zwei Reiter plus Vorschau:

### Reiter „Oberfläche“ (drei Spalten)

1. **Palette (links)**: alle Bausteine nach Gruppen. **Ziehen** auf die Fläche oder **anklicken** (fügt nach dem gewählten Element ein, bzw. in einen gewählten Bereich / in die erste Spalte).
2. **Arbeitsfläche (Mitte)**: zeigt die App im Modus `edit`.
   - Klick wählt ein Element (Rahmen + Typ-Schild + Werkzeuge ↑ ↓ ⧉ ✕).
   - Elemente per Drag-and-drop verschieben, auch in Bereiche und Spalten hinein.
   - **Doppelklick** auf Überschrift, Text, Hinweis oder Button-Beschriftung = direkt bearbeiten (contenteditable).
   - `Entf` löscht, `Esc` hebt die Auswahl auf.
   - Jedes Eingabefeld zeigt ein Schild: **„→ KI-Schritt 1, 2“** (grün) oder **„nicht an KI“** (rot).
3. **Eigenschaften (rechts)**:
   - Element gewählt: dessen Props (Text, Größe, Ausrichtung, Farben als Farbfelder + eigener Farbwähler, Optionen, Pflichtfeld, Variable …).
   - Bei Eingabefeldern zusätzlich der Kasten **„An die KI übergeben“** (siehe Abschnitt 6.3).
   - Nichts gewählt: App-Einstellungen (Bereich, Kurzbeschreibung, Akzentfarbe, Hintergrund, Schrift, Ecken, Breite).

### Reiter „KI-Ablauf“

- Liste der **KI-Schritte**, je Schritt: Name, Ergebnis-Variable, Modell, Ausgabeformat, **Rolle und Regeln**, **Prompt** (mit Variablen-Knöpfen zum Einfügen), **Hintergrundwissen**, Option **„Alle Eingaben automatisch anhängen“**, Anzeige „Bekommt: …“ und „Wird in n Ergebnis-Elementen angezeigt“.
- Seitenleiste:
  - **KI-Schnittstelle**: Anbieter + Endpunkt/Agent-ID.
  - **Anfrage-Vorschau**: exaktes JSON, das an die Schnittstelle ginge (mit Beispielwerten gefüllt).
  - **Prüfung**: Warnungen (siehe Abschnitt 9).

### Vorschau

Schaltet die App in den Modus `run` innerhalb des Baukastens: Eingaben und KI-Buttons funktionieren, „Beispieldaten einsetzen“ füllt alle Felder.

### Drag-and-drop – Umsetzung

- Beim Rendern im Modus `edit` bekommt **jede Liste** (Wurzel, `section.children`, jede Spalte in `columns.cols`) ein DOM-Element mit `data-list="<listId>"`. Eine Registry `Map<listId, Block[]>` verweist auf das jeweilige Array.
- `dragstart`: entweder neues Element aus der Palette (`{kind:"new", type}`) oder bestehendes (`{kind:"move", id}`).
- `dragover`: innerste Liste unter dem Zeiger suchen (`closest("[data-list]")`). Einfügeposition = erstes Kind, dessen vertikale Mitte unter dem Zeiger liegt. Eine Platzhalterlinie wird dort ins DOM gesetzt. Gemerkt wird `{listId, beforeId}` (ID statt Index, damit Verschieben in derselben Liste korrekt bleibt).
- Ein Container darf **nicht in sich selbst** verschoben werden (prüfen, ob das gezogene Element die Zielliste enthält).
- `drop`: Element aus alter Liste entfernen (bei `move`), in Zielliste vor `beforeId` einfügen (oder ans Ende), neu rendern, Element auswählen.
- Touch-Geräte: HTML5-DnD funktioniert dort nicht → Klick-zum-Einfügen + ↑/↓ als Ersatz.

---

## 6. Wie Eingaben in den Prompt kommen (Kernmechanismus)

### 6.1 Variablen

- Jedes Eingabefeld hat einen **`key`** (Variable). Er wird beim Anlegen aus dem Label erzeugt:
  `slug(label)` = Kleinbuchstaben, ä→ae, ö→oe, ü→ue, ß→ss, alles andere → `_`, max. 30 Zeichen.
- Keys sind **eindeutig** pro App (über Felder **und** Step-Ergebnis-Variablen). Bei Kollision: `kunde_2`, `kunde_3` …
- Solange `keyAuto = true`, folgt der Key dem Label. Ändert der Nutzer den Key manuell, wird `keyAuto = false`.
- **Umbenennen** eines Keys ersetzt automatisch alle `{{alterKey}}` in allen Prompts und im Hintergrundwissen.

### 6.2 Platzhalter im Prompt

Im Prompt eines Schritts steht `{{variable}}` überall dort, wo ein Wert hin soll:

```
Prüfe den folgenden Vertrag für den Kunden {{kunde}}.

Vertragstext:
{{vertrag}}

Nenne die drei wichtigsten Risiken als Liste.
```

- Verfügbar in Schritt *n*: alle Feld-Variablen + die Ergebnis-Variablen der Schritte **vor** *n* (z. B. `{{schritt1}}`).
- **Was nicht im Prompt steht, bekommt die KI nicht** (Ausnahme: `autoAll`).

### 6.3 „An die KI übergeben“ (Häkchen am Eingabefeld)

Im Eigenschaften-Panel eines Eingabefelds gibt es pro KI-Schritt ein Häkchen:

- **Aktiv**, wenn der Prompt oder das Hintergrundwissen des Schritts `{{key}}` enthält, oder der Schritt `autoAll` hat.
- **Häkchen setzen** → an den Prompt wird angehängt:
  ```
  <Label>:
  {{key}}
  ```
- **Häkchen entfernen** → zuerst das angehängte Muster „Zeile mit Doppelpunkt + Zeile mit `{{key}}`“ entfernen, danach alle übrigen `{{key}}`-Vorkommen; mehr als zwei Leerzeilen zusammenfassen.
- Bei `autoAll` ist das Häkchen gesetzt und deaktiviert (Feld wird ohnehin übergeben).

### 6.4 „Alle Eingaben automatisch anhängen“ (`autoAll`)

Für Nutzer, die keine Platzhalter schreiben wollen. Der Prompt enthält nur die Aufgabe; beim Ausführen wird angehängt:

```
<Prompt>

Eingaben:

<Label 1>:
<Wert 1>

<Label 2>:
<Wert 2>
```

Felder, die bereits per Platzhalter im Prompt stehen, werden nicht doppelt angehängt.

### 6.5 Ermitteln, welche Schritte ein Feld nutzen

```ts
function stepsUsing(app: App, key: string): number[] {
  const k = key.toLowerCase();
  return app.steps
    .map((s, i) => (s.autoAll || varsIn(s.prompt + " " + s.wissen).includes(k)) ? i : -1)
    .filter(i => i >= 0);
}
// varsIn(text) = alle Namen aus /\{\{\s*([^}]+?)\s*\}\}/g, kleingeschrieben
```

Wird für das Schild auf der Fläche, die Häkchen, „Bekommt: …“ und die Prüfung genutzt.

---

## 7. Ausführung (Laufzeit)

Ablauf beim Klick auf einen **KI-Button**:

1. **Werte einsammeln** für alle Eingabefelder der App:
   - Text/Zahl/Datum/Dropdown: Feldwert (getrimmt)
   - Auswahlknöpfe: gewählte Option
   - Checkbox: „ja“ / „nein“
   - Datei: zuvor eingelesener **Textinhalt** (max. ca. 60.000 Zeichen)
   - Leere Werte → „(keine Angabe)“
2. **Pflichtfelder prüfen** → Fehler am Feld anzeigen, abbrechen.
3. **Schritte bestimmen**: `aktion = "alle"` → alle Schritte nacheinander; sonst nur der gewählte Schritt.
4. Kontext `ctx = { ...Feldwerte, ...bisherige Ergebnisse }`.
5. Für jeden Schritt:
   1. **Anfrage bauen** (`buildRequest`, siehe 8.1).
   2. An die **KI-Schnittstelle** senden (Streaming, Stopp-Möglichkeit).
   3. Antwort in **alle Ergebnis-Elemente** schreiben, deren `quelle` = Step-ID. Gibt es keins, wird unten in der App automatisch eine Ergebnis-Karte angelegt.
   4. Ergebnis unter `ctx[step.key]` ablegen → nächste Schritte können `{{step.key}}` nutzen.
   5. Unter dem Ergebnis: „Kopieren“ und aufklappbar **„Anfrage an die KI-Schnittstelle ansehen“** (das gesendete JSON).
6. Während des Laufs wird der geklickte Button zum **„Stoppen“**-Button, andere KI-Buttons sind gesperrt.
7. Ist keine KI verfügbar → **Simulation**: statt einer Antwort wird das Anfrage-JSON angezeigt.

Darstellung des Ergebnisses je `format`:
- `markdown` → einfaches Markdown (Überschriften, Listen, Tabellen, fett, Code)
- `text` → Fließtext mit Zeilenumbrüchen
- `json` → vorformatiert

Statusanzeige pro Ergebnis: `läuft`, `fertig`, `gestoppt`, `simuliert`, `Fehler`.

---

## 8. KI-Anbindung (zentral für alle Applikationen)

Die KI-Anbindung wird **nicht pro Applikation** eingestellt. Der KI-Hub hat **eine zentrale Azure-Anwendung** (App-Registrierung in Microsoft Entra ID). Sie meldet die Person per Single Sign-on an und sendet die Anfragen über Microsoft Graph an Microsoft 365 Copilot (Ablauf in Abschnitt 18). Eine Applikation liefert nur die fertige, neutrale Anfrage.

- Im Baukasten gibt es dafür keine Eingabefelder. Der Reiter „KI-Ablauf“ zeigt die zentrale Anbindung nur zur Information an.
- Client-ID, Tenant und Berechtigungen stehen an **einer** Stelle in der Konfiguration des Hubs bzw. der Azure-Anwendung, nicht in den App-Dokumenten.
- Im Prototyp beantwortet Claude die Anfragen anstelle von Copilot.

### 8.1 Neutrales Anfrageformat

Die Applikation übergibt der zentralen KI-Anbindung **nur dieses Format**.

```json
{
  "applikation": "Angebotsanschreiben",
  "applikationId": "app-…",
  "schritt": "Anschreiben",
  "modell": "default",
  "ausgabeformat": "markdown",
  "system": "Du arbeitest in der Applikation „Angebotsanschreiben“ eines internen KI-Hubs. Antworte auf Deutsch.\n\nDu bist Assistenz im Vertrieb. Du erfindest keine Preise und keine Zusagen.\n\nFormatiere mit einfachem Markdown: ## Überschriften, - Listen, Tabellen nur wenn sie helfen. Beginne direkt mit dem Ergebnis.",
  "nachricht": "Schreibe ein Anschreiben zu einem Angebot.\nKunde: Stadtwerke Lindau, Herr Bauer\nLeistung: Wartungsvertrag für 12 Ladesäulen …",
  "variablen": {
    "kunde": "Stadtwerke Lindau, Herr Bauer",
    "leistung": "Wartungsvertrag für 12 Ladesäulen …"
  }
}
```

**Zusammensetzung `system`** (Teile mit Leerzeile getrennt, leere weglassen):
1. Rahmen: `Du arbeitest in der Applikation „<name>“ eines internen KI-Hubs. Antworte auf Deutsch.`
2. `step.rolle`
3. `Hintergrundwissen:\n` + `step.wissen` (Platzhalter darin ebenfalls ersetzt)
4. Format-Hinweis:
   - markdown: „Formatiere mit einfachem Markdown: ## Überschriften, - Listen, Tabellen nur wenn sie helfen. Beginne direkt mit dem Ergebnis.“
   - text: „Antworte als schlichter Text ohne Markdown. Beginne direkt mit dem Ergebnis.“
   - json: „Antworte nur mit gültigem JSON, ohne Erklärung davor oder danach.“

**`nachricht`** = Prompt mit ersetzten Platzhaltern (+ ggf. `autoAll`-Anhang).
**`variablen`** = genutzte Variablen mit Werten (für Protokoll/Debugging, lange Werte gekürzt).

### 8.2 Eine Funktion für alle Applikationen

```ts
// Einzige Stelle, an der der Hub die KI anspricht. Gilt für alle Applikationen.
async function kiSenden(req: KiRequest, opts: { signal: AbortSignal; onText?: (fullText: string) => void }): Promise<{ text: string; truncated?: boolean }>;
```

- Im Zielsystem: Token über die zentrale Azure-Anwendung holen, dann Graph-Aufrufe aus Abschnitt 18.2.
- Copilot nimmt keine getrennte System-Nachricht an: `system + "\n\n---\n\n" + nachricht` als eine Nachricht senden (so arbeitet auch der Prototyp).
- `modell` (`quick`/`default`/`complex`) hat bei Copilot keine Wirkung und bleibt nur als Hinweis in der Anfrage.
- Zugangsdaten und Token gehören nie in die App-Definition.

---

## 9. Prüfung (Validierung vor dem Speichern)

**Blockierend** (Speichern nicht möglich):
- App hat keinen Namen.
- Kein KI-Schritt vorhanden.
- Ein Schritt hat keinen Prompt.
- Ein Prompt nutzt `{{x}}`, das an dieser Stelle nicht existiert (kein Feld, kein früherer Schritt).
- Ein Button startet einen Schritt, den es nicht mehr gibt.
- Ein Ergebnis-Element ist mit keinem Schritt verbunden.
- Dropdown/Auswahlknöpfe ohne Optionen.
- Es gibt Schritte, aber keinen KI-Button auf der Oberfläche.

**Hinweise** (nicht blockierend):
- Für einen Schritt gibt es kein Ergebnis-Element (Ergebnis erscheint unten automatisch).
- Ein Eingabefeld geht an keinen KI-Schritt.

Beim **Löschen eines Schritts**: Buttons mit dieser `aktion` → auf „alle“ setzen; Ergebnis-Elemente mit dieser `quelle` → leeren.

---

## 10. Hub (Startseite)

- Kopfzeile: Logo „KI-Hub“, Navigation „Applikationen“ / „Baukasten“, Statusanzeige der KI („KI verbunden“ / „KI-Simulation“).
- Suche (Name, Beschreibung, Bereich) + Bereichs-Chips mit Anzahl.
- Kachel: Monogramm (2 Buchstaben, in Akzentfarbe der App bzw. Bereichsfarbe), Bereich, Name, Beschreibung (max. 3 Zeilen), „n Eingaben · m KI-Schritte“, Badge (`Beispiel`, `Eigene`, `Nur in diesem Browser`, `Gecodet`).
- Letzte Kachel: „+ Neue Applikation“ → Baukasten.
- App-Ansicht: Zurück, Bereich, „Beispieldaten einsetzen“, „Im Baukasten bearbeiten“ (eigene Apps) bzw. „Als Kopie im Baukasten öffnen“ (Vorlagen), „Löschen“ mit Bestätigung im Seiteninhalt.

Bereichsfarben (hell): Allgemein `#0E6B58`, Vertrieb `#2F5DA8`, Personal `#A04E8C`, Marketing `#C4572A`, IT `#3B7A2A`, Recht `#6B5BB5`, Einkauf `#8A6A12`. Unbekannte Bereiche bekommen per Hash eine dieser Farben.

---

## 11. KI-Entwurf („Von der KI entwerfen lassen“)

Der Nutzer beschreibt die App in 1–2 Sätzen. Die KI liefert ein **vereinfachtes JSON**, das dann in eine vollständige App umgewandelt wird.

**Prompt (gekürzt):**

```
Entwirf eine KI-Applikation für ein internes KI-Portal einer Firma. Eine Applikation hat Eingabefelder,
die eine Person ausfüllt, und 1 bis 3 KI-Schritte. Jeder Schritt ist ein Prompt mit eigener Rolle;
die Schritte laufen nacheinander.

Wunsch der Person:
"""<Beschreibung>"""

Antworte nur mit einem JSON-Objekt dieser Form:
{"name": "...", "bereich": "einer von: <Bereiche> (oder ein neuer)", "beschreibung": "ein Satz",
 "farbe": "#RRGGBB",
 "felder": [{"key": "...", "label": "...", "typ": "text"|"textarea"|"auswahl", "optionen": [...], "pflicht": true, "beispiel": "..."}],
 "schritte": [{"titel": "...", "rolle": "...", "modell": "quick"|"default", "prompt": "..."}]}

Regeln: 1 bis 6 Felder. In einem Prompt setzt du Felder mit {{key}} ein und Ergebnisse früherer
Schritte mit {{schritt1}}, {{schritt2}}. Die Prompts sind konkret, nennen das gewünschte Format
der Ausgabe und sind auf Deutsch.
```

**Normalisierung** (Antworten der KI nie ungeprüft übernehmen):
- Keys mit `slug()` säubern und eindeutig machen; Prompts entsprechend umschreiben (`{{OriginalKey}}` → `{{neuerKey}}`).
- Unbekannte Feldtypen → `text`; max. 10 Felder, max. 5 Schritte; Farbe nur bei gültigem Hex.
- Ohne Schritte → als Fehler behandeln („Entwurf unvollständig, erneut versuchen“).

**Umwandlung in eine App (Standard-Layout):**

```
Überschrift (H1, App-Name)
Text (Beschreibung)
Spalten (2)
 ├─ links:  Bereich mit Rahmen
 │           ├─ Überschrift (H3) „Eingaben“
 │           ├─ alle Eingabefelder
 │           └─ KI-Button „Ausführen“ (aktion = "alle")
 └─ rechts: je Schritt ein Ergebnis-Element (quelle = Step-ID, titel = Step-Name)
```

Schritt-Variablen werden `schritt1`, `schritt2` …

---

## 12. Speicherung

- Eine App = ein Dokument (z. B. Collection `apps`, Dokument-ID = `app.id`). Gespeichert wird das komplette App-JSON (ohne interne Hilfsfelder).
- Beispiel-Apps (Vorlagen) liegen im Code und werden beim Start in das aktuelle Format umgewandelt; sie sind nicht direkt editierbar, nur „als Kopie“.
- **Migration**: Dokumente ohne `blocks` (älteres Format mit `felder`/`schritte`) werden beim Laden über die Umwandlung aus Abschnitt 11 in Format v2 überführt.
- Im Prototyp: gemeinsamer Datenspeicher des Artifacts, Fallback `localStorage`. Im echten Projekt: Datenbank im Backend.

---

## 13. Vollständiges Beispiel einer App (Format v2)

```json
{
  "id": "app-meetingprotokoll",
  "v": 2,
  "typ": "baukasten",
  "name": "Meeting-Protokoll",
  "bereich": "Allgemein",
  "beschreibung": "Macht aus Besprechungsnotizen eine Zusammenfassung und eine Aufgabenliste.",
  "theme": { "accent": "", "bg": "", "font": "sans", "radius": "m", "width": "m" },
  "ki": { "anbieter": "claude", "endpoint": "" },
  "steps": [
    {
      "id": "s1abc", "name": "Zusammenfassung", "key": "schritt1",
      "rolle": "", "wissen": "",
      "prompt": "Fasse diese Besprechungsnotizen in höchstens fünf Stichpunkten zusammen. Führe offene Fragen gesondert unter ## Offen auf.\n\n{{notizen}}",
      "modell": "default", "format": "markdown", "autoAll": false
    },
    {
      "id": "s2def", "name": "Aufgabenliste", "key": "schritt2",
      "rolle": "", "wissen": "",
      "prompt": "Erstelle aus den Notizen eine Markdown-Tabelle mit den Spalten Aufgabe | Verantwortlich | Termin. Fehlt eine Angabe, schreibe „offen“.\n\nNotizen:\n{{notizen}}",
      "modell": "quick", "format": "markdown", "autoAll": false
    }
  ],
  "blocks": [
    { "id": "b1", "type": "heading", "props": { "text": "Meeting-Protokoll", "level": 1, "align": "left", "color": "" } },
    { "id": "b2", "type": "text", "props": { "text": "Notizen einfügen, ausführen, fertig.", "size": "m", "align": "left", "color": "" } },
    { "id": "b3", "type": "columns", "props": { "count": 2 }, "cols": [
      [
        { "id": "b4", "type": "section", "props": { "bg": "", "pad": "m", "border": true }, "children": [
          { "id": "b5", "type": "heading", "props": { "text": "Eingaben", "level": 3, "align": "left", "color": "" } },
          { "id": "b6", "type": "textarea", "props": { "label": "Besprechungsnotizen", "key": "notizen", "keyAuto": false, "pflicht": true, "hilfe": "", "placeholder": "", "rows": 9, "beispiel": "Projekt Umzug Lager Nord …" } },
          { "id": "b7", "type": "button", "props": { "text": "Ausführen", "aktion": "alle", "stil": "filled", "color": "", "align": "left" } }
        ] }
      ],
      [
        { "id": "b8", "type": "output", "props": { "titel": "Zusammenfassung", "quelle": "s1abc", "stil": "card" } },
        { "id": "b9", "type": "output", "props": { "titel": "Aufgabenliste", "quelle": "s2def", "stil": "card" } }
      ]
    ] }
  ],
  "geaendert": "2026-10-08T09:00:00.000Z"
}
```

---

## 14. Gestaltungsregeln

**Firmen-CI (abgeleitet von koerber.com, Stand Oktober 2026):**

| Rolle | Wert |
|---|---|
| Grund / Fläche / Abschnitt | `#FBFAF9` / `#FFFFFF` / `#F0EEEA` (warme Grautöne) |
| Text / gedämpft / Linien | `#00050D` / `#5C5A58` / `rgba(0,5,13,.15)` bzw. `#DEDAD4` |
| Hauptfarbe (Buttons, Auswahl, Links) | Blau `#0060FF`, dunkel `#004CCC`, sehr dunkel `#001C4C`, hell `#E5EFFF` |
| Akzente | Gelb `#FFE32F` (nur KI-Aktionen), Orange `#FE8623` (Werkzeugfarbe im Baukasten), Hellorange `#FEC037` |
| Display-Schrift | Hausschrift „fontKoerber“ 400, eng gesetzt (−0,02 bis −0,04 em); im Prototyp ersetzt durch Inter Tight |
| Text | Noto Sans 400/500/600 |
| Rubriken | Noto Sans Mono 12 px, Großbuchstaben, +0,035 em, mit kurzer Linie dahinter |
| Formen | Buttons als Pille (`border-radius: 999px`), Karten und Flächen scharfkantig, Listen mit Haarlinien |

- Startseite: Rubrik + große, leichte Display-Überschrift; links ein **Bereichsverzeichnis** (Haarlinien-Liste mit Farbfeld und Anzahl), rechts die Kacheln als bündiges Raster mit 1-px-Fugen.
- Bereichsfarben aus der CI-Palette, jeweils mit passender Schriftfarbe (`--aN` / `--aNi`).
- Im Zielsystem die lizenzierte Hausschrift und das offizielle Logo einbinden (im Prototyp bewusst nicht enthalten).

**Allgemein:**

- App-Farben über CSS-Variablen am App-Container: `--app-accent`, `--app-bg`, `--app-ink`, `--app-font`, `--app-radius`, `--app-max`. Abgeleitet: `--app-muted`, `--app-line`, `--app-soft` per `color-mix()`.
- Textfarbe auf farbigen Flächen (Hintergrund, Bereich, Button) automatisch per relativer Luminanz: hell → dunkle Schrift (`#14201C`), dunkel → helle Schrift (`#F3F6F5`), Schwelle ca. 0,38.
- `bg = ""` → App folgt Hell/Dunkel-Modus des Hubs.
- Spalten stapeln sich unter ca. 760 px Breite.
- Hub-Schriften im Prototyp: Bricolage Grotesque (Überschriften), IBM Plex Sans (Text), IBM Plex Mono (Variablen/Labels).

---

## 15. Offene Punkte / nächste Schritte

1. **Backend**: Speicherung in einer Datenbank, KI-Aufrufe über einen Server-Proxy (Schlüssel bleiben serverseitig).
2. **Copilot-Anbindung**: Adapter für Microsoft Copilot (bzw. Copilot Studio / Azure OpenAI) implementieren, `endpoint` pro App oder global setzen.
3. **Datei-Upload**: Bisher nur Textdateien. PDF/Word serverseitig in Text umwandeln, dann wie gehabt als Variable übergeben.
4. **Login & Rechte** (später): wer darf Apps bauen, veröffentlichen, nutzen; Bereiche je Abteilung.
5. **Weitere Bausteine**: Bild/Logo, Tabelle als Eingabe, Chat-Element (Rückfragen an einen Agenten), Download des Ergebnisses als Word/PDF.
6. **Logik im Ablauf**: Bedingungen („wenn Dropdown = X, dann Schritt Y“), Werkzeuge/Tools für echte Agenten.
7. **Versionierung** von Apps (Entwurf vs. veröffentlicht), Kacheln sortieren, eigene Icons.

---

## 16. Hinweise für die Umsetzung im bestehenden Projekt

- **Renderer zuerst**: Eine Funktion `renderApp(app, mode)` für `edit` und `run`. Alles andere (Kachel, Vorschau, Baukasten) baut darauf auf.
- **Zustand des Baukastens** getrennt halten: `{ app, sel, tab, preview }`. Bei Eingaben im Eigenschaften-Panel nur die Arbeitsfläche neu rendern (Fokus im Panel bleibt erhalten); bei Strukturänderungen (hinzufügen, löschen, verschieben, auswählen) Fläche **und** Panel.
- **IDs statt Indizes** für Verweise (Button → Step, Output → Step, Drop-Position → `beforeId`).
- **Variablen-Umbenennung immer propagieren** (Prompts + Hintergrundwissen).
- **Anfrage-Vorschau** und **„gesendete Anfrage ansehen“** beibehalten: Sie machen für Fachanwender sichtbar, was an die KI geht, und erleichtern die Fehlersuche bei der Copilot-Anbindung.
- **Keine personenbezogenen Daten in Beispielwerten**; Hinweis-Baustein („Bitte keine personenbezogenen Daten eingeben“) als Standard anbieten.

---

## 17. Erweiterungen für den Geschäftseinsatz

### 17.1 KI-Assistent im Baukasten (Oberfläche per Prompt bauen)

Über der Arbeitsfläche gibt es ein Eingabefeld „KI-Assistent“. Die Person beschreibt, was entstehen oder sich ändern soll („Mach daraus ein Reisekosten-Formular mit Datum, Betrag und Beleg-Upload, Akzentfarbe Dunkelblau“). Die KI verändert die **aktuelle** App, nicht eine neue.

- **Umfang wählbar**: „Oberfläche + Ablauf“, „Nur Oberfläche“ (Steps bleiben unverändert), „Nur Design“ (nur `theme` und die optischen Props `align, color, size, level, bg, pad, border, stil, tone, h` bestehender Blöcke werden übernommen).
- **Anfrage an die KI**: Schema-Beschreibung aller Blocktypen und Props, Regeln (IDs beibehalten, neue IDs kurz wie `n1`, jede wichtige Eingabe in einem Prompt, mindestens ein KI-Button, je Schritt ein Ergebnis-Element), die aktuelle App als JSON (Bilddaten durch `"[bild]"` ersetzt), der Wunsch. Antwortformat: `{"zusammenfassung": "...", "app": {name, bereich, beschreibung, theme, blocks, steps}}`.
- **Prüfung der Antwort** (`sanitizeApp`): unbekannte Blocktypen verwerfen, Props mit Standardwerten auffüllen, Aufzählungswerte und Farben (`#RRGGBB`) prüfen, IDs säubern und eindeutig machen, Keys per `slug()` eindeutig machen und Umbenennungen in Prompts und Bedingungen nachziehen, Verweise reparieren (Button-`aktion` inkl. `ab:`, Output-`quelle`), Bilder aus dem Original wiederherstellen.
- Hat die Person während der Wartezeit weitergearbeitet, wird der Vorschlag **nicht** übernommen (Vergleich des App-JSON vorher/nachher).
- Verlauf der Assistenten-Änderungen mit „Rückgängig“ am letzten Eintrag. Bei einer leeren App baut der Assistent alles neu auf.

### 17.2 Rückgängig / Wiederholen, Schutz vor Datenverlust

- Vor jeder Änderung wird das App-JSON auf einen Undo-Stapel gelegt (max. 80). Tippen in einem Feld wird zusammengefasst (neuer Eintrag erst nach 1,5 s Pause oder bei Feldwechsel).
- Strg+Z / Strg+Y (bzw. Strg+Umschalt+Z) außerhalb von Textfeldern, Buttons ↶ ↷ in der Leiste.
- Verlassen mit ungespeicherten Änderungen → Rückfrage im Seiteninhalt: Speichern / Verwerfen / Weiter bearbeiten.

### 17.3 Ablaufsteuerung

- **Button-Bereich**: `aktion` = `"alle"` | Step-ID (nur dieser Schritt) | `"ab:<Step-ID>"` (dieser und alle folgenden). Typisch: Button 1 „Checkliste analysieren“ = nur Schritt 1; Button 2 „Zusammenfassen und Paket erstellen“ = ab Schritt 2.
- **Pflichtfelder nur für die gestarteten Schritte prüfen**: Ein Feld ist nötig, wenn einer der gestarteten Schritte es nutzt (Platzhalter oder `autoAll`).
- **Abhängigkeiten**: Nutzt ein gestarteter Schritt `{{schrittX}}` eines früheren Schritts, der weder mitläuft noch schon ein Ergebnis hat, wird nicht gestartet; Meldung „… braucht das Ergebnis von …“.
- **Bedingungen**: Ein Schritt läuft nur, wenn `feld` `gleich`/`ungleich` `wert` ist bzw. `gefuellt`/`leer` (Checkbox „nein“ zählt als leer). Sonst Status „übersprungen“, Ergebnis-Variable = leer.

### 17.4 Dateipakete und Downloads

- Ausgabeformat `dateien`: Die KI antwortet mit `{"hinweis": "...", "dateien": [{"pfad": "Ordner/Unterordner/Datei.md", "inhalt": "..."}]}`. Pfade werden gesäubert (keine `<>:"|?*`, keine `..`), max. 200 Dateien.
- Darstellung: Hinweis, Ordnerbaum (├── └──), aufklappbare Dateien. Button „ZIP herunterladen“ (im Prototyp mit JSZip). Name = gemeinsamer oberster Ordner oder Slug des App-Namens.
- Andere Formate: „Als Datei speichern“ (.md / .txt / .json).
- Zielsystem: Zusätzlich zum ZIP-Download kann das Paket über Graph direkt in SharePoint angelegt werden (siehe 18.4).

### 17.5 Dateien lesen

- Word (.docx) → Rohtext, Excel (.xlsx/.xls) → je Tabellenblatt `## Tabellenblatt: <Name>` + CSV mit `;`, PDF → Text je Seite (max. 200 Seiten), sonst als Text. Max. 60.000 Zeichen, Hinweis bei Kürzung oder fehlendem Text (z. B. eingescanntes PDF). Nicht unterstützt: .doc, .ppt(x), .msg.
- Im Zielsystem besser serverseitig lesen; bei Übergabe „referenz“ geht die Datei stattdessen als Verweis an Copilot.

### 17.6 Freigabe und Governance

- Status Entwurf / In Prüfung / Freigegeben, Verantwortlich, Schutzklasse, Version (+1 pro Speichern), „zuletzt gespeichert“.
- Kachel zeigt „Entwurf“/„In Prüfung“, die App-Ansicht zeigt Version, Status, Schutzklasse, Verantwortlich.
- Ausbau im Zielsystem: nur freigegebene Apps für alle sichtbar, Freigabe durch berechtigte Rolle, Versionshistorie mit Wiederherstellen.

### 17.7 Export / Import

- App als JSON anzeigen, kopieren, bearbeiten und wieder übernehmen (dieselbe Prüfung wie beim KI-Assistenten; Bilder nur als `data:image/...`).

---

## 18. Zielsystem: Microsoft 365 Copilot über Microsoft Graph

> Endpunkte und Felder entsprechen dem Stand Mitte 2026 (teils Beta). **Vor der Umsetzung mit der aktuellen Microsoft-Graph-Dokumentation abgleichen.**

### 18.1 Was sich gegenüber dem Prototyp ändert

| Thema | Prototyp | Copilot über Graph |
|---|---|---|
| KI-Anbindung | Claude, im Prototyp fest eingebaut | **zentrale Azure-Anwendung** des Hubs, für alle Apps gleich, nicht pro App einstellbar |
| Anmeldung | keine | Single Sign-on über MSAL mit dem Windows-Konto (wie beim bestehenden Token-Hilfsprogramm), Token für delegierte Graph-Berechtigungen, ca. 45 Minuten zwischengespeichert |
| Lizenz | – | Microsoft-365-Copilot-Lizenz je Nutzer |
| System-Anweisung | eigener Teil | keine getrennte System-Nachricht → `system + "\n\n---\n\n" + nachricht` als eine Nachricht |
| Modellwahl | Schnell / Standard / Gründlich | ohne Wirkung (Copilot wählt selbst) |
| Wissensquellen | nur Name/Adresse mitgeschickt | SharePoint durchsuchen (Retrieval API) oder Dateien als Kontext übergeben |
| Hochgeladene Dateien | Text wird im Browser gelesen | `uebergabe = "referenz"`: nach OneDrive hochladen, als Datei-Verweis übergeben |
| Websuche | – | `webContext.isWebEnabled` je Schritt (`step.web`) |
| Ergebnis-Ablage | ZIP-Download | ZIP-Download **und/oder** direkt nach SharePoint schreiben |

### 18.2 Ablauf eines KI-Schritts (zentrale KI-Anbindung)

Entspricht dem bereits genutzten Ablauf aus der Copilot-Verbindung für EPLAN/Visio: Token über die zentrale App-Registrierung (MSAL, Single Sign-on), Gespräch anlegen, Nachricht senden, als Antwort den **letzten Text in `messages`, der nicht die eigene Frage ist**, übernehmen. Antworten als UTF-8 lesen (sonst gehen Umlaute kaputt), Wartezeit auf die Antwort großzügig bemessen (bisher 3 Minuten).

```
// Bei jedem Aufruf: Authorization: Bearer <Token der zentralen Azure-Anwendung>
// 0) Nur bei Datei-Feldern mit uebergabe = "referenz": Datei nach OneDrive legen
PUT https://graph.microsoft.com/v1.0/me/drive/root:/KI-Hub/<dateiname>:/content
<Dateiinhalt>

// 1) Nur wenn der Schritt SharePoint-Quellen hat: passende Textauszüge holen (Retrieval API)
POST https://graph.microsoft.com/v1.0/copilot/retrieval
{
  "queryString": "<Suchbegriffe aus Aufgabe und Eingaben>",
  "dataSource": "sharePoint",
  "filterExpression": "path:\"https://firma.sharepoint.com/sites/QM/\"",
  "maximumNumberOfResults": 10
}
// -> gefundene Auszüge der Nachricht als Hintergrundwissen voranstellen

// 2) Gespräch anlegen (einmal pro Durchlauf)
POST https://graph.microsoft.com/beta/copilot/conversations
{}

// 3) Nachricht senden; Antwort ist Text
POST https://graph.microsoft.com/beta/copilot/conversations/{conversationId}/chat
{
  "message": { "text": "<system>\n\n---\n\n<nachricht>" },
  "locationHint": { "timeZone": "Europe/Berlin" },
  "contextualResources": {
    "files": [ { "uri": "https://firma.sharepoint.com/.../Datei.docx" } ],
    "webContext": { "isWebEnabled": false }
  }
}
```

Der Prototyp zeigt diese Übersetzung je Schritt an: im Reiter KI-Ablauf (Anfrage-Vorschau → „Copilot (Microsoft Graph)“) und nach jedem Lauf unter „So ginge die Anfrage an Copilot“.

### 18.3 Neutrales Anfrageformat (erweitert)

```json
{
  "applikation": "Dokumentenvorbereitung",
  "applikationId": "app-muzti412o4hy",
  "schritt": "Checkliste analysieren",
  "modell": "default",
  "ausgabeformat": "markdown",
  "websuche": false,
  "wissensquellen": [ { "typ": "sharepoint", "titel": "QM-Bibliothek", "url": "https://firma.sharepoint.com/sites/QM/Freigegebene Dokumente" } ],
  "dateien": [ { "feld": "checkliste", "uebergabe": "referenz", "name": "Checkliste.xlsx", "typ": "xlsx", "groesse": 18233 } ],
  "system": "…",
  "nachricht": "…",
  "variablen": { "checkliste": "…", "text": "…" }
}
```

### 18.4 Empfohlene Architektur im Zielsystem

- **Frontend** (Hub + Baukasten) wie im Prototyp; Anmeldung über MSAL (Entra ID) mit der zentralen App-Registrierung.
- **Zentrale KI-Anbindung = eine Azure-Anwendung** (App-Registrierung in Entra ID) für den ganzen Hub. Sie wird einmal konfiguriert (Client-ID, Tenant, Berechtigungen) und von allen Applikationen genutzt. Ob die bestehende Registrierung aus der EPLAN/Visio-Anbindung weiterverwendet oder eine eigene für den Hub angelegt wird, ist **offen (TODO: mit IT klären)**.
- **Wo der Graph-Aufruf läuft**: entweder direkt aus dem Browser mit dem Token der angemeldeten Person (wie bisher aus VBA) oder über einen schlanken Backend-Dienst (z. B. Azure Function, On-Behalf-Of-Fluss). **Offen (TODO)**; der Backend-Weg ist nötig, sobald Protokollierung, Freigaben oder Mengenbegrenzung zentral laufen sollen.
- **Berechtigungen** (delegiert, Admin-Zustimmung): die der bestehenden Registrierung als Ausgangspunkt (u. a. `Sites.Read.All`); Schreibrechte nur, wenn Ergebnisse in SharePoint abgelegt werden sollen. Genaue Scopes je API aus der Graph-Doku übernehmen.
- **ZIP-Download** funktioniert im Zielsystem wie im Prototyp im Browser (z. B. mit JSZip), unabhängig von Copilot.
- **Ablage in SharePoint** statt oder zusätzlich zum ZIP: Ordner anlegen (`POST /drives/{drive-id}/items/{parent-id}/children` mit `"folder": {}`), Dateien hochladen (`PUT /drives/{drive-id}/items/{parent-id}:/<pfad>:/content`). Im Baukasten als Option am Ergebnis-Element: „Paket in SharePoint ablegen unter: <Bibliothek/Ordner>“.
- **App-Speicher**: z. B. SharePoint-Liste, Dataverse oder eigene Datenbank; ein Dokument je App (JSON wie in Abschnitt 13).
- **Copilot sieht nur, was der Nutzer sehen darf**: Wissensquellen respektieren die SharePoint-Berechtigungen des angemeldeten Nutzers.

---

## 19. Agenten-Team (Schritt-Art „team“)

Mehrere KI-Agenten bekommen eine Ausgangslage und ein Ziel und finden den Weg selbst. Eine Moderation entscheidet in jeder Runde, wer spricht und wann das Ziel erreicht ist. Der Verlauf ist in der App live zu sehen.

**Datenmodell** (Ergänzung zu `Step`):

```ts
art: "prompt" | "team";              // Standard "prompt"
team?: {
  ziel: string;                      // darf {{variablen}} enthalten
  maxRunden: number;                 // 2–20, Standard 8
  moderation: string;                // zusätzliche Regeln für die Moderation
  agenten: { id: string; name: string; rolle: string }[];   // 2–6 Agenten
};
// Bei art "team" ist `prompt` die Aufgabe bzw. Ausgangslage.
```

**Ablauf je Runde** (jeder Aufruf ist eine normale Anfrage an die zentrale KI-Anbindung, der Verlauf wird jedes Mal mitgegeben):

1. **Moderation**: bekommt Aufgabe, Ziel, Agentenliste, bisherigen Verlauf (gekürzt auf ca. 14.000 Zeichen) und antwortet nur mit JSON:
   - `{"status": "weiter", "naechster": "<Name>", "auftrag": "…", "begruendung": "…"}` oder
   - `{"status": "fertig", "ergebnis": "…", "begruendung": "…"}`
2. **Agent**: bekommt seine Rolle, die anderen Rollen, Aufgabe, Ziel, Verlauf und den Auftrag; antwortet mit höchstens 250 Wörtern.
3. Nach `maxRunden` erzwingt eine letzte Moderationsrunde das Endergebnis.
- Ist die Moderationsantwort kein gültiges JSON, wird reihum der nächste Agent mit der Antwort als Auftrag beauftragt.
- Das Endergebnis folgt dem Ausgabeformat des Schritts (auch `dateien`) und steht unter `{{<key>}}` späteren Schritten zur Verfügung.

**Oberfläche**: Im Reiter KI-Ablauf Art „Agenten-Team“, dazu Ziel (mit Platzhaltern), höchstens Runden, Agenten (Name, Rolle, 2–6) und Regeln für die Moderation. In der App zeigt das Ergebnis-Element Moderationsentscheidungen und Beiträge (mit Kürzel je Agent) und darunter das Endergebnis. Beispiel-App: „Agenten-Team“ (Ausgangslage, Ziel, Rahmenbedingungen; Planer, Fachexperte, Prüfer, Umsetzer).

**Prüfung**: mindestens zwei Agenten, ein Ziel; Hinweis bei Agenten ohne Rolle.

---

## 20. Umsetzung als Projekt (Stand Oktober 2026)

Der Einzeldatei-Prototyp ist in ein Projekt überführt (`prototyp/` enthält die alte Fassung).

- **Stack**: React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, React Router 8 (View Transitions beim Seitenwechsel), Motion 14, dnd-kit, Zod 4, DOMPurify, MSAL 5, mammoth, read-excel-file, pdf.js, JSZip. SheetJS (`xlsx`) wurde wegen einer offenen Sicherheitslücke durch `read-excel-file` ersetzt (liest nur `.xlsx`, nicht mehr `.xls`).
- **Ein Schema für alles**: `src/lib/schema.ts` (Zod) liefert Typen, Standardwerte (`PropsSchemas[type].parse({})` ergibt einen neuen Baustein), die Prüfung fremder Daten (`sanitizeApp`: jedes Feld einzeln gegen das Schema, ungültig → Standardwert) und den Schema-Teil im Prompt des KI-Assistenten (`z.toJSONSchema`).
- **Sicherheit**: KI-Ausgaben und Markdown werden mit DOMPurify bereinigt, bevor sie als HTML erscheinen; importiertes JSON läuft durch `sanitizeApp`. Bilder nur als `data:image/…` bis ca. 400 KB. Content Security Policy in `public/staticwebapp.config.json`.
- **Ablaufsteuerung** in `src/lib/runner.ts` (Pflichtfelder je gestartetem Schritt, Abhängigkeiten, Bedingungen, Dateipakete, Agenten-Team), KI-Zugriff nur über `src/lib/ki/index.ts` (`kiSenden`, `kiFragen`), Copilot-Aufrufe in `src/lib/ki/copilot.ts`, Anmeldung in `src/lib/ki/auth.ts` (MSAL 5 mit Weiterleitungsseite `auth-redirect.html`).
- **Simulationsmodus**: Ohne konfigurierte Azure-Anwendung zeigt jeder Schritt die Anfrage, die gesendet würde; der KI-Assistent ist dann gesperrt.
- **Speicher**: `src/lib/store.ts` mit `local` (Browser) und `sharepoint` (eine JSON-Datei je App über Graph). Beim Laden werden ältere Formate (`felder`/`schritte`, Feld `ki`) automatisch umgewandelt.
- **Baukasten**: Verlauf mit Zusammenfassen von Tippschritten (`useBuilder`), Schutz vor Datenverlust (`useBlocker` + `beforeunload`), Ziehen und Ablegen mit dnd-kit: Ablagestelle ist die innerste Liste bzw. der innerste Baustein unter dem Zeiger, ein Container und seine Unterlisten sind beim Ziehen als Ziel gesperrt, Ablagestellen werden während des Ziehens laufend neu gemessen, automatischer Bildlauf erst im äußersten Zehntel des Fensters.
- **Animation** (Regeln): Motion für Kacheln beim Filtern und erscheinende Ergebnisse/Beiträge, dnd-kit für ausweichende Bausteine, View Transitions für Seitenwechsel; 150–250 ms für Bedienelemente, höchstens 400 ms für Seitenwechsel, ease-out beim Erscheinen, ease-in beim Verschwinden, Federn nur beim Ablegen; nur `transform` und `opacity`; bei reduzierter Bewegung nur Überblendung (`MotionConfig reducedMotion="user"`).
- **Tests**: Playwright (`e2e/`) für Startseite, App-Ansicht, Baukasten und „Neue Applikation“ in 1440 px und 390 px: Blättern statt Scrollen (die Seite selbst scrollt nie), Ziehen aus der Palette in eine Spalte, Verschieben zwischen Spalten, Verbot, einen Container in sich selbst abzulegen, Verschieben auf einen Seiten-Reiter.

### 20.1 Entscheidungen aus Design-Review und Barrierefreiheits-Audit

- **Farbbedeutung**: Gelb ausschließlich für KI-Aktionen. KI-Buttons sind ohne eigene Farbwahl gelb mit dunkler Schrift, ein laufendes Ergebnis wird gelb gerahmt. Orange nur als Werkzeugfarbe im Baukasten. Bereichsfarben nur aus Blau-, Tinte- und Warmgrau-Stufen.
- **App-Ansicht**: sichtbar sind Bereich und ggf. „Entwurf“/„In Prüfung“; Version, Status, Schutzklasse, Verantwortlich und Änderungsdatum unter „Details“. Anfrage und Graph-Übersetzung gemeinsam unter „Technische Details“.
- **Überschriften**: In der App wird die erste Überschrift zum h1, folgende Ebenen werden ohne Sprünge abgeleitet (die gewählte Größe bleibt optisch erhalten). Im Baukasten trägt die Seite ein unsichtbares h1.
- **KI-Assistent**: ohne KI-Anbindung nur eine einzeilige Notiz; mit Anbindung aufklappbar (anfangs zu; neue Apps entstehen über „Neue Applikation“, siehe 21.5), Umfangsschalter erst nach Eingabe eines Wunsches.
- **Schritt-Karte**: sichtbar Name, Art, „Aufgabe für die KI“ mit Einsetz-Knöpfen (zeigen Feldnamen, setzen `{{key}}` ein) und „Bekommt: …“. Name des Ergebnisses, Modell, Ausgabe, Rolle, „Alle Eingaben anhängen“, Websuche und Bedingung unter „Feineinstellungen“.
- **Begriffe**: Auswahlliste (statt Dropdown), Ankreuzfeld (statt Checkbox), Platzhalter (statt Variable), Aufgabe für die KI (statt Prompt). Feld-Schilder: „geht an Schritt n“ bzw. „geht an keinen KI-Schritt“.
- **Tastatur**: Strg+Enter startet in einer App den ersten KI-Button, Strg+S speichert im Baukasten, „/“ springt in die Hub-Suche. Auf der Arbeitsfläche: Eingabetaste öffnet die Eigenschaften, Leertaste verschiebt, Entf löscht.
- **Löschen**: Bausteine und Schritte werden ohne Rückfrage gelöscht, aber mit Hinweis „Rückgängig“ und Ansage für Screenreader.
- **Hub**: Bereich und Suche stehen in der Adresse (`?bereich=…&q=…`); Kürzel der Kacheln werden bei Gleichstand eindeutig gemacht; „Vorlage“ wird nicht mehr als Schild gezeigt.
- **Mobil**: Kopfzeile einzeilig, KI-Status als Punkt mit erklärendem Popover, Bereiche als Auswahlliste (siehe 21.3), App-Aktionen im Menü „Weitere Aktionen“.

### 20.2 Testmodus mit Claude

- KI-Modus: `copilot` (zentrale Azure-Anwendung konfiguriert) hat Vorrang; läuft der Hub als Artifact auf claude.ai, gilt `claude-test`: Claude beantwortet die Anfragen über die Laufzeitfunktion des Viewers (`src/lib/ki/claudeTest.ts`); sonst `simulation`. Die neutrale Anfrage bleibt in allen Modi gleich.
- Testfassung bauen: `npx vite build --mode artifact --outDir dist-artifact` (relative Pfade, Adressen über `#/…`, ohne Anmeldeseite). Downloads laufen dort über die Download-Funktion des Viewers. Der pdf.js-Worker wird nicht mitveröffentlicht, PDF-Lesen ist in der Testfassung daher nicht verfügbar.

## 21. Seiten statt Scrollen

Grundsatz: Niemand soll scrollen müssen, weder senkrecht noch waagrecht. Inhalte, die nicht auf einen Bildschirm passen, stehen auf eigenständigen Seiten; man blättert mit „Zurück“ und „Weiter“. Der Wechsel ist eine reine Überblendung (nur `opacity`, ease-out, 200 ms; kein seitliches Gleiten).

### 21.1 Datenmodell: Baustein „seite“

- Neuer Bausteintyp `seite` mit `props: { titel: string (max. 60, Standard „Seite“) }` und `children: Block[]`.
- **Die oberste Ebene von `blocks` besteht ausschließlich aus Seiten.** Seiten dürfen nicht verschachtelt werden (`sanitizeApp` verwirft `seite` unterhalb der obersten Ebene).
- Ältere Apps und fremde Daten werden beim Laden automatisch aufgeteilt (`seitenSicherstellen` in `src/lib/model.ts`): lose Bausteine kommen auf eine Seite „Eingaben“, jedes Ergebnis-Element wird herausgelöst und bekommt eine eigene Seite mit dem Namen seines KI-Schritts. Leere Bereiche und Spalten, die dadurch entstehen, entfallen; Spalten mit nur einer gefüllten Spalte werden aufgelöst. Bereits vorhandene Seiten bleiben unverändert.
- Neue Apps (`newApp`, `fromSimple`) bestehen aus Seite „Eingaben“ (Überschrift, Erklärung, Eingabebereich mit KI-Button) und je KI-Schritt einer Ergebnisseite.
- Prüfung: eine leere Seite ist ein weicher Hinweis. Ein Schritt ohne Ergebnis-Element zeigt sein Ergebnis auf der letzten Seite.
- KI-Assistent und KI-Entwurf bekommen die Regel: oberste Ebene nur Seiten, je Seite höchstens etwa 5 Eingabefelder oder ein Ergebnis, Ergebnisse auf eigenen Seiten, Folgeeingaben mit ihrem Button auf einer Seite nach dem Ergebnis, das sie nutzen.

### 21.2 Verhalten in der App

- Es ist immer genau eine Seite sichtbar. Unten in der App steht die Seitenleiste: „Zurück“, Seitenpunkte, Titel und „x von y“, „Weiter: ‹Titel der nächsten Seite›“ (auf dem Handy nur „Weiter“). Bild↑/Bild↓ blättern, solange kein Eingabefeld den Fokus hat.
- Startet ein KI-Button, blättert die App zur Seite mit dem Ergebnis-Element des ersten gestarteten Schritts (ohne Ergebnis-Element: letzte Seite).
- Fehlt ein Pflichtfeld auf einer anderen Seite, blättert die App dorthin und setzt den Fokus in das Feld. Nach jedem Seitenwechsel liegt der Fokus am Seitenanfang (bzw. im fehlenden Feld).
- Strg+Enter startet den ersten KI-Button der aktuellen Seite, sonst den ersten der App.
- **Breite**: Hub, App und Baukasten nutzen die volle Fensterbreite (Begrenzung erst bei 2200 px). Die App-Breite aus der Gestaltung bedeutet: „Schmal“ 760 px, „Normal“ bis 1600 px, „Breit“ volle Breite.
- **Eingaben nebeneinander** (nur in der App, nicht auf der Bearbeitungsfläche): Folgen mehrere kurze Eingaben (Textzeile, Auswahl, Zahl, Datum, Ankreuzfeld, Datei) oder mehrere Textfelder direkt aufeinander, stehen sie in einer Reihe nebeneinander (kurze ab 220 px, Textfelder ab 300 px Breite je Feld, sonst untereinander). Die Reihenfolge für Tastatur und Screenreader bleibt die des Baums.
- **Verdichtung**: Passt eine Seite trotzdem nicht, verdichtet die App sie in bis zu zwei Stufen (kleinere Abstände und Überschrift, Textfelder höchstens 120 bzw. 76 px hoch, in Stufe 2 ohne Hilfetexte). Bei Seitenwechsel oder geänderter Fenstergröße wird neu gemessen.
- Ist eine Seite auch verdichtet höher als der Bildschirm (z. B. auf dem Handy), scrollt nur der Inhalt dieser Seite in sich; Kopfzeile und Seitenleiste bleiben stehen.

### 21.3 Verhalten im Hub

- Die Kacheln füllen genau den freien Platz. Spalten und Zeilen werden aus der verfügbaren Fläche berechnet; was nicht passt, steht auf der nächsten Seite („Seite x von y“). Filter oder Suche beginnen wieder bei Seite 1.
- Unter 900 px Breite ist der Bereichsfilter eine Auswahlliste; unter 560 px sind Kacheln kompakte Zeilen (Kürzel, Name, zwei Zeilen Beschreibung).
- Die Kachel „Neue Applikation“ führt zur Erstellung per KI (21.5).

### 21.4 Verhalten im Baukasten

- Der Baukasten füllt das Fenster; Palette, Fläche und Eigenschaften scrollen höchstens in sich.
- **Oberfläche**: Über der Fläche stehen die Seiten-Reiter und „+ Seite“ (fügt hinter der aktuellen Seite ein). Die Fläche zeigt immer nur die aktuelle Seite. Ein Klick auf einen Reiter wechselt die Seite und zeigt ihre Eigenschaften (Titel, nach vorn/hinten verschieben, duplizieren, löschen; die letzte Seite kann nicht gelöscht werden). Ein Baustein, der auf einen Reiter gezogen wird, wandert ans Ende dieser Seite; die Fläche wechselt mit. Zusätzlich hat jeder Baustein in den Eigenschaften „Steht auf Seite“. Wird eine Seite höher als die Fläche, erscheint der Hinweis, einen Teil auf eine neue Seite zu verschieben. Die Fläche folgt der Auswahl (z. B. nach Rückgängig).
- Die Palette ist auf breiten Bildschirmen ein Zweier-Raster, bei mittlerer Breite eine Symbolleiste; Seiten entstehen nur über „+ Seite“. App-Einstellungen sind in „Allgemein“, „Gestaltung“ und „Freigabe“ geteilt.
- **KI-Ablauf**: links die Schrittliste (Eingaben → Schritte → Ergebnis, offene Punkte als roter Punkt), in der Mitte genau ein Schritt mit den Reitern „Aufgabe“, „Agenten“ (nur beim Agenten-Team), „Feineinstellungen“ und „Wissen“, rechts „Anfrage“ (Vorschau für den gewählten Schritt), „Prüfung“ und „Anbindung“.
- **Schmal** (unter 780 px bzw. 980 px im KI-Ablauf): Umschalter „Bausteine | Fläche | Eigenschaften“ bzw. „Schritte | Vorschau und Prüfung“; es ist immer nur ein Bereich sichtbar. Hinzufügen per Klick springt zurück zur Fläche, Doppelklick bzw. Eingabetaste auf einem Baustein öffnet die Eigenschaften.

### 21.5 Neue Applikation per KI (`/neu`)

Drei eigenständige Seiten mit Fortschrittsanzeige:

1. **Beschreiben**: Was soll die Applikation tun (Freitext, Beispiele zum Übernehmen), optional Hintergrundwissen und Regeln, Bereich. „Entwurf erstellen“ schickt einen leeren Entwurf (`leereApp`) mit diesem Wunsch an den KI-Assistenten (Umfang „alles“); Hintergrundwissen landet im Feld `wissen` der passenden Schritte. Ohne KI-Anbindung: Hinweis und Weg in den Baukasten.
2. **Entwurf testen**: Der Entwurf läuft als echte App (Eingaben und KI-Buttons funktionieren, nichts ist gespeichert). Daneben Zusammenfassung (Seiten, Eingaben, Schritte), Änderungsverlauf und „Was soll anders werden?“ → „Entwurf ändern“. „Im Baukasten feinschleifen“ übergibt den Entwurf an den Baukasten (Navigationszustand `entwurf`, dort über `loadApp` geprüft).
3. **Speichern**: Name, Bereich, Kurzbeschreibung, Verantwortlich, Schutzklasse, Status. Harte Prüfpunkte verhindern das Speichern und verweisen auf den Baukasten.

Auf dem Handy wechselt Seite 2 zwischen „Ausprobieren“ und „Anpassen“.

## 22. Ergebnis als fertige Datei (PDF, Word, Excel, PowerPoint)

Die KI liefert nur Inhalt (Markdown); die Datei erzeugt der Hub selbst im Browser. Damit entfällt der Umweg „HTML erzeugen und als PDF drucken“.

### 22.1 Datenmodell

- Neues Feld am KI-Schritt: `datei: "" | "pdf" | "docx" | "xlsx" | "pptx" | "wunsch"` (Standard `""`). Nur wirksam bei `format` `markdown` oder `text`.
- `"wunsch"`: Die Datei-Art wird aus der ausgefüllten Aufgabe samt Eingaben erkannt (Stichwörter PowerPoint/Präsentation, Excel/Tabellenblatt, Word, PDF), z. B. über eine Auswahlliste „Ausgabe als“. Wird nichts erkannt, gibt es keine Hauptdatei.
- Die neutrale Anfrage enthält `ergebnisDatei` (die tatsächlich gewählte Datei-Art oder `null`). Ist sie gesetzt, bekommt die System-Anweisung einen Hinweis je Datei-Art: nur Markdown, kein HTML, keine Druck-Hinweise; für Excel Markdown-Tabellen (Überschrift davor = Blattname), für PowerPoint `##` je Folie mit 3 bis 6 Stichpunkten.
- Dateipakete (`format: "dateien"`): Dateien mit Endung `.pdf`, `.docx`, `.xlsx`, `.pptx` werden beim Packen aus ihrem Markdown-Inhalt als echte Dateien erzeugt.

### 22.2 Umsetzung (`src/lib/dokument.ts`)

- Aus dem Ergebnis entsteht ein Dokumentmodell (Überschriften, Absätze mit fett/kursiv/Code, verschachtelte Listen, Tabellen, Code, Trennlinien). Liefert die KI doch HTML, wird es in dasselbe Modell übertragen (Skripte und Stile fallen weg); ein JSON-Array von Objekten wird zur Tabelle.
- **PDF** (pdfmake): A4, Kopfzeile mit App-Name und Datum, Titel mit Akzentlinie, Seitenzahlen „Seite x von y“.
- **Word** (docx): Formatvorlagen Titel/Überschrift 1–4, echte Aufzählungen und Nummerierungen, Tabellen mit Kopfzeile (wiederholt sich auf jeder Seite), Kopf- und Fußzeile mit Seitenzahl.
- **Excel** (write-excel-file): jede Tabelle ein Blatt (Name aus der Überschrift davor), fette Kopfzeile, fixiert, Spaltenbreiten nach Inhalt, Zahlen im deutschen Format werden als Zahlen gespeichert. Ohne Tabellen steht der Text zeilenweise auf einem Blatt.
- **PowerPoint** (pptxgenjs, 16:9): Titelfolie, je `#`/`##`-Abschnitt eine Folie, höchstens 8 Punkte je Folie, Tabellen höchstens 10 Zeilen je Folie, sonst Fortsetzungsfolien.
- Farben aus den Körber-Tokens; Akzent ist die Akzentfarbe der App, sonst Körber-Blau. Die Bibliotheken werden erst beim Herunterladen geladen.

### 22.3 Bedienung

- Baukasten, KI-Ablauf, Reiter „Feineinstellungen“: „Ergebnis als fertige Datei“ (Keine, PDF, Word, Excel, PowerPoint, Wie in Aufgabe oder Eingabe verlangt).
- Unter jedem fertigen Ergebnis: Hauptknopf „‹Art› herunterladen“ (wenn eingestellt bzw. erkannt) und das Menü „Als Datei herunterladen“ bzw. „Andere Datei“ mit allen vier Arten und dem Rohtext.

### 22.4 Dateipakete mit Dokumenten

- `datei` wirkt auch bei `format: "dateien"`: Die KI bekommt die Anweisung, Dokumente im Paket als Markdown (`.md`) statt als HTML zu schreiben. Beim Herunterladen des ZIP werden HTML-, Markdown- und Textdateien in die eingestellte Art umgewandelt (Endung wird angepasst).
- Unabhängig von der Einstellung: Enthält ein Paket genau ein Dokument (HTML, Markdown, Text), gibt es unter dem Ergebnis „PDF herunterladen“ (bzw. die eingestellte Art) und das Menü für die anderen Arten. Bei mehreren Dokumenten hat jede Datei in der Liste ihr eigenes Menü.

## 23. Automatischer Durchlauf und Ergebnisübersicht

### 23.1 Verhalten in der App

- **Eingabeseiten und Ergebnisseiten**: Eine Seite, die mindestens ein Ergebnis-Element und weder Eingaben noch KI-Buttons enthält, ist eine Ergebnisseite. Geblättert wird nur durch die Eingabeseiten; danach folgt die Seite **„Ergebnisse“**.
- **Automatischer Durchlauf**: „Weiter“ auf der letzten Eingabeseite heißt „Ergebnisse erstellen“ und startet alle KI-Schritte nacheinander (wie ein Button mit „alle“), sofern noch nichts gelaufen ist. Fehlen Pflichtfelder, springt die App zum ersten fehlenden Feld. Ein KI-Button, dessen erster Schritt sein Ergebnis auf einer Ergebnisseite zeigt, führt ebenfalls in die Übersicht. Steht das Ergebnis auf einer Eingabeseite, bleibt es beim Blättern dorthin.
- **Ergebnisübersicht**: je Ergebnisseite eine Kachel (Titel = Seitentitel), dazu je Schritt ohne Ergebnis-Element eine Kachel (Titel = Schrittname). Jede Kachel zeigt Status (wartet, läuft, fertig, Simulation, übersprungen, Fehler) und eine Vorschau des Ergebnisses; die laufende Kachel ist gelb gerahmt. Oben: Stand „x von y fertig“, Knopf „Ergebnisse erstellen“ / „Stoppen“ / „Neu erstellen“ und der Hinweis, wenn die Eingaben seit dem letzten Start geändert wurden.
- **Einzelnes Ergebnis**: Ein Klick auf eine Kachel öffnet die Ergebnisseite allein, mit „Alle Ergebnisse“ oben und Blättern zwischen den Ergebnissen unten (inkl. Download-Knöpfen der Ergebnisse).
- Apps ohne Ergebnisseiten (alle Ergebnis-Elemente stehen auf Eingabeseiten) und ohne Schritte ohne Ergebnis-Element bekommen keine Übersicht.
- Der KI-Assistent legt alle Eingaben (auch die für spätere Schritte) auf Eingabeseiten vor den Ergebnissen, damit der Ablauf in einem Durchgang laufen kann.

### 23.2 Zusatz-Platzhalter für Datei-Felder

Für jedes Datei-Feld mit Platzhalter `key` gibt es zusätzlich `{{key_name}}` (Dateiname), `{{key_titel}}` (Dateiname ohne Endung, Unterstriche als Leerzeichen) und `{{key_datum}}` (Änderungsdatum der Datei, deutsches Datumsformat). Sie gelten in der Prüfung als vorhanden, zählen als Nutzung des Datei-Felds (Pflichtfeld-Prüfung, Schild „geht an Schritt n“), werden beim Umbenennen des Feldes mit umbenannt und stehen als Einsetz-Knöpfe im KI-Ablauf bereit. `FileInfo` hat dafür das Feld `geaendert` (ISO-Datum).

## 24. Mein Hub: persönliche Apps, Voreinstellungen, regelmäßige Aufträge

Neben dem öffentlichen Katalog (Startseite) hat jeder Nutzer einen eigenen Bereich „Mein Hub“ (`/mein`). Umsetzung: `src/lib/meinhub.ts` (Schema, Zeitplan, Ausführung), `src/state/meinhub.tsx` (Zustand und Zeitsteuerung), `src/pages/MeinHubPage.tsx`, `src/components/meinhub/Dialoge.tsx`.

### 24.1 Datenmodell (Zod, je Nutzer ein Dokument)

```
MeinHub {
  v: 1, nutzer: string,                  // später Objekt-ID aus Entra ID, bis dahin "lokal"
  pins: [{ appId, seit }],               // Apps aus dem Katalog, als Verweis (Updates kommen automatisch an)
  voreinstellungen: [{ id, appId, name, werte: {key: string|boolean}, dateien: {key: FileInfo}, erstellt, geaendert }],
  auftraege: [{ id, name, appId, voreinstellungId|null,
                zeitplan: { art: taeglich|werktags|woechentlich|monatlich, uhrzeit "HH:MM", wochentag 1–7, tag 1–28 },
                ziel: { art: hub|email|sharepoint|teams, adresse }, aktiv, naechsterLauf, letzterLauf, erstellt }],
  laeufe: [{ id, auftragId|null, appId, appName, titel, voreinstellungId, start, ende,
             status: laeuft|fertig|fehler|abgebrochen, meldung,
             ergebnisse: { stepId: { status, text, meldung, key, name } } }],   // höchstens 40, Text je Schritt bis 60.000 Zeichen
  automatisch: boolean                   // fällige Aufträge ausführen, solange der Hub geöffnet ist
}
```

- Dateien in Voreinstellungen werden als bereits gelesener Text gespeichert (bis 200.000 Zeichen).
- Läufe finden ihre Schritte über die Schritt-ID, ersatzweise über den Namen des Ergebnisses (`key`). Vorlagen-Apps haben dafür stabile IDs (`<appId>-s1`, `<appId>-b1` …).
- Speicher hinter der Schnittstelle `MeinHubSpeicher` (`laden`, `speichern`); jetzt `LokalerMeinHubSpeicher` (Browser, Schlüssel `kihub-meinhub-v1:<nutzer>`). Wird der Browser-Speicher voll, fallen die ältesten Läufe weg.

### 24.2 Bedienung

- **App-Ansicht**: „Zu Mein Hub“ (bzw. „In Mein Hub“), Menü „Voreinstellungen“: gespeicherte laden, „Eingaben als Voreinstellung speichern …“ (neu oder die geladene überschreiben), „Regelmäßig ausführen …“. `/app/:id?vorlage=<id>` öffnet die App mit einer Voreinstellung. Auf dem Handy stehen diese Punkte im Menü „Weitere Aktionen“. Eine Voreinstellung oder ein Auftrag nimmt die App automatisch in Mein Hub auf.
- **Mein Hub**, Reiter „Meine Apps“ (Karten mit Voreinstellungen als Schnellstart), „Aufträge“ (Zeitplan, nächster und letzter Lauf, aktiv/pausiert, Jetzt ausführen, Bearbeiten, Löschen), „Verlauf“ (je Lauf eine Kachel; geöffnet je Ergebnis eine Seite mit den üblichen Download-Knöpfen). Alles blättert ohne Scrollen.
- Auftrag anlegen: Name, Eingaben (aktuelle Eingaben als neue Voreinstellung oder eine gespeicherte), täglich/werktags/wöchentlich/monatlich mit Uhrzeit, Ergebnis-Ziel. Ziele außer „Im Verlauf ablegen“ sind sichtbar, aber bis zur Azure-Anbindung gesperrt.

- **Voreinstellungen verwalten** (Menü „Voreinstellungen“ in der App und Knopf auf der App-Karte): umbenennen direkt im Feld, löschen mit Rückfrage. Nutzt ein Auftrag die Voreinstellung, wird er beim Löschen pausiert.
- **Letztes Ergebnis**: Auch Läufe, die man direkt in einer App startet, landen im Verlauf (Titel „App: Voreinstellung“, sofern eine geladen ist). Die App-Karte zeigt „Letztes Ergebnis: Datum, Status, Ansehen“, das App-Menü „Letztes Ergebnis ansehen“. `/mein?lauf=<id>` öffnet ein Ergebnis direkt. Vorschau und Testlauf im Baukasten sowie „Neue Applikation“ legen nichts ab.

### 24.3 Ausführung (Testfassung)

- Ein Auftrag läuft wie „Ergebnisse erstellen“ in der App: alle Schritte, Eingaben aus der Voreinstellung. Fehlen Pflichtfelder, endet der Lauf mit Fehler und Hinweis.
- Die Zeitsteuerung läuft im Browser, solange der Hub in einem Fenster geöffnet ist (wird der Browser während eines Laufs geschlossen, bricht der Lauf ab; die bis dahin fertigen Schritte sind gespeichert, weil Zwischenstände laufend in den Verlauf geschrieben werden, gebündelt höchstens alle 800 ms und sofort beim Schließen): Prüfung beim Öffnen und alle 30 Sekunden, immer nur ein Lauf gleichzeitig (Warteschlange). Verpasste Termine werden beim nächsten Öffnen **einmal** nachgeholt. Der nächste Termin wird beim Start gesetzt, damit nichts doppelt läuft. Läufe, die beim Schließen noch liefen, gelten als abgebrochen.
- Ohne KI-Anbindung entstehen Simulations-Ergebnisse (die Anfrage, die gesendet würde).

### 24.4 Zielbild mit Azure (später, mit der IT)

- **Anmeldung**: Entra ID mit Single Sign-on (bereits in `src/lib/ki/auth.ts`); die Nutzer-ID kommt aus dem Konto. Keine eigene Passwort-Maske, keine gespeicherten Passwörter.
- **Speicher**: Mein-Hub-Dokument je Nutzer serverseitig (z. B. Azure Table Storage, Cosmos DB oder SharePoint-Liste) hinter derselben Schnittstelle `MeinHubSpeicher`.
- **Hintergrunddienst**: z. B. Azure Function mit Zeitsteuerung führt fällige Aufträge aus, auch wenn niemand den Hub geöffnet hat.
- **Berechtigung für Hintergrund-Läufe**: einmalige Zustimmung des Nutzers; der Dienst erhält ein Refresh-Token (`offline_access`), verschlüsselt in Azure Key Vault, und holt sich je Lauf ein frisches Zugriffstoken für Microsoft Graph im Namen des Nutzers. Widerruf, Ablauf und bedingter Zugriff liegen bei der IT.
- **Ziele**: E-Mail (Graph `sendMail`), SharePoint/OneDrive (Datei hochladen, z. B. als PDF aus Abschnitt 22), Teams-Kanal (Nachricht mit Datei).
- **Datenquellen** (Erweiterung): z. B. „neueste Datei in Ordner X“ oder „Transkripte meiner Besprechungen seit dem letzten Lauf“ statt fester Werte.
- Vor dem Bau zu klären: Freigabe von `offline_access` für die Hub-Anwendung; ob die Copilot-Schnittstelle mit delegierten Rechten ohne aktive Sitzung nutzbar ist (mit aktueller Graph-Dokumentation prüfen); Betrieb und Protokollierung des Hintergrunddienstes; Aufbewahrungsdauer der Ergebnisse.
