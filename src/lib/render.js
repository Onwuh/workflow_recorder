/* Bildbearbeitung auf Canvas.
   - Schwärzungen, Klickmarker und Pfeile sind Vektordaten am Schritt (Bildpixel) und lassen sich im Editor
     entfernen. Beim Export (und in der Projektsicherung) werden sie fest ins Bild gerechnet: deckend,
     kein Weichzeichner, das Original gelangt nie in eine exportierte Datei.
   - Zuschneiden ersetzt das gespeicherte Bild. */
'use strict';

// eslint-disable-next-line no-unused-vars
var Render = (() => {
  const REC = '#C8372D';

  // Farben für Pfeil, Text und Formen. Standard Lila; ältere Annotationen ohne Farbe bleiben rot.
  const COLORS = [
    { id: 'lila', name: 'Lila', hex: '#7A4FD1' },
    { id: 'rot', name: 'Rot', hex: '#C8372D' },
    { id: 'blau', name: 'Blau', hex: '#2B59C3' },
    { id: 'gruen', name: 'Grün', hex: '#1D7A46' },
    { id: 'gelb', name: 'Gelb', hex: '#F2C200' },
    { id: 'schwarz', name: 'Schwarz', hex: '#1B1D1F' },
    { id: 'weiss', name: 'Weiß', hex: '#FFFFFF' }
  ];
  const DEFAULT_COLOR = '#7A4FD1';
  const HEXES = new Set(COLORS.map((c) => c.hex));

  /** Nur Farben aus der Palette; sonst die Vorgabe (fehlend = Rot für ältere Pfeile/Texte). */
  function colorOf(a) {
    return a && HEXES.has(a.color) ? a.color : REC;
  }

  /** Schriftfarbe auf der Textbox: dunkel auf hellen Farben, sonst weiß. */
  function textInk(hex) {
    return hex === '#FFFFFF' || hex === '#F2C200' ? '#1B1D1F' : '#FFFFFF';
  }
  const REDACT = '#1B1D1F';
  const MAX_DIM = 16384;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function toBlob(c, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      c.toBlob((b) => {
        if (!b) return reject(new Error('Bild konnte nicht erzeugt werden'));
        // Browser ohne WebP-Encoder liefern PNG, das ist in Ordnung.
        resolve(b);
      }, type, quality);
    });
  }

  async function bitmap(blob) {
    const bmp = await createImageBitmap(blob);
    if (bmp.width > MAX_DIM || bmp.height > MAX_DIM) {
      bmp.close();
      throw new Error('Bild ist zu groß');
    }
    return bmp;
  }

  /** Maßstab Bildpixel pro CSS-Pixel. */
  function scaleOf(step) {
    return step.vw ? step.imgW / step.vw : 1;
  }

  function markerPos(step) {
    return {
      cx: (step.x / step.vw) * step.imgW,
      cy: (step.y / step.vh) * step.imgH
    };
  }

  function clampRect(r, w, h) {
    let x = Math.max(0, Math.min(w, Math.round(Math.min(r.x, r.x + r.w))));
    let y = Math.max(0, Math.min(h, Math.round(Math.min(r.y, r.y + r.h))));
    const x2 = Math.max(0, Math.min(w, Math.round(Math.max(r.x, r.x + r.w))));
    const y2 = Math.max(0, Math.min(h, Math.round(Math.max(r.y, r.y + r.h))));
    return { x, y, w: x2 - x, h: y2 - y };
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  function drawMarker(g, cx, cy, s) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, 22 * s - 1.5 * s, 0, Math.PI * 2);
    g.fillStyle = 'rgba(200,55,45,0.12)';
    g.fill();
    g.lineWidth = 3 * s;
    g.strokeStyle = REC;
    g.stroke();
    g.restore();
  }

  function drawArrow(g, a, s) {
    const { x1, y1, x2, y2 } = a;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 14 * s;
    const col = colorOf(a);
    g.save();
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 4 * s;
    g.lineCap = 'round';
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > head) {
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
    g.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
    g.closePath();
    g.fill();
    if (a.text) {
      const fs = 15 * s;
      g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      const tw = g.measureText(a.text).width;
      const padX = 8 * s;
      const bh = fs + 10 * s;
      // Beschriftung am Pfeilanfang, vom Pfeil weg ausgerichtet.
      let bx = x1 - (Math.cos(ang) > 0 ? tw + 2 * padX : 0);
      let by = y1 - bh / 2;
      bx = Math.max(0, Math.min(g.canvas.width - tw - 2 * padX, bx));
      by = Math.max(0, Math.min(g.canvas.height - bh, by));
      roundRect(g, bx, by, tw + 2 * padX, bh, 5 * s);
      g.fillStyle = col;
      g.fill();
      g.fillStyle = textInk(col);
      g.textBaseline = 'middle';
      g.fillText(a.text, bx + padX, by + bh / 2);
    }
    g.restore();
  }

  const FONT = '600 {px}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  let measureCtx = null;

  /** Maße der Textbox (Bildpixel). Box beginnt links bei x und ist vertikal um y zentriert. */
  function textBox(text, s) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const fs = 15 * s;
    measureCtx.font = FONT.replace('{px}', fs);
    const padX = 8 * s;
    return { fs, padX, w: measureCtx.measureText(text).width + 2 * padX, h: fs + 10 * s, r: 5 * s };
  }

  function drawText(g, a, s) {
    if (!a.text) return;
    const b = textBox(a.text, s);
    const col = colorOf(a);
    g.save();
    roundRect(g, a.x, a.y - b.h / 2, b.w, b.h, b.r);
    g.fillStyle = col;
    g.fill();
    if (col === '#FFFFFF') {
      // Weiße Box braucht eine Kante, sonst verschwindet sie auf hellem Grund.
      g.lineWidth = 1.5 * s;
      g.strokeStyle = '#6B6E72';
      g.stroke();
    }
    g.font = FONT.replace('{px}', b.fs);
    g.fillStyle = textInk(col);
    g.textBaseline = 'middle';
    g.fillText(a.text, a.x + b.padX, a.y);
    g.restore();
  }

  /** Rechteck oder Ellipse als Umriss. */
  function drawShape(g, a, s) {
    const r = { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
    if (!(r.w >= 1 && r.h >= 1)) return;
    g.save();
    g.strokeStyle = colorOf(a);
    g.lineWidth = 4 * s;
    g.beginPath();
    if (a.type === 'ellipse') g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, 4 * s);
    else g.rect(r.x, r.y, r.w, r.h);
    g.stroke();
    g.restore();
  }


  /** Bereich um den Klickpunkt (für „auf Klickbereich zuschneiden“). */
  function clickRegion(step, cssW = 900, cssH = 560) {
    const s = scaleOf(step);
    const w = Math.min(step.imgW, Math.round(cssW * s));
    const h = Math.min(step.imgH, Math.round(cssH * s));
    const { cx, cy } = markerPos(step);
    const x = Math.max(0, Math.min(step.imgW - w, Math.round(cx - w / 2)));
    const y = Math.max(0, Math.min(step.imgH - h, Math.round(cy - h / 2)));
    return { x, y, w, h };
  }

  /**
   * Fertiges Exportbild eines Schritts.
   * opts: marker (bool), crop (bool), maxWidth (px, 0 = unbegrenzt), type, quality
   */
  async function renderStep(step, opts = {}) {
    const bmp = await bitmap(step.image);
    try {
      const full = { x: 0, y: 0, w: bmp.width, h: bmp.height };
      const region = opts.crop ? clickRegion({ ...step, imgW: bmp.width, imgH: bmp.height }) : full;
      const k = opts.maxWidth && region.w > opts.maxWidth ? opts.maxWidth / region.w : 1;
      const c = canvas(region.w * k, region.h * k);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
      g.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
      const s = bmp.width / (step.vw || bmp.width) || 1;
      // Schwärzung immer zuerst und deckend.
      drawRedactions(g, step.redactions, s);
      if (opts.annotations !== false) {
        for (const a of step.annotations || []) {
          if (a && a.type === 'arrow') drawArrow(g, a, s);
          else if (a && a.type === 'text') drawText(g, a, s);
          else if (a && (a.type === 'rect' || a.type === 'ellipse')) drawShape(g, a, s);
        }
      }
      if (opts.marker && step.showMarker !== false) {
        const { cx, cy } = markerPos({ ...step, imgW: bmp.width, imgH: bmp.height });
        drawMarker(g, cx, cy, s);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      return { blob: await toBlob(c, opts.type || 'image/png', opts.quality), width: c.width, height: c.height };
    } finally {
      bmp.close();
    }
  }

  function drawRedactions(g, list, s) {
    g.save();
    g.fillStyle = REDACT;
    for (const r of list || []) {
      roundRect(g, r.x, r.y, r.w, r.h, 3 * s);
      g.fill();
    }
    g.restore();
  }

  /** Schneidet dauerhaft zu. Liefert die geänderten Schrittfelder (Bild, Maße, Klickpunkt, Pfeile). */
  async function bakeCrop(step, rect) {
    const bmp = await bitmap(step.image);
    try {
      const r = clampRect(rect, bmp.width, bmp.height);
      if (r.w < 16 || r.h < 16) return null;
      const c = canvas(r.w, r.h);
      c.getContext('2d').drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const image = await toBlob(c, 'image/png');
      const cssPerPx = step.vw / bmp.width;
      const x = step.x - r.x * cssPerPx;
      const y = step.y - r.y * (step.vh / bmp.height);
      const vw = r.w * cssPerPx;
      const vh = r.h * (step.vh / bmp.height);
      const inside = x >= 0 && y >= 0 && x <= vw && y <= vh;
      const annotations = (step.annotations || []).map((a) => (a.type !== 'arrow'
        ? { ...a, x: a.x - r.x, y: a.y - r.y }
        : { ...a, x1: a.x1 - r.x, y1: a.y1 - r.y, x2: a.x2 - r.x, y2: a.y2 - r.y }));
      const redactions = (step.redactions || [])
        .map((q) => ({ ...clampRect({ x: q.x - r.x, y: q.y - r.y, w: q.w, h: q.h }, r.w, r.h), auto: !!q.auto }))
        .filter((q) => q.w > 0 && q.h > 0);
      return {
        image, imgW: r.w, imgH: r.h, vw, vh, redactions,
        x: Math.max(0, Math.min(vw, x)), y: Math.max(0, Math.min(vh, y)),
        showMarker: inside ? step.showMarker : false,
        annotations
      };
    } finally {
      bmp.close();
    }
  }

  /** Nimmt eine fremde Bilddatei an und kodiert sie neu (entfernt Metadaten und alles außer Pixeln). */
  async function reencode(blob, { maxWidth = 0, type = 'image/png', quality } = {}) {
    const bmp = await bitmap(blob);
    try {
      const k = maxWidth && bmp.width > maxWidth ? maxWidth / bmp.width : 1;
      const c = canvas(bmp.width * k, bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return { blob: await toBlob(c, type, quality), width: c.width, height: c.height };
    } finally {
      bmp.close();
    }
  }

  /** Bild auf weißem Grund als JPEG (für PDF; Transparenz würde sonst schwarz). */
  async function toJpeg(blob, { maxWidth = 0, quality = 0.9 } = {}) {
    const bmp = await bitmap(blob);
    try {
      const k = maxWidth && bmp.width > maxWidth ? maxWidth / bmp.width : 1;
      const c = canvas(bmp.width * k, bmp.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      return { blob: await toBlob(c, 'image/jpeg', quality), width: c.width, height: c.height };
    } finally {
      bmp.close();
    }
  }

  return { COLORS, DEFAULT_COLOR, colorOf, textInk, toJpeg, textBox, renderStep, bakeCrop, reencode, clickRegion, markerPos, scaleOf, clampRect, REC };
})();
