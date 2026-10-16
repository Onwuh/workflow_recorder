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

test('Testcheckliste: Art, Testinfo, erwartetes Ergebnis und Prüfpunkt bleiben erhalten', () => {
  const p = ok();
  p.guide.kind = 'checklist';
  p.guide.test = { pre: 'Benutzer mit Verkaufsrechten', data: 'Testkunde', evil: 1 };
  p.steps[0].expected = 'Status wechselt auf „Verkaufsauftrag“';
  p.steps[0].kind = 'check';
  const r = Project.validate(p);
  assert.strictEqual(r.guide.kind, 'checklist');
  assert.deepStrictEqual(r.guide.test, { pre: 'Benutzer mit Verkaufsrechten', data: 'Testkunde' });
  assert.strictEqual(r.steps[0].expected, 'Status wechselt auf „Verkaufsauftrag“');
  assert.strictEqual(r.steps[0].kind, 'check');
});

test('Testcheckliste: unbekannte Art und zu lange Texte', () => {
  const p = ok();
  p.guide.kind = 'evil';
  p.steps[0].kind = 'script';
  p.steps[0].expected = 'x'.repeat(5000);
  const r = Project.validate(p);
  assert.ok(!('kind' in r.guide) && !('test' in r.guide));
  assert.strictEqual(r.steps[0].kind, 'click');
  assert.strictEqual(r.steps[0].expected.length, Project.MAX_EXPECTED);
});

test('Sicherung einer Checkliste lässt sich wieder einlesen', () => {
  const guide = { title: 'Test', intro: 'Ziel', kind: 'checklist', test: { pre: 'a', data: 'b' } };
  const steps = [{ type: 'step', kind: 'check', text: 'Prüfpunkt', expected: 'Rechnung im Entwurf', x: 1, y: 1, vw: 10, vh: 10, imgW: 20, imgH: 20 }];
  const r = Project.validate(JSON.parse(JSON.stringify(Project.manifest(guide, steps))));
  assert.strictEqual(r.guide.kind, 'checklist');
  assert.strictEqual(r.guide.test.data, 'b');
  assert.strictEqual(r.steps[0].expected, 'Rechnung im Entwurf');
  assert.strictEqual(r.steps[0].kind, 'check');
});
