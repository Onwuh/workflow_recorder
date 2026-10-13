// Manifeste für Chrome und Firefox: Berechtigungen. Aufruf: npm test
/* global process, __dirname */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

test('Chrome: nur activeTab, Website-Zugriff optional, kein festes Content-Script', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(m.permissions.includes('activeTab'));
  assert.ok(!('host_permissions' in m), 'keine Host-Berechtigungen bei der Installation');
  assert.ok(!('content_scripts' in m), 'Content-Script wird nur für freigegebene Websites registriert');
  assert.deepStrictEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.ok(!('scripts' in m.background), 'kein background.scripts im Chrome-Manifest');
});

test('Firefox-Paket: Hintergrundseite mit hosts.js, Host-Zugriff widerrufbar', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.js')], { stdio: 'ignore' });
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/firefox/manifest.json'), 'utf8'));
  assert.ok(m.background.scripts.includes('src/lib/hosts.js'));
  assert.ok(!('service_worker' in m.background));
  assert.ok(!('content_scripts' in m));
  assert.ok(m.permissions.includes('activeTab'));
  assert.ok(m.sidebar_action && !m.side_panel);
});
