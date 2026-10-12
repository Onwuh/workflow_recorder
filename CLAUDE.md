# CLAUDE.md

Kontext für Claude Code in diesem Repo. Die fachliche Spezifikation steht in `README.md`, das Design in `docs/design/`.

## Projekt

Browser-Erweiterung (Chrome und Firefox, Manifest V3), die Klick-Abläufe aufzeichnet und als Schritt-für-Schritt-Anleitung exportiert. Hauptanwendung: Anleitungen für Odoo-Kunden. Alles läuft lokal, ohne Server.

Sprache: Oberfläche, Kommentare und Commit-Nachrichten auf Deutsch.

## Harte Regeln

- **Keine Daten an Dritte.** Keine Cloud-KI, keine Analytics, keine Webfonts oder CDNs in der Erweiterung. Screenshots zeigen Kundensysteme.
- **Keine Eingabewerte im Schritttext.** Nur Beschriftungen von Feldern und Buttons. Texte von Listenzeilen, Kanban-Karten, Autocomplete-Einträgen und Breadcrumbs enthalten oft Kundennamen und werden durch generische Texte ersetzt.
- **Schwärzung ist deckend und wird fest ins Bild gerechnet.** Kein Weichzeichner. Originale dürfen nie in einen Export gelangen.
- **Keine Kundennamen** in Code, Testdaten, Commits oder Doku.

## Commits

- Commits laufen unter der Identität dieser Umgebung („Claude“) und werden signiert. Nicht ändern.
- Niemals eine andere Autor-Identität setzen, insbesondere kein Odoo-Konto und keine private Mailadresse.

## Architektur (geplant)

```
manifest.json
src/
  db.js             IndexedDB: Stores "guides" und "steps" (Index guideId), Screenshot als Blob im Schritt
  background.js     Aufnahmezustand, Screenshots, Speichern
  content.js        Klick-Erkennung, Schritttext, Auto-Schwärzung
  ui.css            gemeinsame Tokens (siehe docs/design/README.md)
  popup/            Popup bereit / Aufnahme
  editor/           Übersicht und Editor (editor.html?guide=<id>)
  export/           HTML, PDF, Odoo-Zwischenablage, Markdown-ZIP
```

## Umsetzungshinweise

Aus einem ersten, nicht übernommenen Entwurf. Sie beschreiben Fallstricke, die beim Bau beachtet werden sollten.

**Manifest für beide Browser**
- `background` mit beiden Schlüsseln: `"service_worker": "src/background.js"` für Chrome und `"scripts": ["src/db.js", "src/background.js"]` für Firefox. Jeder Browser ignoriert den anderen Schlüssel mit einer Warnung.
- Im Service Worker `db.js` per `importScripts('db.js')` laden, nur wenn `DB` noch nicht existiert.
- `browser_specific_settings.gecko.id` setzen, `strict_min_version` 121.
- Berechtigungen: `storage`, `tabs`, `scripting`, Host `<all_urls>`. In Firefox sind Host-Berechtigungen unter MV3 optional und müssen nach der Installation in den Add-on-Einstellungen erteilt werden. Das gehört in die Installationsanleitung.
- Kurzbefehl über `commands`: `Alt+Shift+R`.

**Aufnahmezustand**
- In `chrome.storage.session` halten, weil der Chrome Service Worker jederzeit beendet werden kann.
- Felder: `guideId, tabId, windowId, startedAt, count, paused, pausedMs, pauseStart`.
- Beim Start das Content-Script per `chrome.scripting.executeScript` nachladen, falls der Tab schon vor der Installation offen war. Das Content-Script schützt sich mit einem Flag gegen doppelte Initialisierung.
- Das Content-Script fragt beim Laden per Nachricht, ob sein Tab aufgenommen wird. So überlebt die Aufnahme Seitenwechsel im selben Tab.
- Guide-Titel nicht aus dem Seitentitel übernehmen, der enthält oft Datensatznamen.

**Screenshots**
- `chrome.tabs.captureVisibleTab` ist in Chrome auf 2 Aufrufe pro Sekunde begrenzt. Aufnahmen über eine Promise-Kette serialisieren und mindestens 550 ms Abstand halten.
- Vor dem Screenshot prüfen, ob der aufgenommene Tab noch aktiv ist.
- Auslöser ist `pointerdown` in der Capture-Phase, nur `isTrusted` und linke Maustaste. Bei Links kann die Seite währenddessen wegnavigieren. Der Screenshot läuft im Hintergrund trotzdem.
- Pro Schritt `x, y` (CSS-Pixel), `vw, vh` und `devicePixelRatio` speichern. Der Klickmarker im Editor wird prozentual positioniert (`x / vw`, `y / vh`).

**Auto-Schwärzung**
- Vor dem Screenshot ein Overlay mit deckenden Boxen über passende Elemente legen, zwei Animation-Frames warten, Screenshot auslösen, Overlay entfernen. Overlay mit `pointer-events: none`.
- Selektoren: `.o_field_widget[name="…"]` und `td[name="…"]` (Odoo-Listen) für eine konfigurierbare Feldliste, dazu `input[type=email|tel|password]`.
- Standardliste: `partner_id, partner_invoice_id, partner_shipping_id, commercial_partner_id, email, email_from, phone, mobile, vat, street, street2, zip, city, bank_account_id, partner_bank_id, acc_number`.
- Einstellung `autoRedact` (Standard an) in `chrome.storage.local`.

**Schritttexte**
- Feldbeschriftung über `label[for=<input id>]`. Odoo-Labels enden teils mit einem Tooltip-„?“, das entfernt werden muss.
- Reihenfolge: Eingabefeld → private Bereiche (generischer Text) → Button, Link, Menü, Tab (`aria-label`, `title`, Text) → Fallback „Klicke an die markierte Stelle“.
- Texte auf 60 Zeichen kürzen.

**Odoo-Wissen-Export**
- Getestet am 2026-10-12: eingefügte Bilder bleiben als `data:image/…;base64` im Artikeltext, sie werden nicht zu Anhängen. Deshalb zuschneiden, maximal 1000 px Breite, WebP.
- Zwischenablage mit `ClipboardItem` (`text/html` und `text/plain`). Fallback: Inhalt markieren und `document.execCommand('copy')`.
- Testseite: `docs/tests/odoo-paste-test.html` (Seiteninhalt eines Claude-Artifacts, ohne eigenes `<html>`-Gerüst).

## Nächste Schritte

1. Grundgerüst: Manifest, IndexedDB, Aufnahme mit Screenshots und Auto-Schwärzung, Popup nach `docs/design/screens/Main.dc.html` und `Recording.dc.html`.
2. Editor nach `Editor.dc.html`: Schritte auswählen, Text und Hinweis bearbeiten, löschen.
3. Manuelles Schwärzen und Zuschneiden, fest ins Bild gerechnet.
4. Export nach `Export.dc.html` und `Guide.dc.html`.
5. Projektsicherung als ZIP.
