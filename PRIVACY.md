# Datenschutzerklärung – Workflow Recorder

Stand: 13. Oktober 2026

Workflow Recorder ist eine Browser-Erweiterung, die Klick-Abläufe aufzeichnet und daraus Schritt-für-Schritt-Anleitungen erstellt. Sie arbeitet vollständig lokal in Ihrem Browser.

## Kurz gesagt

- Die Erweiterung erhebt keine personenbezogenen Daten und überträgt keine Daten an den Entwickler oder an Dritte.
- Es gibt keinen Server, kein Konto, keine Cloud-Speicherung, keine KI-Dienste und keine Analyse- oder Statistikwerkzeuge.
- Die Erweiterung lädt keine Inhalte aus dem Internet nach.

## Welche Daten lokal gespeichert werden

Nur wenn Sie eine Aufnahme starten, speichert die Erweiterung im lokalen Speicher Ihres Browsers (IndexedDB und `chrome.storage`):

- Screenshots des sichtbaren Tabs, jeweils beim Klick während der Aufnahme,
- die Klickposition und einen automatisch erzeugten Schritttext. Der Text enthält nur Beschriftungen von Feldern und Buttons, keine Eingabewerte,
- Ihre Bearbeitungen: Texte, Hinweise, Schwärzungen, Pfeile und Formen, ein optional hochgeladenes Logo,
- die Adresse (Origin) und die interne Tab-Kennung der Seite, auf der aufgenommen wurde, damit der Editor dorthin zurückspringen kann,
- Ihre Einstellungen.

Diese Daten verlassen Ihren Browser nicht. Sie sind nur für Sie in diesem Browserprofil zugänglich.

## Exporte

Dateien (HTML, PDF, Markdown, Projektsicherung) entstehen nur, wenn Sie selbst einen Export auslösen, und werden in Ihren Download-Ordner gespeichert. Der Export für Odoo Wissen kopiert Inhalte in Ihre Zwischenablage. Was Sie anschließend mit diesen Dateien tun, liegt bei Ihnen. Schwärzungen werden in allen Exporten fest ins Bild gerechnet.

## Berechtigungen

- **Zugriff auf Webseiten:** um den sichtbaren Tab bei einem Klick aufzunehmen und Klicks auf der Seite zu erkennen, die Sie aufnehmen. Ohne laufende Aufnahme werden keine Daten der Seite gespeichert.
- **tabs, scripting:** um den aufgenommenen Tab zu erkennen und das Aufnahmeskript zu laden.
- **storage, unlimitedStorage:** um Anleitungen und Screenshots lokal zu speichern.
- **sidePanel:** für die Seitenleiste.

## Löschen

Sie können Anleitungen jederzeit in der Übersicht der Erweiterung löschen. Beim Entfernen der Erweiterung löscht der Browser alle von ihr gespeicherten Daten.

## Änderungen

Ändert sich der Umgang mit Daten, wird diese Erklärung angepasst und das Datum oben aktualisiert.

## Kontakt

Verantwortlich: Paul Huffer
Kontakt: paul.huffer@gmx.net

---

# Privacy Policy – Workflow Recorder

Last updated: October 13, 2026

Workflow Recorder is a browser extension that records click sequences and turns them into step-by-step guides. It runs entirely locally in your browser.

## Summary

- The extension does not collect personal data and does not transmit any data to the developer or to third parties.
- There is no server, no account, no cloud storage, no AI service, and no analytics or tracking.
- The extension does not load any remote content.

## Data stored locally

Only when you start a recording does the extension store, in your browser's local storage (IndexedDB and `chrome.storage`):

- screenshots of the visible tab, taken when you click during a recording,
- the click position and an automatically generated step text. The text contains only labels of fields and buttons, never input values,
- your edits: texts, notes, redactions, arrows and shapes, and an optionally uploaded logo,
- the origin and internal tab ID of the page that was recorded, so the editor can jump back to it,
- your settings.

This data never leaves your browser and is accessible only to you in this browser profile.

## Exports

Files (HTML, PDF, Markdown, project backup) are created only when you trigger an export yourself and are saved to your downloads folder. The Odoo Knowledge export copies content to your clipboard. What you do with these files afterwards is up to you. Redactions are permanently burned into the images in every export.

## Permissions

- **Access to websites:** to capture the visible tab when you click and to detect clicks on the page you are recording. No page data is stored unless a recording is running.
- **tabs, scripting:** to identify the recorded tab and load the recording script.
- **storage, unlimitedStorage:** to store guides and screenshots locally.
- **sidePanel:** for the side panel.

## Deletion

You can delete guides at any time from the extension's overview. When you remove the extension, the browser deletes all data it has stored.

## Changes

If the handling of data changes, this policy will be updated and the date above revised.

## Contact

Controller: Paul Huffer
Contact: paul.huffer@gmx.net
