# Workflow Recorder

Browser-Erweiterung für Chrome und Firefox, die Klick-Abläufe aufzeichnet und daraus Schritt-für-Schritt-Anleitungen zum Teilen mit Kunden macht. Alles läuft lokal im Browser, es gibt keinen Server und keine Cloud-KI.

## Aufnahme

- Start und Stopp über das Popup oder den Kurzbefehl ⌥⇧R.
- Pro Klick ein Schritt: Screenshot des sichtbaren Tabs, Klickposition, Schritttext.
- Schritttexte werden regelbasiert aus dem angeklickten Element erzeugt, z. B. „Klicke auf *Bestätigen*“ oder „Gib bei *Menge* einen Wert ein“.
- Eingabewerte erscheinen nie im Schritttext.
- Tastatureingaben als eigener Schritt sind optional.
- Während der Aufnahme lässt sich der letzte Schritt verwerfen.

## Schwärzung

1. **Automatisch bei der Aufnahme:** Direkt vor und nach jedem Screenshot werden die Flächen der Felder aus einer konfigurierbaren Liste gemessen und als Schwärzungsrechtecke am Schritt gespeichert. Bei Odoo wird über das `name`-Attribut der Feld-Widgets gematcht (z. B. `partner_id`, `email`, `phone`). Teile, die ein darüberliegender Dialog oder Wizard verdeckt, werden ausgespart, damit keine Balken über dem Wizard liegen.
2. **Manuell im Editor:** Rechtecke über beliebige Bereiche ziehen. Jede Schwärzung, auch eine automatische, lässt sich im Schwärzen-Modus per Klick wieder entfernen.
3. **Prüfung beim Export:** Warnung, wenn Schritte ungeschwärzte Eingabefelder enthalten.

Schwärzungen sind deckende Balken, kein Weichzeichner. Beim Export und in der Projektsicherung werden sie fest ins Bild gerechnet, das Original gelangt nie in eine exportierte Datei. Damit sich Schwärzungen nachträglich entfernen lassen, liegt der ungeschwärzte Screenshot im lokalen Speicher der Erweiterung (IndexedDB).

Bekannte Lücke: Datensatznamen in Breadcrumb, Listenansichten und Chatter erfasst die Automatik nicht zuverlässig. Deshalb bleiben die manuelle Prüfung und die Exportwarnung nötig.

## Editor

- Schrittliste mit Auswahl, Schritttext bearbeiten, Schritte löschen.
- Werkzeuge: Schwärzen, Zuschneiden, Klickpunkt verschieben, Pfeil/Text.
- Optionale Einleitung und Hinweise pro Schritt.

## Speicherung

- **Arbeitsstand:** IndexedDB der Erweiterung, Screenshots als Blobs und Schritte als JSON. Chrome und Firefox haben getrennte Speicher.
- **Sicherung:** „Projekt sichern“ erzeugt eine ZIP-Datei (JSON plus Bilder), die sich in beiden Browsern wieder öffnen lässt.
- Kein Sync zwischen Geräten (bewusst, vorerst).

## Export

| Format | Ergebnis |
|---|---|
| HTML | Eine Datei mit eingebetteten Bildern, öffnet in jedem Browser |
| PDF | Fertige PDF-Datei zum Herunterladen (A4) |
| Odoo Wissen | Formatiertes HTML in die Zwischenablage, Einfügen in einen leeren Artikel |
| Markdown | ZIP mit Text und Bilderordner |

Optionen: Titelseite mit Kundenlogo, Klickpunkt markieren, Screenshots auf Klickbereich zuschneiden.

### Odoo Wissen: getestetes Verhalten

Eingefügte Bilder speichert der Odoo-Editor als `data:image/…;base64` direkt im Artikeltext, nicht als Anhang (getestet am 2026-10-12). Deshalb gilt für diesen Export standardmäßig:

- maximal 1000 px Breite,
- WebP-Kompression,
- Größenschätzung im Export-Dialog anzeigen.

Zuschneiden auf den Klickbereich ist nicht voreingestellt: zugeschnittene Screenshots wirken im Artikel gezoomt. Es lässt sich im Dialog einschalten.

Ein Upload als echte Anhänge über die Odoo-API bleibt eine mögliche spätere Ausbaustufe.

## Bewusst nicht enthalten

- Cloud-Speicher oder Share-Links
- KI-Textgenerierung (Screenshots zeigen Kundensysteme)
- Safari

## Design

Screens: Popup (bereit / Aufnahme), Editor, Export-Dialog, Kundenansicht. Die Entwürfe liegen als Design-Canvas in Claude.

## Installation

Chrome und Firefox brauchen unterschiedliche Manifeste (Service Worker und `side_panel` gegenüber Hintergrundseite und `sidebar_action`). Das `manifest.json` im Wurzelordner ist das für Chrome. `npm run build` erzeugt `dist/chrome/` und `dist/firefox/` sowie je eine ZIP-Datei.

**Chrome / Edge**

1. `chrome://extensions` öffnen, oben rechts „Entwicklermodus“ einschalten.
2. „Entpackte Erweiterung laden“ und diesen Ordner (oder `dist/chrome`) wählen.
3. Das Symbol über das Puzzle-Menü an die Leiste anheften.

**Firefox (ab 121)**

1. `npm run build` ausführen, dann `about:debugging#/runtime/this-firefox` öffnen, „Temporäres Add-on laden …“ und `dist/firefox/manifest.json` wählen.
2. Wichtig: In Firefox sind Host-Berechtigungen unter Manifest V3 optional. Nach der Installation unter `about:addons` → Workflow Recorder → „Berechtigungen“ den Zugriff auf alle Websites erlauben. Alternativ zeigt das Popup einen Button „Zugriff erlauben“.
3. Für eine dauerhafte Installation muss das Add-on signiert werden (`web-ext sign`).

**Seitenleiste:** Über das Seitenleisten-Symbol im Popup bleibt der Workflow neben der Seite offen. Dort lässt sich die Aufnahme steuern, und jeder Schritt erscheint sofort mit Screenshot zum Prüfen: Text ändern, löschen, im Editor öffnen.

Der Kurzbefehl ⌥⇧R (Alt+Shift+R) lässt sich in Chrome unter `chrome://extensions/shortcuts`, in Firefox unter `about:addons` → Zahnrad → „Tastenkombinationen verwalten“ ändern.

## Sicherheit

- **Keine Netzwerkzugriffe:** Die Erweiterungsseiten laufen unter einer strengen CSP (`default-src 'none'`, nur eigene Skripte und Stile, `connect-src 'self'`). Es gibt keine `web_accessible_resources`, Webseiten können die Erweiterung also nicht einbetten oder ansprechen.
- **Getrennte Nachrichtenkanäle:** Das Content-Script darf nur „hello“ und „step“ senden (und auf „measure“ antworten), und nur aus dem aufgenommenen Tab. Steuerbefehle (Start, Stopp, Verwerfen) nimmt der Hintergrund ausschließlich von Erweiterungsseiten an. Alle Felder aus dem Content-Script werden geprüft, begrenzt und gekürzt.
- **Nur echte Klicks:** Schritte entstehen nur aus `isTrusted`-Ereignissen. Synthetische Klicks der Seite werden ignoriert. Aufnahmen sind auf 2 pro Sekunde und 3 wartende begrenzt.
- **Keine Eingabewerte:** Das Content-Script liest keine Feldinhalte und keine Platzhalter. Es zählt nur, wie viele ausgefüllte Felder ungeschwärzt sichtbar waren.
- **Schwärzung:** Flächen werden direkt vor und nach dem Screenshot gemessen und vereinigt, so dass auch ein Seitenwechsel durch den Klick abgedeckt ist. Antwortet die Seite dabei nicht (Neuladen), wird der Schritt zur Prüfung markiert. Alle Exporte und die Projektsicherung rechnen Schwärzungen deckend ein.
- **PDF:** eigener Schreiber ohne Fremdbibliothek, nur Text, Linien und JPEG-Bilder; keine Skripte, Links oder Formulare.
- **Exportierte HTML-Datei:** eigene CSP mit SHA-256-Hashes für Stil und Druck-Skript, `default-src 'none'`, nur `data:`-Bilder, `no-referrer`. Alle Texte werden escaped.
- **Import einer Projektsicherung:** ZIP-Leser mit Grenzen für Größe, Anzahl und Kompressionsverhältnis, Prüfung von Pfaden (`..`, absolute Pfade) und CRC. Das JSON wird gegen ein festes Schema geprüft, unbekannte Felder werden verworfen. Bilder werden dekodiert und neu kodiert, so dass nur Pixel übernommen werden. Ein Import legt immer eine neue Anleitung an.
- **Kein `innerHTML`** mit Daten in Erweiterungsseiten (ESLint-Regel).

Bekannte Grenzen: Inhalte in iframes werden von der Auto-Schwärzung nicht erfasst. Die Messung läuft im Content-Script; eine Seite, die ihr DOM gezielt manipuliert, könnte die Erkennung umgehen. Deshalb bleiben die Prüfung im Editor und die Exportwarnung nötig.

## Entwicklung

```
npm test            # Unit-Tests (ZIP, Projektprüfung)
npm run lint        # ESLint
npm run e2e         # Ende-zu-Ende-Test in Chromium mit Playwright
npm run build       # dist/chrome, dist/firefox und ZIP-Pakete
npm run lint:firefox  # Firefox-Paket mit web-ext prüfen
```
