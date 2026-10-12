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

1. **Automatisch bei der Aufnahme:** Vor jedem Screenshot werden Felder aus einer konfigurierbaren Liste im DOM verdeckt und danach wieder eingeblendet. Bei Odoo wird über das `name`-Attribut der Feld-Widgets gematcht (z. B. `partner_id`, `email`, `phone`).
2. **Manuell im Editor:** Rechtecke über beliebige Bereiche ziehen.
3. **Prüfung beim Export:** Warnung, wenn Schritte ungeschwärzte Eingabefelder enthalten.

Schwärzungen sind deckende Balken, kein Weichzeichner. Beim Export werden sie fest ins Bild gerechnet, das Original gelangt nie in eine exportierte Datei.

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
| PDF | Aus derselben Vorlage wie HTML |
| Odoo Wissen | Formatiertes HTML in die Zwischenablage, Einfügen in einen leeren Artikel |
| Markdown | ZIP mit Text und Bilderordner |

Optionen: Titelseite mit Kundenlogo, Klickpunkt markieren, Screenshots auf Klickbereich zuschneiden.

### Odoo Wissen: getestetes Verhalten

Eingefügte Bilder speichert der Odoo-Editor als `data:image/…;base64` direkt im Artikeltext, nicht als Anhang (getestet am 2026-10-12). Deshalb gilt für diesen Export standardmäßig:

- Screenshots auf den Klickbereich zuschneiden,
- maximal 1000 px Breite,
- WebP-Kompression,
- Größenschätzung im Export-Dialog anzeigen.

Ein Upload als echte Anhänge über die Odoo-API bleibt eine mögliche spätere Ausbaustufe.

## Bewusst nicht enthalten

- Cloud-Speicher oder Share-Links
- KI-Textgenerierung (Screenshots zeigen Kundensysteme)
- Safari

## Design

Screens: Popup (bereit / Aufnahme), Editor, Export-Dialog, Kundenansicht. Die Entwürfe liegen als Design-Canvas in Claude.
