/* Testvariante der Erweiterung: wie das echte Paket, aber mit vorab erteilter Freigabe für
   http://127.0.0.1 (den Freigabe-Dialog des Browsers kann Playwright nicht bedienen).
   localhost bleibt bewusst ohne Freigabe. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function makeTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-ext-'));
  copyDir(path.join(ROOT, 'src'), path.join(dir, 'src'));
  copyDir(path.join(ROOT, 'icons'), path.join(dir, 'icons'));
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  m.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

module.exports = { makeTestExtension };
