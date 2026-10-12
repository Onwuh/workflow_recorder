/* Projektsicherung als ZIP: Format und strenge Prüfung beim Einlesen.
   Eingelesene Daten gelten als nicht vertrauenswürdig: nur bekannte Felder, Typen und Grenzen. */
'use strict';

var Project = (() => {
  const FORMAT = 'workflow-recorder-project';
  const VERSION = 1;
  const MANIFEST = 'workflow-recorder.json';
  const MAX_STEPS = 2000;
  const MAX_ANNOTATIONS = 50;
  const IMG_RE = /^bilder\/\d{4}\.png$/;

  function str(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
  }

  function line(v, max) {
    return str(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function num(v, min, max, fallback) {
    const n = Number(v);
    if (typeof v !== 'number' || !Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function ts(v) {
    return num(v, 0, 8.64e15, Date.now());
  }

  function annotation(a, imgW, imgH) {
    if (!a || typeof a !== 'object' || a.type !== 'arrow') return null;
    return {
      type: 'arrow',
      x1: num(a.x1, -imgW, 2 * imgW, 0),
      y1: num(a.y1, -imgH, 2 * imgH, 0),
      x2: num(a.x2, -imgW, 2 * imgW, 0),
      y2: num(a.y2, -imgH, 2 * imgH, 0),
      text: line(a.text, 80)
    };
  }

  /** Prüft das Manifest. Liefert { guide, steps } mit nur erlaubten Feldern oder wirft. */
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Unbekanntes Dateiformat');
    if (raw.format !== FORMAT) throw new Error('Keine Projektsicherung des Workflow Recorders');
    if (raw.version !== VERSION) throw new Error('Nicht unterstützte Version der Projektsicherung');
    const g = raw.guide && typeof raw.guide === 'object' ? raw.guide : {};
    const guide = {
      title: line(g.title, 200) || 'Importierte Anleitung',
      intro: str(g.intro, 5000),
      createdAt: ts(g.createdAt),
      logo: typeof g.logo === 'string' && g.logo === 'logo.png' ? 'logo.png' : null
    };
    if (!Array.isArray(raw.steps)) throw new Error('Schritte fehlen');
    if (raw.steps.length > MAX_STEPS) throw new Error('Zu viele Schritte');

    const seen = new Set();
    const steps = raw.steps.map((s, i) => {
      if (!s || typeof s !== 'object') throw new Error(`Schritt ${i + 1} ist ungültig`);
      const type = s.type === 'section' ? 'section' : 'step';
      if (type === 'section') {
        return { type, text: line(s.text, 200) || 'Abschnitt', note: str(s.note, 5000) };
      }
      if (typeof s.image !== 'string' || !IMG_RE.test(s.image)) throw new Error(`Schritt ${i + 1}: Bildpfad ungültig`);
      if (seen.has(s.image)) throw new Error(`Schritt ${i + 1}: Bild doppelt verwendet`);
      seen.add(s.image);
      const imgW = Math.round(num(s.imgW, 1, 16384, 1));
      const imgH = Math.round(num(s.imgH, 1, 16384, 1));
      const vw = num(s.vw, 1, 100000, imgW);
      const vh = num(s.vh, 1, 100000, imgH);
      const anns = Array.isArray(s.annotations) ? s.annotations.slice(0, MAX_ANNOTATIONS) : [];
      return {
        type,
        kind: s.kind === 'input' ? 'input' : 'click',
        text: line(s.text, 200) || 'Klicke an die markierte Stelle',
        note: str(s.note, 5000),
        x: num(s.x, 0, vw, 0),
        y: num(s.y, 0, vh, 0),
        vw, vh,
        dpr: num(s.dpr, 0.25, 10, 1),
        imgW, imgH,
        showMarker: s.showMarker !== false,
        annotations: anns.map((a) => annotation(a, imgW, imgH)).filter(Boolean),
        unredacted: Math.round(num(s.unredacted, 0, 999, 0)),
        navigated: s.navigated === true,
        reviewed: s.reviewed === true,
        image: s.image
      };
    });
    return { guide, steps };
  }

  /** Baut das Manifest aus gespeicherten Daten (ohne Blobs). */
  function manifest(guide, steps) {
    let n = 0;
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: Date.now(),
      guide: {
        title: guide.title || '',
        intro: guide.intro || '',
        createdAt: guide.createdAt || Date.now(),
        logo: guide.logo ? 'logo.png' : null
      },
      steps: steps.map((s) => {
        if (s.type === 'section') return { type: 'section', text: s.text || '', note: s.note || '' };
        n++;
        return {
          type: 'step',
          kind: s.kind || 'click',
          text: s.text || '',
          note: s.note || '',
          x: s.x, y: s.y, vw: s.vw, vh: s.vh, dpr: s.dpr,
          imgW: s.imgW, imgH: s.imgH,
          showMarker: s.showMarker !== false,
          annotations: s.annotations || [],
          unredacted: s.unredacted || 0,
          navigated: !!s.navigated,
          reviewed: !!s.reviewed,
          image: `bilder/${String(n).padStart(4, '0')}.png`
        };
      })
    };
  }

  return { FORMAT, VERSION, MANIFEST, validate, manifest };
})();

if (typeof module !== 'undefined') module.exports = Project;
