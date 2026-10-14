/* End-to-End-Test: lädt die Erweiterung in Chromium, nimmt Klicks auf einer Odoo-ähnlichen Testseite auf
   und prüft Schritttexte, Schwärzung, Editor und Exporte. Aufruf: npm run e2e */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'wfr-e2e');
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
function check(cond, msg) {
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) fails.push(msg);
}

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'fixture.html')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-prof-')), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  const errors = [];
  ctx.on('weberror', (e) => errors.push(String(e.error())));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const ext = (p) => `chrome-extension://${extId}/${p}`;

  // Erweiterungsseite (für Nachrichten und DB-Zugriff), danach die Testseite als aktiver Tab.
  const helper = await ctx.newPage();
  helper.on('console', (m) => { if (m.type() === 'error') errors.push('helper: ' + m.text()); });
  await helper.goto(ext('src/editor/editor.html'));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.bringToFront();

  const tabId = await helper.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, base);
  const start = await helper.evaluate((id) => chrome.runtime.sendMessage({ type: 'start', tabId: id }), tabId);
  check(start && start.ok, 'Aufnahme startet: ' + JSON.stringify(start && (start.error || 'ok')));
  const guideId = start.rec.guideId;

  // Feldpositionen vor den Klicks (der Wizard-Button scrollt die Seite später)
  const rects = await page.evaluate(() => ['#partner_id_0', '#email_0', '#qty_0', '#rowcell', '#company', '#usermenu'].map((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }));
  const clicks = ['#confirm', '#partner_id_0', '#qty_0', '#bc', '#rowcell', '#tab', '#iconbtn', '#menu-orders', '#open-wizard', '#wiz_confirm'];
  for (const sel of clicks) {
    await page.click(sel);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(800);

  const steps = await helper.evaluate((g) => DB.getSteps(g).then((s) => s.map((x) => ({ text: x.text, unredacted: x.unredacted, imgW: x.imgW, x: x.x, y: x.y, vw: x.vw }))), guideId);
  const texts = steps.map((s) => s.text);
  console.log(texts);
  check(steps.length === clicks.length, `alle ${clicks.length} Klicks aufgenommen (${steps.length})`);
  check(texts[0] === 'Klicke auf „Bestätigen“', 'Button-Text');
  check(texts[1] === 'Wähle bei „Kunde“ einen Eintrag aus', 'Many2one mit Label ohne Tooltip-?');
  check(texts[2] === 'Gib bei „Menge“ einen Wert ein', 'Eingabefeld');
  check(texts[3] === 'Gehe über die Navigationsleiste zurück', 'Breadcrumb generisch');
  check(texts[4] === 'Öffne einen Eintrag aus der Liste', 'Listenzeile generisch');
  check(texts[5] === 'Öffne den Reiter „Auftragszeilen“', 'Reiter');
  check(texts[6] === 'Klicke auf „Aktion“', 'aria-label');
  check(texts[7] === 'Öffne das Menü „Aufträge“', 'Menü');
  check(!texts.join(' ').includes('Beispielkunde') && !texts.join(' ').includes('GEHEIM'), 'keine Daten im Schritttext');
  check(steps[0].unredacted === 2, `ungeschwärzte Felder gezählt (${steps[0].unredacted}, erwartet 2: Menge, Referenz)`);

  // Schwärzung im Bild: Pixel mitten im Kundenfeld und im E-Mail-Feld müssen #1B1D1F sein.
  // Schwärzung als Rechtecke am Schritt; im Export fest eingerechnet, gespeichertes Original unverändert.
  const pixels = async (idx, pts, rendered) => helper.evaluate(async ({ g, idx, pts, rendered }) => {
    const s = (await DB.getSteps(g))[idx];
    const blob = rendered ? (await Render.renderStep(s, { marker: false })).blob : s.image;
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const k = bmp.width / s.vw;
    return pts.map((p) => Array.from(ctx.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data));
  }, { g: guideId, idx, pts, rendered });
  const px = await pixels(0, rects, true);
  const raw = await pixels(0, rects, false);
  const dark = (p) => p[0] === 0x1B && p[1] === 0x1D && p[2] === 0x1F;
  check(dark(px[0]), 'Kundenfeld im Export geschwärzt ' + px[0]);
  check(dark(px[1]), 'E-Mail-Feld im Export geschwärzt ' + px[1]);
  check(!dark(px[2]), 'Mengenfeld nicht geschwärzt ' + px[2]);
  check(dark(px[3]), 'Listenzelle partner_id im Export geschwärzt ' + px[3]);
  check(dark(px[4]) && dark(px[5]), `Firma und Benutzermenü/Datenbank in der Kopfzeile geschwärzt (${px[4]} / ${px[5]})`);
  check(!dark(raw[0]), 'gespeichertes Original bleibt erhalten (Schwärzung entfernbar)');
  const nRed = await helper.evaluate((g) => DB.getSteps(g).then((s) => s[0].redactions.length), guideId);
  check(nRed === 6, `sechs Schwärzungsflächen am Schritt (Kunde, E-Mail-Widget, E-Mail-Input, Listenzelle, Firma, Benutzermenü: ${nRed})`);

  // Wizard: Felder im Dialog geschwärzt, Balken der Seite dahinter nicht über dem Dialog.
  const wiz = await page.evaluate(() => {
    const m = document.querySelector('#wizard .modal-content').getBoundingClientRect();
    const f = document.querySelector('#partner_id_0').getBoundingClientRect();
    const e = document.querySelector('#email_0').getBoundingClientRect();
    const w = document.querySelector('#wiz_partner_0').getBoundingClientRect();
    const mid = (a, b) => ({ x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 });
    return [mid(m, f), mid(m, e), { x: w.left + w.width / 2, y: w.top + w.height / 2 }, { x: f.left + 10, y: f.top + f.height / 2 }];
  });
  const wpx = await pixels(clicks.length - 1, wiz, true);
  check(!dark(wpx[0]) && !dark(wpx[1]), `kein Balken über dem Wizard (${wpx[0]} / ${wpx[1]})`);
  check(dark(wpx[2]), 'Feld im Wizard geschwärzt ' + wpx[2]);
  check(dark(wpx[3]), 'sichtbarer Teil des Feldes neben dem Wizard bleibt geschwärzt ' + wpx[3]);
  await page.evaluate(() => { document.getElementById('wizard').hidden = true; document.getElementById('wiz-bg').hidden = true; });

  // Synthetische Ereignisse der Seite (isTrusted = false) dürfen keine Schritte erzeugen.
  await page.evaluate(() => {
    const b = document.querySelector('#confirm');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
    b.click();
  });
  await page.waitForTimeout(800);
  const afterFake = await helper.evaluate((g) => DB.countSteps(g), guideId);
  check(afterFake === clicks.length, 'synthetische Klicks der Seite werden ignoriert');

  // Letzten verwerfen, Pause
  const disc = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'discard' }));
  check(disc.rec.count === clicks.length - 1, 'letzter Schritt verworfen');
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'pause' }));
  await page.click('#confirm');
  await page.waitForTimeout(800);
  const afterPause = await helper.evaluate((g) => DB.countSteps(g), guideId);
  check(afterPause === clicks.length - 1, 'während Pause keine Schritte');
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'resume' }));

  // Popup während der Aufnahme
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 560 });
  await popup.goto(ext('src/popup/popup.html'));
  await popup.waitForTimeout(600);
  await popup.screenshot({ path: path.join(OUT, 'popup-aufnahme.png') });
  check(await popup.locator('#view-rec').isVisible(), 'Popup zeigt Aufnahme');
  await popup.close();

  await page.bringToFront();
  const stop = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  check(stop.ok && stop.guideId === guideId, 'Aufnahme beendet');
  await page.waitForTimeout(800);
  const editor = ctx.pages().find((p) => p.url().includes('editor.html?guide='));
  check(!!editor, 'Editor öffnet sich nach Stopp');
  await editor.setViewportSize({ width: 1440, height: 980 });
  await editor.waitForTimeout(800);
  await editor.screenshot({ path: path.join(OUT, 'editor.png') });

  // Manuelles Schwärzen im Editor
  await editor.click('[data-tool="redact"]');
  const box = await editor.locator('#ed-stage').boundingBox();
  await editor.mouse.move(box.x + 20, box.y + 20);
  await editor.mouse.down();
  await editor.mouse.move(box.x + 120, box.y + 60, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(600);
  const red0 = 6;
  const red = await editor.evaluate(async () => {
    const s = Editor.state.steps[0];
    const fresh = await DB.getStep(s.id);
    const k = fresh.imgW / document.getElementById('ed-stage').getBoundingClientRect().width;
    const out = (await Render.renderStep(fresh, { marker: false })).blob;
    const bmp = await createImageBitmap(out);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return { n: fresh.redactions.length, px: Array.from(g.getImageData(Math.round(70 * k), Math.round(40 * k), 1, 1).data) };
  });
  check(red.n === red0 + 1 && dark(red.px), `manuelle Schwärzung gespeichert und im Export deckend (${red.n}, ${red.px})`);
  await editor.screenshot({ path: path.join(OUT, 'editor-schwaerzen.png') });

  // Schwärzung per Klick wieder entfernen
  await editor.mouse.click(box.x + 70, box.y + 40);
  await editor.waitForTimeout(400);
  const afterRemove = await editor.evaluate(async () => (await DB.getStep(Editor.state.steps[0].id)).redactions.length);
  check(afterRemove === red0, `Schwärzung per Klick entfernt (${afterRemove})`);
  await editor.click('#ed-undo');
  await editor.waitForTimeout(300);
  const afterUndo = await editor.evaluate(async () => (await DB.getStep(Editor.state.steps[0].id)).redactions.length);
  check(afterUndo === red0 + 1, 'Entfernen lässt sich rückgängig machen');

  // Zuschneiden
  const before = await editor.evaluate(() => ({ w: Editor.state.steps[0].imgW }));
  await editor.click('[data-tool="crop"]');
  await editor.mouse.move(box.x + 10, box.y + 10);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await editor.mouse.up();
  await editor.click('#ed-crop-apply');
  await editor.waitForTimeout(600);
  const after = await editor.evaluate(async () => { const s = await DB.getStep(Editor.state.steps[0].id); return { w: s.imgW, bw: (await createImageBitmap(s.image)).width }; });
  check(after.w < before.w && after.w === after.bw, `Zuschneiden fest im Bild (${before.w} → ${after.w})`);

  // Werkzeugleiste: „Schwärzung bearbeiten“, „Pfeil“ und „Text“ getrennt
  const tools = await editor.locator('#ed-toolbar .tool').allInnerTexts();
  check(tools.map((t) => t.trim()).join('|').startsWith('Schwärzung bearbeiten|Zuschneiden|Klickpunkt verschieben|Pfeil|Text|'),
    'Werkzeuge: ' + tools.map((t) => t.trim()).join(', '));

  // Pfeil: Standardfarbe Lila, Farbe wählbar, auswählbar, verschiebbar, Entf löscht
  const annos = async () => editor.evaluate(async () => (await DB.getStep(Editor.state.steps[0].id)).annotations || []);
  await editor.click('[data-tool="arrow"]');
  let box2 = await editor.locator('#ed-stage').boundingBox();
  check(await editor.locator('#ed-colors').isVisible() && (await editor.locator('#ed-colors .swatch').count()) === 7, 'Farbleiste mit 7 Farben');
  await editor.mouse.move(box2.x + 40, box2.y + 120);
  await editor.mouse.down();
  await editor.mouse.move(box2.x + 200, box2.y + 120, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(300);
  let an = await annos();
  check(an.length === 1 && an[0].type === 'arrow' && an[0].color === '#7A4FD1', 'Pfeil in Lila angelegt ' + JSON.stringify(an[0]));
  await editor.click('#ed-colors [aria-label="Blau"]');
  await editor.waitForTimeout(300);
  an = await annos();
  check(an[0].color === '#2B59C3', 'Farbe der Auswahl auf Blau geändert');
  // verschieben
  const x1 = an[0].x1;
  const y1 = an[0].y1;
  await editor.mouse.move(box2.x + 120, box2.y + 120);
  await editor.mouse.down();
  await editor.mouse.move(box2.x + 120, box2.y + 160, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(300);
  an = await annos();
  check(an.length === 1 && Math.abs(an[0].x1 - x1) < 1 && an[0].y1 > y1 + 5, 'Pfeil verschoben');
  await editor.keyboard.press('Delete');
  await editor.waitForTimeout(300);
  an = await annos();
  check(an.length === 0, 'Pfeil mit Entf gelöscht');

  // Rechteck: aufziehen, an der Ecke vergrößern; Kreis: oval aufziehen
  await editor.click('#ed-colors [aria-label="Grün"]');
  await editor.click('[data-tool="rect"]');
  box2 = await editor.locator('#ed-stage').boundingBox();
  await editor.mouse.move(box2.x + 300, box2.y + 60);
  await editor.mouse.down();
  await editor.mouse.move(box2.x + 400, box2.y + 120, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(300);
  an = await annos();
  const r0 = an[0];
  check(an.length === 1 && r0.type === 'rect' && r0.color === '#1D7A46' && r0.w > 0 && r0.h > 0, 'Rechteck in Grün angelegt');
  await editor.mouse.move(box2.x + 400, box2.y + 120);
  await editor.mouse.down();
  await editor.mouse.move(box2.x + 460, box2.y + 200, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(300);
  an = await annos();
  check(an[0].w > r0.w && an[0].h > r0.h && Math.abs(an[0].x - r0.x) < 1, 'Rechteck über Eckgriff vergrößert');
  await editor.click('[data-tool="ellipse"]');
  await editor.mouse.move(box2.x + 500, box2.y + 60);
  await editor.mouse.down();
  await editor.mouse.move(box2.x + 700, box2.y + 120, { steps: 5 });
  await editor.mouse.up();
  await editor.waitForTimeout(300);
  an = await annos();
  check(an.length === 2 && an[1].type === 'ellipse' && an[1].w > 2 * an[1].h, 'Oval aufgezogen');
  const shapePx = await editor.evaluate(async () => {
    const st = await DB.getStep(Editor.state.steps[0].id);
    const r = st.annotations[0];
    const out = (await Render.renderStep(st, { marker: false })).blob;
    const bmp = await createImageBitmap(out);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return Array.from(g.getImageData(Math.round(r.x + r.w / 2), Math.round(r.y), 1, 1).data);
  });
  check(shapePx[0] === 0x1D && shapePx[1] === 0x7A && shapePx[2] === 0x46, 'Rechteck im Export in Grün ' + shapePx);
  await editor.screenshot({ path: path.join(OUT, 'editor-formen.png') });
  // Formen wieder entfernen, damit die folgenden Prüfungen unverändert bleiben
  await editor.keyboard.press('Delete');
  await editor.mouse.click(box2.x + 350, box2.y + 60);
  await editor.waitForTimeout(200);
  await editor.keyboard.press('Delete');
  await editor.waitForTimeout(300);
  check((await annos()).length === 0, 'Formen gelöscht');

  // Text: Klick setzt eine Textbox, Eingabe ändert sie, sie erscheint im Export
  await editor.click('[data-tool="text"]');
  box2 = await editor.locator('#ed-stage').boundingBox();
  await editor.mouse.click(box2.x + 60, box2.y + 180);
  await editor.waitForTimeout(200);
  check(await editor.locator('#ed-anno-bar').isVisible(), 'Textfeld erscheint nach Klick');
  await editor.fill('#ed-anno-text', 'Hier klicken');
  await editor.waitForTimeout(600);
  an = await annos();
  check(an.length === 1 && an[0].type === 'text' && an[0].text === 'Hier klicken', 'Text gespeichert: ' + JSON.stringify(an));
  const textPx = await editor.evaluate(async () => {
    const st = await DB.getStep(Editor.state.steps[0].id);
    const a = st.annotations[0];
    const out = (await Render.renderStep(st, { marker: false })).blob;
    const bmp = await createImageBitmap(out);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return Array.from(g.getImageData(Math.round(a.x + 3), Math.round(a.y), 1, 1).data);
  });
  check(textPx[0] === 0x1D && textPx[1] === 0x7A && textPx[2] === 0x46, 'Textbox im Export in der gewählten Farbe ' + textPx);
  await editor.screenshot({ path: path.join(OUT, 'editor-text.png') });
  await editor.click('[data-tool="text"]');

  // Text bearbeiten, Abschnitt einfügen
  await editor.fill('#ed-text', 'Klicke auf „Bestätigen“ <script>alert(1)</script>');
  await editor.fill('#ed-note', 'Hinweis mit <b>HTML</b> & Sonderzeichen');
  await editor.waitForTimeout(500);
  await editor.click('#ed-add-section');
  await editor.waitForFunction(() => document.getElementById('ed-num').textContent === '§');
  await editor.fill('#ed-text', 'Zweiter Teil');
  await editor.waitForTimeout(700);

  // Export-Dialog
  await editor.click('#ed-export');
  await editor.waitForTimeout(300);
  await editor.screenshot({ path: path.join(OUT, 'export.png') });
  check(await editor.locator('#ex-warn').isVisible(), 'Export warnt vor ungeschwärzten Feldern');
  await editor.locator('.fmt').nth(2).click();
  await editor.waitForTimeout(1500);
  check(!(await editor.locator('#ex-crop').isChecked()), 'Odoo: Zuschneiden nicht voreingestellt');
  const size = await editor.locator('#ex-size').textContent();
  check(/KB|MB/.test(size), 'Odoo-Größenschätzung ' + size);
  await editor.screenshot({ path: path.join(OUT, 'export-odoo.png') });

  const results = await editor.evaluate(async () => {
    await Editor.flushSaves();
    const id = Editor.state.guide.id;
    const html = await (await Exporter.html(id, { marker: true, crop: false, cover: false })).text();
    const odoo = await Exporter.odoo(id, { marker: true, crop: true });
    const md = await Exporter.markdown(id, { marker: true, crop: false });
    const mdEntries = await Zip.read(md);
    const mdText = new TextDecoder().decode(await mdEntries.get('anleitung.md').read());
    const pdf = await Exporter.pdf(id, { marker: true, crop: false, cover: false });
    const pdfB64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(pdf); });
    const bak = await Exporter.backup(id);
    const newId = await Exporter.importProject(bak);
    const a = await DB.getSteps(id);
    const b = await DB.getSteps(newId);
    return {
      pdfB64, html, odooHtml: odoo.html, mdText, mdFiles: Array.from(mdEntries.keys()),
      roundtrip: a.length === b.length && a.every((s, i) => s.text === b[i].text && s.type === b[i].type && (s.imgW || 0) === (b[i].imgW || 0))
    };
  });
  const htmlDec = results.html.replace(/&#39;/g, "'");
  check(htmlDec.includes('Content-Security-Policy') && htmlDec.includes("script-src 'sha256-") && htmlDec.includes("default-src 'none'"), 'HTML-Export mit CSP');
  check(!results.html.includes('<script>alert(1)') && results.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'HTML-Export escaped Text');
  check(!/https?:\/\//.test(results.html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'HTML-Export lädt nichts von außen');
  check(results.odooHtml.includes('data:image/webp') || results.odooHtml.includes('data:image/png'), 'Odoo-Export mit eingebetteten Bildern');
  // Wie in Odoo Wissen: schmale Spalte, Überlauf abgeschnitten. Bilder müssen vollständig hineinpassen.
  const narrow = await ctx.newPage();
  await narrow.setContent(`<div id="col" style="width:620px;overflow:hidden">${results.odooHtml}</div>`);
  await narrow.waitForTimeout(300);
  const fitInfo = await narrow.evaluate(() => {
    const col = document.getElementById('col').getBoundingClientRect();
    return Array.from(document.images).map((im) => {
      const r = im.getBoundingClientRect();
      return { right: Math.round(r.right - col.left), w: Math.round(r.width), ratio: +(r.width / r.height).toFixed(2), nat: +(im.naturalWidth / im.naturalHeight).toFixed(2) };
    });
  });
  await narrow.close();
  check(fitInfo.length > 0 && fitInfo.every((f) => f.right <= 620 && Math.abs(f.ratio - f.nat) < 0.02),
    'Odoo-Export: Bilder passen in eine schmale Spalte, ohne abgeschnitten oder verzerrt zu werden ' + JSON.stringify(fitInfo.slice(0, 2)));
  check(!results.odooHtml.includes('<script>'), 'Odoo-Export escaped');
  check(results.mdText.includes('\\<script\\>') && results.mdFiles.some((f) => f.startsWith('bilder/')), 'Markdown escaped, Bilder im ZIP');
  check(results.roundtrip, 'Projektsicherung: Export und Import ergeben dieselben Schritte');
  fs.writeFileSync(path.join(OUT, 'export.html'), results.html);
  const pdfPath = path.join(OUT, 'export.pdf');
  fs.writeFileSync(pdfPath, Buffer.from(results.pdfB64, 'base64'));
  const { execFileSync } = require('child_process');
  let pdfText = '';
  let pdfInfo = '';
  try {
    pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
    pdfInfo = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  } catch (e) { pdfText = 'FEHLER ' + e.message; }
  check(/Pages:\s+\d+/.test(pdfInfo) && pdfText.includes('Wähle bei „Kunde“ einen Eintrag aus') && pdfText.includes('Zweiter Teil'),
    'PDF ist gültig und enthält die Schritte mit Umlauten und Anführungszeichen');
  try { execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '2', pdfPath, path.join(OUT, 'pdf-seite')]); } catch (_) { /* nur Ansicht */ }

  // Exportierte Datei öffnen: CSP-Hashes müssen passen (Stil greift, kein CSP-Fehler).
  const exp = await ctx.newPage();
  const cspErrors = [];
  exp.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  await exp.goto('file://' + path.join(OUT, 'export.html'));
  await exp.waitForTimeout(500);
  const bg = await exp.evaluate(() => getComputedStyle(document.querySelector('.g-num')).backgroundColor);
  check(bg === 'rgb(27, 29, 31)' && cspErrors.length === 0, `exportierte HTML-Datei rendert mit eigener CSP (${bg}, ${cspErrors.length} CSP-Fehler)`);
  await exp.screenshot({ path: path.join(OUT, 'export-datei.png') });
  await exp.close();

  // Vorschau
  const pv = await ctx.newPage();
  await pv.goto(ext(`src/export/preview.html?guide=${guideId}&cover=0`));
  await pv.waitForTimeout(1200);
  await pv.screenshot({ path: path.join(OUT, 'vorschau.png'), fullPage: false });
  check(await pv.locator('.g-step').count() >= 1, 'Vorschau rendert Schritte');

  // Seitenleiste zeigt die Schritte der letzten Anleitung
  const sb = await ctx.newPage();
  await sb.setViewportSize({ width: 380, height: 900 });
  await sb.goto(ext('src/sidebar/sidebar.html'));
  await sb.waitForTimeout(1000);
  const sbCount = await sb.locator('.sb-step').count();
  check(sbCount >= 5, `Seitenleiste listet Schritte (${sbCount})`);
  await sb.screenshot({ path: path.join(OUT, 'seitenleiste.png') });

  // Übersicht und Einstellungen
  const ov = await ctx.newPage();
  await ov.goto(ext('src/editor/editor.html'));
  await ov.waitForTimeout(600);
  check(await ov.locator('.ov-item').count() === 2, 'Übersicht zeigt beide Anleitungen');
  await ov.screenshot({ path: path.join(OUT, 'uebersicht.png') });

  // Popup bereit
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 360, height: 560 });
  await p2.goto(ext('src/popup/popup.html'));
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: path.join(OUT, 'popup-bereit.png') });

  const st = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  check(st && st.ok && st.rec === null, 'kein Aufnahmezustand übrig');

  // ---------- Schalter in der Seitenleiste, Kopfzeilen-Schwärzung in den Einstellungen ----------
  const sbOpt = await ctx.newPage();
  await sbOpt.goto(ext('src/sidebar/sidebar.html'));
  await sbOpt.waitForTimeout(700);
  check(await sbOpt.locator('#sb-opt-redact').isChecked() && !(await sbOpt.locator('#sb-opt-keys').isChecked()) &&
    (await sbOpt.locator('#sb-opt-header').count()) === 0, 'Seitenleiste zeigt Schwärzen und Tastatureingaben, Kopfzeile nur in den Einstellungen');
  await sbOpt.screenshot({ path: path.join(OUT, 'seitenleiste-optionen.png') });
  await sbOpt.close();
  const optP = await ctx.newPage();
  await optP.goto(ext('src/options/options.html'));
  await optP.waitForTimeout(500);
  await optP.locator('#redactHeader').uncheck();
  await optP.waitForTimeout(300);
  await optP.close();
  const hdrOff = await helper.evaluate(() => Settings.get().then((x) => x.redactHeader));
  check(hdrOff === false, 'Kopfzeilen-Schwärzung in den Einstellungen abgeschaltet');
  await page.bringToFront();
  const hdrRec = await helper.evaluate((t) => chrome.runtime.sendMessage({ type: 'start', tabId: t }), tabId);
  await page.click('#confirm');
  await page.waitForTimeout(1200);
  const hdrStep = await helper.evaluate((g) => DB.getSteps(g).then((x) => x[x.length - 1].redactions.length), hdrRec.rec.guideId);
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'stop', openEditor: false }));
  check(hdrStep === 4, `ohne Kopfzeilen-Schwärzung nur die Feld-Schwärzungen (${hdrStep})`);
  await helper.evaluate(() => Settings.set({ redactHeader: true }));

  // ---------- Schritte einfügen ----------
  await page.bringToFront();
  const insBefore = await helper.evaluate((g) => DB.getSteps(g).then((s) => s.map((x) => ({ id: x.id, text: x.text }))), guideId);
  const anchor = insBefore[1];
  const ins = await helper.evaluate(({ t, g, a }) => chrome.runtime.sendMessage({ type: 'start', tabId: t, guideId: g, afterStepId: a }), { t: tabId, g: guideId, a: anchor.id });
  check(ins && ins.ok && ins.rec.insert && ins.rec.guideId === guideId, 'Einfügen in bestehende Anleitung startet');
  await page.click('#tab');
  await page.waitForTimeout(700);
  await page.click('#iconbtn');
  await page.waitForTimeout(900);
  const sbIns = await ctx.newPage();
  await sbIns.goto(ext('src/sidebar/sidebar.html'));
  await sbIns.waitForTimeout(800);
  check((await sbIns.locator('#sb-insert').textContent()).includes('nach Schritt'), 'Seitenleiste zeigt Einfügeposition');
  check(await sbIns.locator('.sb-step.added').count() === 2, 'eingefügte Schritte markiert');
  await sbIns.screenshot({ path: path.join(OUT, 'seitenleiste-einfuegen.png') });
  await sbIns.close();
  await page.bringToFront();
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'stop', openEditor: false }));
  const insAfter = await helper.evaluate((g) => DB.getSteps(g).then((s) => s.map((x) => ({ id: x.id, text: x.text }))), guideId);
  check(insAfter.length === insBefore.length + 2, `zwei Schritte eingefügt (${insBefore.length} → ${insAfter.length})`);
  check(insAfter[1].id === anchor.id && insAfter[2].text === 'Öffne den Reiter „Auftragszeilen“' && insAfter[3].text === 'Klicke auf „Aktion“' &&
    insAfter[4].id === insBefore[2].id, 'neue Schritte stehen direkt nach dem gewählten Schritt');

  // Vorgemerkte Einfügestelle (aus dem Editor), Verwerfen löscht nur den eingefügten Schritt
  const pend = await helper.evaluate(({ g, a }) => chrome.runtime.sendMessage({ type: 'set-insert', guideId: g, afterStepId: a }), { g: guideId, a: insAfter[0].id });
  check(pend && pend.ok && pend.pendingInsert.number === 1, 'Einfügestelle vorgemerkt');
  await page.bringToFront();
  const st2 = await helper.evaluate((t) => chrome.runtime.sendMessage({ type: 'start', tabId: t }), tabId);
  check(st2.ok && st2.rec.insert && st2.rec.guideId === guideId, 'Start nutzt vorgemerkte Einfügestelle');
  await page.click('#confirm');
  await page.waitForTimeout(900);
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'discard' }));
  const stopped = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'stop', openEditor: false }));
  const insAfter2 = await helper.evaluate((g) => DB.getSteps(g).then((s) => s.map((x) => x.id)), guideId);
  check(stopped.ok && JSON.stringify(insAfter2) === JSON.stringify(insAfter.map((x) => x.id)), 'Verwerfen entfernt nur den eingefügten Schritt, Anleitung bleibt');
  const st3 = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  check(!st3.pendingInsert, 'vorgemerkte Einfügestelle verbraucht');

  // Symbol öffnet standardmäßig die Seitenleiste (kein Popup), abschaltbar
  const popupDefault = await helper.evaluate(() => chrome.action.getPopup({}));
  const panel = await helper.evaluate(() => chrome.sidePanel.getPanelBehavior());
  check(popupDefault === '' && panel.openPanelOnActionClick === true, 'Klick aufs Symbol öffnet die Seitenleiste');
  await helper.evaluate(() => Settings.set({ openSidebar: false }));
  await helper.waitForTimeout(500);
  const popupOff = await helper.evaluate(() => chrome.action.getPopup({}));
  check(popupOff.endsWith('src/popup/popup.html'), 'abgeschaltet: Popup wieder aktiv');
  await helper.evaluate(() => Settings.set({ openSidebar: true }));

  // ---------- Editor: zurück zum Herkunfts-Tab springen, Live-Update ----------
  await editor.bringToFront();
  await editor.reload();
  await editor.waitForTimeout(800);
  const edCountBefore = await editor.locator('#ed-steps .step-btn').count();
  await editor.locator('#ed-steps .step-btn').first().click();
  await editor.click('#ed-insert');
  await editor.waitForTimeout(1200);
  const jump = await helper.evaluate(async (t) => {
    const tab = await chrome.tabs.get(t);
    const st = await chrome.runtime.sendMessage({ type: 'status' });
    return { active: tab.active, rec: st.rec };
  }, tabId);
  check(jump.active && jump.rec && jump.rec.insert && jump.rec.insert.number === 1, 'Editor springt zum Herkunfts-Tab und startet das Einfügen');
  await page.click('#confirm');
  await page.waitForTimeout(1200);
  const edCountLive = await editor.locator('#ed-steps .step-btn').count();
  check(edCountLive === edCountBefore + 1, `Editor zeigt neuen Schritt live (${edCountBefore} → ${edCountLive})`);
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'stop', openEditor: false }));
  await editor.waitForTimeout(800);
  const selText = await editor.locator('#ed-steps .step-btn[aria-selected="true"] .t').textContent();
  const secondText = await editor.locator('#ed-steps .step-btn').nth(1).locator('.t').textContent();
  check(selText === 'Klicke auf „Bestätigen“' && secondText === selText, 'nach dem Stopp ist der eingefügte Schritt ohne Neuladen ausgewählt');

  check(errors.length === 0, 'keine Fehler in Erweiterungsseiten ' + JSON.stringify(errors));
  await ctx.close();
  server.close();
  console.log(`\nScreenshots: ${OUT}`);
  if (fails.length) {
    console.log(`\n${fails.length} Prüfungen fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
