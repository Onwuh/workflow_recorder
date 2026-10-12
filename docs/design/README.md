# Design

Die Screens wurden als Design-Canvas in Claude entworfen. Dieser Ordner enthält deren Quellen.

## Screens

| Datei | Screen | Größe |
|---|---|---|
| `screens/Main.dc.html` | Popup, bereit | 360 × 560 |
| `screens/Recording.dc.html` | Popup, Aufnahme läuft | 360 × 560 |
| `screens/Export.dc.html` | Export-Dialog (interaktiv: Formatwahl) | 560 × 640 |
| `screens/Editor.dc.html` | Editor (interaktiv: Schrittauswahl) | 1440 breit, fluid |
| `screens/Guide.dc.html` | Geteilte Anleitung, Kundensicht | 1280 breit, fluid |

`screens/canvas.json` ist die Anordnung auf dem Canvas.

Die `.dc.html`-Dateien rendern nicht eigenständig im Browser. Sie nutzen ein Template-Format des Design-Canvas (`<x-dc>`, `{{…}}`-Platzhalter, `<sc-for>`, `<sc-if>`). Als Vorlage zum Nachbauen sind sie trotzdem vollständig: Layout, Abstände, Farben und Texte stehen als Inline-Styles im Markup, die Logik für Listen und Auswahl im `<script>`-Block am Ende.

## Tokens

| Token | Hell | Verwendung |
|---|---|---|
| bg | `#F6F6F3` | Seitenhintergrund Editor |
| surface | `#FFFFFF` | Karten, Popup, Dialoge |
| fg | `#1B1D1F` | Text, Kopf des Aufnahme-Popups |
| fg-2 | `#3A3D41` | Sekundärer Text |
| muted | `#6B6E72` | Labels, Metadaten |
| line | `#DCDCD6` | Rahmen |
| line-soft | `#ECECE7` | Trennlinien |
| accent | `#2B59C3` | Primäraktionen, Auswahl |
| accent-soft | `#EEF2FB` | Hinterlegte Auswahl |
| rec | `#C8372D` | Aufnahme-Button, Klickmarkierung |
| danger | `#A12A21` | Löschen |
| warn-bg / warn-fg | `#FFF4E5` / `#6A3F00` | Schwärzungswarnung |

Schrift im Entwurf: IBM Plex Sans und IBM Plex Mono. In der Erweiterung selbst wird die Systemschrift verwendet, weil sie keine Ressourcen von fremden Servern laden soll.

Radien: 8 px für Buttons und Felder, 10–12 px für Karten und Dialoge, 50 % für Schrittnummern und Klickmarker.

## Gestaltungsregeln

- Neutral weiß-grau, damit Anleitungen zu jedem Kunden passen.
- Blau nur für Aktionen und Auswahl, Rot nur für Aufnahme und Klickmarkierung.
- Klickmarker: 44 px Kreis, 3 px Rand in `rec`, Füllung `rec` mit 12 % Deckkraft.
- Schwärzung: deckender Balken in `fg` (`#1B1D1F`), 2 px größer als das Feld, Radius 3 px.
- Schrittnummern zweistellig in Monospace (`01`, `02`) in Listen, als gefüllter Kreis im Detail.
- Touch-Ziele mindestens 44 px.

## Entscheidungen aus dem Design-Review

- Odoo-Export ohne API-Key: Kopieren in die Zwischenablage und Einfügen in einen leeren Wissen-Artikel. Der Dialog zeigt dafür drei Schritte und eine Größenschätzung.
- Arbeitsstand bleibt lokal, kein Sync.
- Der Name „Workflow Recorder“ ist ein Arbeitstitel.
