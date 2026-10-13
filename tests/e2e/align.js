/* Ausrichtungstest mit echtem Fenster (ohne Viewport-Emulation): Liegen gespeicherte Schwärzung und
   Klickpunkt im Screenshot genau auf dem Feld bzw. Button? Auch bei gescrollter Seite.
   Aufruf: xvfb-run -a node tests/e2e/align.js */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif} .pad{height:700px;background:#eee}
.o_field_widget{display:inline-block;margin:40px} input{width:300px;height:40px;background:#FF00FF;border:0;color:#FF00FF}
#go{width:160px;height:60px;background:#00FF00;border:0;margin:40px}
</style></head><body><div class="pad"></div>
<div name="partner_id" class="o_field_widget"><input id="p" value="x"></div><br>
<button id="go" type="button">Weiter</button><div class="pad"></div></body></html>`;

const fails = [];
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };

(async () => {
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-al-')), {
    channel: 'chromium', headless: false, viewport: null,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--window-size=1280,900', ...(process.env.DPR ? [`--force-device-scale-factor=${process.env.DPR}`] : [])]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const ext = (p) => `chrome-extension://${sw.url().split('/')[2]}/${p}`;
  const helper = await ctx.newPage();
  await helper.goto(ext('src/editor/editor.html'));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 450));
  await page.waitForTimeout(300);
  const tabId = await helper.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, base);
  const st = await helper.evaluate((t) => chrome.runtime.sendMessage({ type: 'start', tabId: t }), tabId);
  check(st.ok, 'Aufnahme gestartet');
  await page.click('#go');
  await page.waitForTimeout(1200);
  const res = await helper.evaluate(async (g) => {
    const s = (await DB.getSteps(g))[0];
    const bmp = await createImageBitmap(s.image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx2 = c.getContext('2d');
    ctx2.drawImage(bmp, 0, 0);
    const px = (x, y) => Array.from(ctx2.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const r = s.redactions[0];
    const k = s.imgW / s.vw;
    return {
      n: s.redactions.length, size: [s.imgW, s.imgH, s.vw, s.vh, s.dpr],
      underRedaction: r ? px(r.x + r.w / 2, r.y + r.h / 2) : null,
      underMarker: px(s.x * k, s.y * k)
    };
  }, st.rec.guideId);
  console.log(JSON.stringify(res));
  const near = (p, c) => p && Math.abs(p[0] - c[0]) < 30 && Math.abs(p[1] - c[1]) < 30 && Math.abs(p[2] - c[2]) < 30;
  check(res.n >= 1 && near(res.underRedaction, [255, 0, 255]), 'Schwärzung liegt im Screenshot genau auf dem Feld');
  check(near(res.underMarker, [0, 255, 0]), 'Klickpunkt liegt im Screenshot auf dem Button');
  await ctx.close();
  server.close();
  if (fails.length) process.exit(1);
  console.log('Ausrichtung korrekt');
})().catch((e) => { console.error(e); process.exit(1); });
