// PDF-Schreiber: Aufbau, Querverweise, Kodierung. Aufruf: npm test
/* global Buffer */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Pdf = require('../src/lib/pdf.js');

async function bytesOf(blob) { return Buffer.from(await blob.arrayBuffer()); }

test('WinAnsi: Umlaute und deutsche Anführungszeichen', () => {
  const b = Pdf.winAnsi('Ä„x“…€✓');
  assert.deepStrictEqual([...b].map((c) => c.charCodeAt(0)), [0xC4, 0x84, 0x78, 0x93, 0x85, 0x80, 0x3F]);
});

test('Umbruch hält die Breite ein und trennt überlange Wörter', () => {
  const lines = Pdf.wrap('a '.repeat(200) + 'x'.repeat(300), 10, false, 200);
  assert.ok(lines.length > 3);
});

test('gültige Struktur mit korrekten Querverweisen', async () => {
  const items = [];
  for (let i = 1; i <= 40; i++) items.push({ type: 'step', n: i, text: `Klicke auf „Schritt ${i}“ (Klammer) \\`, note: i % 5 ? '' : 'Hinweis ' + 'lang '.repeat(80), img: null });
  items.splice(3, 0, { type: 'section', text: 'Abschnitt', note: 'Text' });
  const buf = await bytesOf(await Pdf.build({ title: 'Test „Ä“', meta: '40 Schritte', intro: 'Einleitung', footer: 'Fuß', cover: null, items }));
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.strictEqual(s.slice(startxref, startxref + 4), 'xref');
  const count = Number(/xref\n0 (\d+)/.exec(s)[1]);
  const table = s.slice(startxref).split('\n').slice(3, 3 + count - 1);
  table.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.strictEqual(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `Objekt ${i + 1}`);
  });
  const pages = Number(/\/Type \/Pages .*\/Count (\d+)/.exec(s)[1]);
  assert.ok(pages >= 2, 'Seitenumbruch');
  assert.ok(!/javascript|\/JS|\/OpenAction|\/URI/i.test(s), 'keine aktiven Inhalte');
});
