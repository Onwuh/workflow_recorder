// Prüfung eingelesener Projektsicherungen. Aufruf: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Project = require('../src/lib/project.js');

const ok = () => ({
  format: Project.FORMAT, version: 1,
  guide: { title: 'Test', intro: 'Hallo', logo: null },
  steps: [
    { type: 'step', text: 'Klicke auf „Neu“', x: 10, y: 20, vw: 100, vh: 100, imgW: 200, imgH: 200, image: 'bilder/0001.png' },
    { type: 'section', text: 'Abschnitt' }
  ]
});

test('gültiges Projekt', () => {
  const r = Project.validate(ok());
  assert.strictEqual(r.steps.length, 2);
  assert.strictEqual(r.steps[0].image, 'bilder/0001.png');
});

test('fremde Felder werden verworfen', () => {
  const p = ok();
  p.steps[0].guideId = 999; p.steps[0].id = 5; p.steps[0].__proto__polluted = 1;
  p.guide.id = 7;
  const r = Project.validate(p);
  assert.ok(!('guideId' in r.steps[0]) && !('id' in r.steps[0]));
  assert.ok(!('id' in r.guide));
});

test('Bildpfade mit Tricks werden abgelehnt', () => {
  for (const image of ['../x.png', 'bilder/1.png', 'bilder/0001.svg', 'bilder/0001.png/..', 42]) {
    const p = ok(); p.steps[0].image = image;
    assert.throws(() => Project.validate(p), /Bildpfad/);
  }
});

test('falsches Format', () => {
  assert.throws(() => Project.validate({ format: 'x', version: 1 }), /Keine Projektsicherung/);
  assert.throws(() => Project.validate([]), /Unbekanntes/);
});

test('Zahlen werden begrenzt, Texte gekürzt', () => {
  const p = ok();
  p.steps[0].x = 1e12; p.steps[0].imgW = -5; p.steps[0].text = 'a'.repeat(1000);
  p.steps[0].annotations = [{ type: 'arrow', x1: 'evil', y1: 1, x2: 2, y2: 3, text: '<b>x</b>' }, { type: 'script' }];
  const r = Project.validate(p);
  assert.strictEqual(r.steps[0].x, 100);
  assert.strictEqual(r.steps[0].imgW, 1);
  assert.strictEqual(r.steps[0].text.length, 200);
  assert.strictEqual(r.steps[0].annotations.length, 1);
  assert.strictEqual(r.steps[0].annotations[0].x1, 0);
});

test('zu viele Schritte', () => {
  const p = ok(); p.steps = new Array(2001).fill({ type: 'section' });
  assert.throws(() => Project.validate(p), /Zu viele/);
});
