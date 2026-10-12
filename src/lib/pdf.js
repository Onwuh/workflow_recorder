/* Minimaler PDF-Schreiber für Anleitungen: A4, Helvetica (WinAnsi), JPEG-Bilder, Seitenumbruch.
   Keine Fremdbibliothek, keine eingebetteten Schriften, keine Skripte oder Links im PDF. */
'use strict';

var Pdf = (() => {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 50;               // Rand
  const CW = PAGE_W - 2 * M;  // Inhaltsbreite
  const FOOT = 34;            // Platz für die Fußzeile

  const C = {
    fg: [0x1B, 0x1D, 0x1F], fg2: [0x3A, 0x3D, 0x41], muted: [0x6B, 0x6E, 0x72], line: [0xDC, 0xDC, 0xD6],
    tipBg: [0xEE, 0xF2, 0xFB], tipFg: [0x1E, 0x3A, 0x7A], white: [0xFF, 0xFF, 0xFF]
  };

  // ---- Text: WinAnsi-Kodierung ----

  const WIN = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
    0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
    0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
  };

  /** Unicode → WinAnsi als Binärstring (Zeichencodes < 256). Unbekanntes wird zu „?“. */
  function winAnsi(str) {
    let out = '';
    for (const ch of String(str).normalize('NFC')) {
      const c = ch.codePointAt(0);
      if (c === 0x09) out += ' ';
      else if ((c >= 0x20 && c < 0x7F) || (c >= 0xA0 && c <= 0xFF)) out += String.fromCharCode(c);
      else if (WIN[c]) out += String.fromCharCode(WIN[c]);
      else if (c === 0x202F || c === 0x2009 || c === 0x00A0) out += ' ';
      else out += '?';
    }
    return out;
  }

  function pdfString(bin) {
    return '(' + bin.replace(/[\\()]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n') + ')';
  }

  // Breitenmessung über Canvas mit Helvetica-kompatibler Schrift (Arial/Liberation Sans sind metrisch gleich).
  const mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  function width(text, size, bold) {
    if (!mctx) return text.length * size * 0.55;
    mctx.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, "Liberation Sans", sans-serif`;
    return (mctx.measureText(text).width / 100) * size * 1.02;
  }

  /** Bricht Text auf die Breite um (Absätze bleiben erhalten). */
  function wrap(text, size, bold, maxW) {
    const lines = [];
    for (const para of String(text).replace(/\r/g, '').split('\n')) {
      const words = para.split(/ +/);
      let line = '';
      for (let w of words) {
        // Überlange Wörter hart trennen
        while (width(w, size, bold) > maxW) {
          let i = w.length;
          while (i > 1 && width(w.slice(0, i), size, bold) > maxW) i--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, i));
          w = w.slice(i);
        }
        const cand = line ? line + ' ' + w : w;
        if (width(cand, size, bold) <= maxW) line = cand;
        else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines;
  }

  const rgb = (c) => `${(c[0] / 255).toFixed(3)} ${(c[1] / 255).toFixed(3)} ${(c[2] / 255).toFixed(3)}`;
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  // ---- Seitenaufbau ----

  class Layout {
    constructor() {
      this.pages = [];
      this.images = []; // { bytes, w, h }
      this.newPage();
    }

    newPage() {
      this.ops = [];
      this.pages.push({ ops: this.ops, images: new Set() });
      this.y = M;
    }

    room() { return PAGE_H - FOOT - M + 10 - this.y; }

    ensure(h) { if (h > this.room() && this.y > M) this.newPage(); }

    text(str, x, y, size, bold, color) {
      this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${rgb(color)} rg 1 0 0 1 ${n2(x)} ${n2(PAGE_H - y)} Tm ${pdfString(winAnsi(str))} Tj ET`);
    }

    /** Textblock ab aktueller Position, liefert Höhe. */
    para(str, size, bold, color, { x = M, w = CW, lead = 1.4, draw = true } = {}) {
      const lines = wrap(str, size, bold, w);
      const lh = size * lead;
      if (draw) {
        lines.forEach((l, i) => {
          if (this.y + lh > PAGE_H - FOOT - M + 10) this.newPage();
          this.text(l, x, this.y + size, size, bold, color);
          this.y += lh;
          void i;
        });
      }
      return lines.length * lh;
    }

    rect(x, y, w, h, fill, stroke) {
      const parts = [];
      if (fill) parts.push(`${rgb(fill)} rg`);
      if (stroke) parts.push(`${rgb(stroke)} RG 0.75 w`);
      parts.push(`${n2(x)} ${n2(PAGE_H - y - h)} ${n2(w)} ${n2(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
      this.ops.push(parts.join(' '));
    }

    circle(cx, cy, r, fill) {
      const k = 0.5523 * r;
      const Y = PAGE_H - cy;
      this.ops.push(`${rgb(fill)} rg ${n2(cx + r)} ${n2(Y)} m ` +
        `${n2(cx + r)} ${n2(Y + k)} ${n2(cx + k)} ${n2(Y + r)} ${n2(cx)} ${n2(Y + r)} c ` +
        `${n2(cx - k)} ${n2(Y + r)} ${n2(cx - r)} ${n2(Y + k)} ${n2(cx - r)} ${n2(Y)} c ` +
        `${n2(cx - r)} ${n2(Y - k)} ${n2(cx - k)} ${n2(Y - r)} ${n2(cx)} ${n2(Y - r)} c ` +
        `${n2(cx + k)} ${n2(Y - r)} ${n2(cx + r)} ${n2(Y - k)} ${n2(cx + r)} ${n2(Y)} c f`);
    }

    image(img, x, y, w, h) {
      let idx = this.images.indexOf(img);
      if (idx < 0) { this.images.push(img); idx = this.images.length - 1; }
      this.pages[this.pages.length - 1].images.add(idx);
      this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(PAGE_H - y - h)} cm /Im${idx} Do Q`);
    }
  }

  function fitImage(img, maxW, maxH) {
    // Nicht über 96 dpi hochskalieren (0,75 pt pro Pixel).
    const k = Math.min(maxW / img.w, maxH / img.h, 0.75);
    return { w: img.w * k, h: img.h * k };
  }

  /**
   * doc: { title, meta, intro, footer, cover: { logo }|null,
   *        items: [{ type: 'step'|'section', n, text, note, img: { bytes, w, h }|null }] }
   */
  function layout(doc) {
    const L = new Layout();

    if (doc.cover) {
      L.y = 220;
      if (doc.cover.logo) {
        const s = fitImage(doc.cover.logo, 200, 80);
        L.image(doc.cover.logo, M, L.y, s.w, s.h);
        L.y += s.h + 36;
      }
      L.para(doc.title, 30, true, C.fg, { lead: 1.2 });
      L.y += 10;
      L.para(doc.meta, 11, false, C.muted);
      L.newPage();
    }

    if (!doc.cover) {
      L.para(doc.title, 24, true, C.fg, { lead: 1.2 });
      L.y += 4;
      L.para(doc.meta, 9.5, false, C.muted);
    }
    if (doc.intro) {
      L.y += 10;
      L.para(doc.intro, 11, false, C.fg2, { lead: 1.5 });
    }
    L.y += 18;

    for (const it of doc.items) {
      if (it.type === 'section') {
        const h = L.para(it.text, 17, true, C.fg, { draw: false }) + (it.note ? L.para(it.note, 11, false, C.fg2, { draw: false }) : 0) + 30;
        // Nicht allein am Seitenende: Platz für den Anfang des nächsten Schritts mit einplanen.
        L.ensure(Math.min(h, 160) + 220);
        L.y += 8;
        L.ops.push(`${rgb(C.line)} RG 0.75 w ${n2(M)} ${n2(PAGE_H - L.y)} m ${n2(M + CW)} ${n2(PAGE_H - L.y)} l S`);
        L.y += 14;
        L.para(it.text, 17, true, C.fg, { lead: 1.25 });
        if (it.note) { L.y += 4; L.para(it.note, 11, false, C.fg2, { lead: 1.5 }); }
        L.y += 14;
        continue;
      }

      const headW = CW - 34;
      const headH = Math.max(24, L.para(it.text, 13, true, C.fg, { w: headW, lead: 1.35, draw: false }));
      const maxImgH = PAGE_H - FOOT - 2 * M - headH - 30;
      const im = it.img ? fitImage(it.img, CW, Math.min(maxImgH, 520)) : null;
      const noteH = it.note ? L.para(it.note, 10.5, false, C.tipFg, { w: CW - 20, lead: 1.45, draw: false }) + 16 : 0;
      // Überschrift und Bild immer zusammen.
      L.ensure(headH + (im ? im.h + 10 : 0) + Math.min(noteH, 60));

      const top = L.y;
      L.circle(M + 12, top + 12, 12, C.fg);
      const num = String(it.n);
      L.text(num, M + 12 - width(num, 10.5, true) / 2, top + 12 + 3.8, 10.5, true, C.white);
      L.y = top + 12 - 13 * 1.35 / 2 + 1;
      L.para(it.text, 13, true, C.fg, { x: M + 34, w: headW, lead: 1.35 });
      L.y = Math.max(L.y, top + 24) + 10;

      if (im) {
        L.image(it.img, M, L.y, im.w, im.h);
        L.rect(M, L.y, im.w, im.h, null, C.line);
        L.y += im.h + 10;
      }
      if (it.note) {
        L.ensure(noteH);
        const lines = wrap(it.note, 10.5, false, CW - 20);
        let i = 0;
        while (i < lines.length) {
          // Hinweisbox, bei Bedarf über Seiten verteilt
          const lh = 10.5 * 1.45;
          const fit = Math.max(1, Math.floor((L.room() - 16) / lh));
          const chunk = lines.slice(i, i + fit);
          const h = chunk.length * lh + 16;
          L.rect(M, L.y, CW, h, C.tipBg, null);
          chunk.forEach((l, j) => L.text(l, M + 10, L.y + 8 + 10.5 + j * lh, 10.5, false, C.tipFg));
          L.y += h;
          i += chunk.length;
          if (i < lines.length) L.newPage();
        }
        L.y += 6;
      }
      L.y += 22;
    }

    // Fußzeile mit Seitenzahlen
    const total = L.pages.length;
    L.pages.forEach((p, i) => {
      const y = PAGE_H - 28;
      const label = `Seite ${i + 1} von ${total}`;
      p.ops.push(`BT /F1 8.5 Tf ${rgb(C.muted)} rg 1 0 0 1 ${n2(PAGE_W - M - width(label, 8.5))} ${n2(PAGE_H - y)} Tm ${pdfString(winAnsi(label))} Tj ET`);
      if (doc.footer) {
        const f = wrap(doc.footer, 8.5, false, CW - 90)[0] || '';
        p.ops.push(`BT /F1 8.5 Tf ${rgb(C.muted)} rg 1 0 0 1 ${n2(M)} ${n2(PAGE_H - y)} Tm ${pdfString(winAnsi(f))} Tj ET`);
      }
    });
    return L;
  }

  // ---- Datei schreiben ----

  const latin1 = (s) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  };

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }

  function utf16Hex(str) {
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return `<${hex}>`;
  }

  async function build(doc) {
    const L = layout(doc);
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (b) => { chunks.push(b); pos += b.length; };
    const objs = [];
    const add = (fn) => { objs.push(fn); return objs.length; };

    // Objektnummern vergeben
    const catalogId = add(null);
    const pagesId = add(null);
    const f1 = add(null);
    const f2 = add(null);
    const infoId = add(null);
    const imgIds = L.images.map(() => add(null));
    const pageIds = [];
    const contentIds = [];
    L.pages.forEach(() => { pageIds.push(add(null)); contentIds.push(add(null)); });

    const bodies = new Map();
    bodies.set(catalogId, latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
    bodies.set(pagesId, latin1(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`));
    bodies.set(f1, latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    bodies.set(f2, latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    bodies.set(infoId, latin1(`<< /Title ${utf16Hex(String(doc.title).slice(0, 200))} /Producer (Workflow Recorder) >>`));

    L.images.forEach((img, i) => {
      const head = latin1(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      bodies.set(imgIds[i], [head, img.bytes, latin1('\nendstream')]);
    });

    for (let i = 0; i < L.pages.length; i++) {
      const p = L.pages[i];
      const raw = latin1(p.ops.join('\n'));
      const z = await deflate(raw);
      const data = z || raw;
      bodies.set(contentIds[i], [latin1(`<< /Length ${data.length}${z ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), data, latin1('\nendstream')]);
      const xo = Array.from(p.images).map((k) => `/Im${k} ${imgIds[k]} 0 R`).join(' ');
      bodies.set(pageIds[i], latin1(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${contentIds[i]} 0 R >>`));
    }

    push(latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    for (let id = 1; id <= objs.length; id++) {
      offsets[id] = pos;
      push(latin1(`${id} 0 obj\n`));
      const b = bodies.get(id);
      for (const part of Array.isArray(b) ? b : [b]) push(part);
      push(latin1('\nendobj\n'));
    }
    const xref = pos;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= objs.length; id++) x += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    push(latin1(x));
    return new Blob(chunks, { type: 'application/pdf' });
  }

  return { build, winAnsi, wrap };
})();

if (typeof module !== 'undefined') module.exports = Pdf;
