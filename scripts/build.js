/* Baut die Pakete für Chrome und Firefox aus demselben Quellcode.
   - Chrome: manifest.json im Wurzelordner gilt unverändert (Service Worker, side_panel).
   - Firefox: Hintergrundseite statt Service Worker, sidebar_action statt side_panel, gecko-Angaben.
   Ergebnis: dist/chrome/, dist/firefox/ und je eine ZIP-Datei. Aufruf: npm run build */
'use strict';

const fs = require('fs');
const path = require('path');
const Zip = require('../src/lib/zip.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const COPY = ['src', 'icons'];

function firefoxManifest(chrome) {
  const m = JSON.parse(JSON.stringify(chrome));
  m.background = { scripts: ['src/db.js', 'src/settings.js', 'src/lib/hosts.js', 'src/background.js'] };
  // Firefox: Host-Berechtigungen sind unter MV3 ohnehin optional und einzeln widerrufbar.
  // optional_host_permissions kennt Firefox erst ab 128, daher hier host_permissions.
  delete m.optional_host_permissions;
  m.host_permissions = ['<all_urls>'];
  m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
  delete m.side_panel;
  m.sidebar_action = {
    default_title: 'Workflow Recorder',
    default_panel: 'src/sidebar/sidebar.html',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    open_at_install: false
  };
  m.browser_specific_settings = {
    gecko: {
      id: 'workflow-recorder@local',
      strict_min_version: '121.0',
      data_collection_permissions: { required: ['none'] }
    }
  };
  return m;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

async function build(name, manifest) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  for (const c of COPY) copyDir(path.join(ROOT, c), path.join(out, c));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = listFiles(out).map((f) => ({ name: f, data: new Uint8Array(fs.readFileSync(path.join(out, f))), compress: true }));
  const zip = await Zip.create(files);
  const zipPath = path.join(DIST, `workflow-recorder-${name}-${manifest.version}.zip`);
  fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
  console.log(`${name}: ${path.relative(ROOT, out)}/ und ${path.relative(ROOT, zipPath)}`);
}

(async () => {
  const chrome = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  await build('chrome', chrome);
  await build('firefox', firefoxManifest(chrome));
})().catch((e) => { console.error(e); process.exit(1); });
