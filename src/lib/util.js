/* Hilfsfunktionen für Erweiterungsseiten. DOM wird nur über createElement/textContent aufgebaut,
   nie über innerHTML mit Daten. */
'use strict';

// eslint-disable-next-line no-unused-vars
var U = (() => {
  const api = globalThis.browser ?? globalThis.chrome;

  /** el('div', {class: 'x', onclick: fn, dataset: {...}}, ...kinder) */
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') Object.assign(n.style, v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return n;
  }

  /** SVG-Icon aus festen Pfaddaten (keine Fremddaten). */
  function icon(paths, { size = 15, fill = false, stroke = 2 } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', fill ? 'currentColor' : 'none');
    if (!fill) {
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', String(stroke));
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
    }
    for (const d of [].concat(paths)) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function relDay(ts) {
    const d = new Date(ts);
    const today = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(today) - start(d)) / 86400000);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'gestern';
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function relTime(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'gerade eben';
    const m = Math.round(s / 60);
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 24) return `vor ${h} Std.`;
    return `am ${relDay(ts)}`;
  }

  function dateDE(ts) {
    const d = new Date(ts);
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function stepsLabel(n) {
    return n === 1 ? '1 Schritt' : `${n} Schritte`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Dateiname ohne Pfadteile, Steuerzeichen und reservierte Zeichen. */
  function safeFilename(s, fallback = 'anleitung') {
    let t = String(s || '').normalize('NFC')
      .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
    if (!t || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = fallback;
    return t;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  let toastTimer = 0;
  function toast(msg, { error = false, ms = 3200 } = {}) {
    let t = document.getElementById('toast');
    if (!t) {
      t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(t);
    }
    t.className = 'toast' + (error ? ' error' : '');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function send(msg) {
    return api.runtime.sendMessage(msg);
  }

  /** Liest eine positive Ganzzahl aus der URL, sonst null. */
  function intParam(name) {
    const v = new URLSearchParams(location.search).get(name);
    if (v == null || !/^\d{1,12}$/.test(v)) return null;
    const n = Number(v);
    return n > 0 ? n : null;
  }

  function isMac() {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  }

  return { api, el, icon, relDay, relTime, dateDE, stepsLabel, escapeHtml, safeFilename, blobToDataUrl, download, toast, send, intParam, isMac, pad2 };
})();
