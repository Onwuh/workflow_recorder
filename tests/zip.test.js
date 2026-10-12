// Prüft ZIP-Schreiben/Lesen und die Schutzgrenzen. Aufruf: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Zip = require('../src/lib/zip.js');

test('Rundreise stored + deflate', async () => {
  const big = 'abc'.repeat(10000);
  const blob = await Zip.create([
    { name: 'a.txt', data: 'hallo ä', compress: false },
    { name: 'ordner/b.txt', data: big, compress: true },
    { name: 'bin', data: new Uint8Array([0, 1, 2, 255]) }
  ]);
  const m = await Zip.read(blob);
  assert.strictEqual(new TextDecoder().decode(await m.get('a.txt').read()), 'hallo ä');
  assert.strictEqual(new TextDecoder().decode(await m.get('ordner/b.txt').read()), big);
  assert.deepStrictEqual([...await m.get('bin').read()], [0, 1, 2, 255]);
});

test('Pfadtricks werden abgelehnt', async () => {
  for (const name of ['../x', '/etc/x', 'a/../../x', 'C:/x', 'a\\b']) {
    const blob = await Zip.create([{ name, data: 'x' }]);
    await assert.rejects(Zip.read(blob), /Unsicherer Pfad/);
  }
});

test('Grenzen für Größe und Kompressionsverhältnis', async () => {
  const blob = await Zip.create([{ name: 'z', data: '0'.repeat(5 * 1024 * 1024), compress: true }]);
  await assert.rejects(Zip.read(blob, { maxEntry: 1024 * 1024 }), /zu groß/);
  await assert.rejects(Zip.read(blob, { maxRatio: 2 }), /Kompressionsverhältnis/);
});

test('Manipulierte Größe wird beim Entpacken erkannt', async () => {
  const blob = await Zip.create([{ name: 'z', data: 'x'.repeat(100000), compress: true }]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  // usize im zentralen Verzeichnis verkleinern
  const eocd = buf.length - 22;
  const cd = dv.getUint32(eocd + 16, true);
  dv.setUint32(cd + 24, 1000, true);
  const m = await Zip.read(new Blob([buf]));
  await assert.rejects(m.get('z').read(), /größer als angegeben/);
});

test('Kaputte Daten', async () => {
  await assert.rejects(Zip.read(new Blob([new Uint8Array(100)])), /Keine gültige ZIP/);
});
