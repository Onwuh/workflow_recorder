/* Bildbearbeitung auf Canvas.
   - Schwärzen und Zuschneiden werden fest ins gespeicherte Bild gerechnet (das Original wird ersetzt).
   - Klickmarker und Pfeile bleiben Vektordaten und werden erst beim Export ins Bild gezeichnet.
   Koordinaten von Annotationen und Rechtecken sind Bildpixel. */
'use strict';

// eslint-disable-next-line no-unused-vars
var Render = (() => {
  const REC = '#C8372D';
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
    g.save();
    g.strokeStyle = REC;
    g.fillStyle = REC;
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
      g.fillStyle = REC;
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.textBaseline = 'middle';
      g.fillText(a.text, bx + padX, by + bh / 2);
    }
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
      for (const a of step.annotations || []) {
        if (a && a.type === 'arrow') drawArrow(g, a, s);
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

  /** Schwärzt ein Rechteck dauerhaft (deckend, kein Weichzeichner). Liefert ein neues PNG. */
  async function bakeRedaction(step, rect) {
    const bmp = await bitmap(step.image);
    try {
      const r = clampRect(rect, bmp.width, bmp.height);
      if (r.w < 2 || r.h < 2) return null;
      const c = canvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      g.fillStyle = REDACT;
      roundRect(g, r.x, r.y, r.w, r.h, 3 * scaleOf(step));
      g.fill();
      return await toBlob(c, 'image/png');
    } finally {
      bmp.close();
    }
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
      const annotations = (step.annotations || []).map((a) => ({
        ...a, x1: a.x1 - r.x, y1: a.y1 - r.y, x2: a.x2 - r.x, y2: a.y2 - r.y
      }));
      return {
        image, imgW: r.w, imgH: r.h, vw, vh,
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

  return { renderStep, bakeRedaction, bakeCrop, reencode, clickRegion, markerPos, scaleOf, clampRect, REC };
})();
