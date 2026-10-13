// Freigabe-Muster für Website-Zugriff. Aufruf: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Hosts = require('../src/lib/hosts.js');

test('Muster für genau eine Website', () => {
  assert.strictEqual(Hosts.sitePattern('https://firma.odoo.com/odoo/action-1?x=1'), 'https://firma.odoo.com/*');
  assert.strictEqual(Hosts.sitePattern('http://127.0.0.1:8069/web'), 'http://127.0.0.1/*');
  assert.strictEqual(Hosts.sitePattern('chrome://extensions'), null);
  assert.strictEqual(Hosts.sitePattern('kaputt'), null);
});

test('alle Instanzen einer Domain', () => {
  assert.deepStrictEqual(Hosts.domainPattern('https://firma.odoo.com/web'), { pattern: '*://*.odoo.com/*', label: 'odoo.com' });
  assert.deepStrictEqual(Hosts.domainPattern('https://x-y-1.dev.odoo.sh/'), { pattern: '*://*.odoo.sh/*', label: 'odoo.sh' });
  assert.deepStrictEqual(Hosts.domainPattern('https://erp.beispiel.de/'), { pattern: '*://*.beispiel.de/*', label: 'beispiel.de' });
  assert.strictEqual(Hosts.domainPattern('https://beispiel.de/'), null, 'ohne Subdomain kein Angebot');
  assert.strictEqual(Hosts.domainPattern('https://shop.beispiel.co.uk/'), null, 'zweistufige Endung');
  assert.strictEqual(Hosts.domainPattern('http://10.0.0.5/'), null, 'IP-Adresse');
  assert.strictEqual(Hosts.domainPattern('http://localhost:8069/'), null);
});

test('Content-Script-Muster aus Freigaben', () => {
  assert.deepStrictEqual(Hosts.scriptMatches(['<all_urls>']), ['http://*/*', 'https://*/*']);
  assert.deepStrictEqual(Hosts.scriptMatches(['https://a.de/*', '*://*.odoo.com/*', 'file:///*', 'ftp://x/*']), ['https://a.de/*', '*://*.odoo.com/*']);
  assert.deepStrictEqual(Hosts.scriptMatches(undefined), []);
});

test('lesbare Namen', () => {
  assert.strictEqual(Hosts.label('<all_urls>'), 'Alle Websites');
  assert.strictEqual(Hosts.label('*://*.odoo.com/*'), 'Alle Instanzen von odoo.com');
  assert.strictEqual(Hosts.label('https://firma.odoo.com/*'), 'firma.odoo.com');
});
