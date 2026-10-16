/* Exporte: HTML, PDF (über die Druckansicht), Odoo-Zwischenablage, Markdown-ZIP, Projektsicherung.
   Alle Texte werden escaped. Bilder entstehen immer neu aus dem gespeicherten (bereits geschwärzten) Bild,
   Klickmarker und Pfeile werden dabei fest eingezeichnet. */
'use strict';

// eslint-disable-next-line no-unused-vars
var Exporter = (() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const esc = U.escapeHtml;

  async function load(guideId) {
    const guide = await DB.getGuide(guideId);
    if (!guide) throw new Error('Anleitung nicht gefunden');
    const steps = await DB.getSteps(guideId);
    return { guide, steps };
  }

  /** Nummeriert die Schritte (Abschnitte zählen nicht mit). */
  function number(steps) {
    let n = 0;
    return steps.map((s) => (s.type === 'section' ? { ...s, n: 0 } : { ...s, n: ++n }));
  }

  function stepCount(steps) {
    return steps.filter((s) => s.type !== 'section').length;
  }

  function minutes(n) {
    return Math.max(1, Math.ceil((n * 15) / 60));
  }

  function anchor(s, i) {
    return s.type === 'section' ? `abschnitt-${i + 1}` : `schritt-${s.n}`;
  }

  /**
   * Erzeugt Bilder für alle Schritte.
   * as: 'dataurl' | 'objecturl'
   */
  async function renderImages(steps, opts, as, onProgress) {
    const out = new Map();
    let done = 0;
    for (const s of steps) {
      if (s.type === 'section' || !s.image) continue;
      const r = await Render.renderStep(s, opts);
      const src = as === 'objecturl' ? URL.createObjectURL(r.blob) : as === 'dataurl' ? await U.blobToDataUrl(r.blob) : null;
      out.set(s.id, { src, width: r.width, height: r.height, bytes: r.blob.size, blob: r.blob });
      if (onProgress) onProgress(++done);
    }
    return out;
  }

  /**
   * HTML-Gerüst der Anleitung (nur der Inhalt von <body>).
   * imgs: Map stepId -> { src, width, height }, logoSrc: string|null
   */
  function guideBody(guide, steps, imgs, { logoSrc = null, cover = false, footer = '' } = {}) {
    const numbered = number(steps);
    const count = stepCount(steps);
    const meta = `<div class="g-meta"><span>${esc(U.stepsLabel(count))}</span><span>ca. ${minutes(count)} ${minutes(count) === 1 ? 'Minute' : 'Minuten'}</span><span>Stand: ${esc(U.dateDE(guide.updatedAt || Date.now()))}</span></div>`;
    const showLogo = cover && logoSrc;
    const toc = numbered.map((s, i) => (s.type === 'section'
      ? `<a class="sec" href="#${anchor(s, i)}">${esc(s.text)}</a>`
      : `<a href="#${anchor(s, i)}"><span class="n">${U.pad2(s.n)}</span><span>${esc(s.text)}</span></a>`)).join('');

    const body = numbered.map((s, i) => {
      if (s.type === 'section') {
        return `<section class="g-sec" id="${anchor(s, i)}"><h2>${esc(s.text)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ''}</section>`;
      }
      const img = imgs.get(s.id);
      const imgHtml = img
        ? `<div class="g-img"><img src="${esc(img.src)}" width="${img.width}" height="${img.height}" alt="Screenshot zu Schritt ${s.n}"></div>`
        : '';
      return `<section class="g-step" id="${anchor(s, i)}"><div class="g-step-h"><span class="g-num">${s.n}</span><h2>${esc(s.text)}</h2></div>${imgHtml}${s.note ? `<p class="g-tip">${esc(s.note)}</p>` : ''}</section>`;
    }).join('');

    return `<div class="${showLogo ? 'has-cover' : ''}">` +
      (showLogo ? `<section class="g-cover"><img src="${esc(logoSrc)}" alt="Logo"><h1>${esc(guide.title)}</h1>${meta}</section>` : '') +
      `<header class="g-top"><div class="g-top-in"><div class="g-logo">${showLogo ? `<img src="${esc(logoSrc)}" alt="Logo">` : ''}</div>` +
      '<button id="g-print" class="g-print" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"></path></svg>Drucken</button></div></header>' +
      '<div class="g-main">' +
      `<nav class="g-toc" aria-label="Inhalt"><span class="g-toc-h">Schritte</span>${toc}</nav>` +
      '<article class="g-art">' +
      `<div class="g-head"><h1>${esc(guide.title)}</h1>${meta}${guide.intro ? `<p class="g-intro">${esc(guide.intro)}</p>` : ''}</div>` +
      body +
      (footer ? `<footer class="g-foot">${esc(footer)}</footer>` : '') +
      '</article></div></div>';
  }

  async function sha256b64(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    let bin = '';
    for (const b of new Uint8Array(d)) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  async function guideCss() {
    const r = await fetch(api.runtime.getURL('src/export/guide.css'));
    return r.text();
  }

  async function logoDataUrl(guide) {
    return guide.logo ? U.blobToDataUrl(guide.logo) : null;
  }

  // ---------- HTML ----------

  async function html(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const settings = await Settings.get();
    const imgs = await renderImages(steps, { marker: opts.marker, crop: opts.crop, type: 'image/png' }, 'dataurl', onProgress);
    const css = await guideCss();
    const js = "document.getElementById('g-print').addEventListener('click',function(){window.print()});";
    const csp = `default-src 'none'; img-src data:; style-src 'sha256-${await sha256b64(css)}'; script-src 'sha256-${await sha256b64(js)}'; base-uri 'none'; form-action 'none'`;
    const doc = '<!doctype html>\n<html lang="de"><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">` +
      '<meta name="referrer" content="no-referrer">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<title>${esc(guide.title)}</title><style>${css}</style></head><body>` +
      guideBody(guide, steps, imgs, { logoSrc: await logoDataUrl(guide), cover: opts.cover, footer: settings.footer }) +
      `<script>${js}</script></body></html>\n`;
    return new Blob([doc], { type: 'text/html;charset=utf-8' });
  }

  // ---------- PDF ----------

  async function pdf(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const settings = await Settings.get();
    const imgs = await renderImages(steps, { marker: opts.marker, crop: opts.crop, maxWidth: 1600, type: 'image/jpeg', quality: 0.88 }, 'blob', onProgress);
    const bytes = async (b) => new Uint8Array(await b.arrayBuffer());
    const items = [];
    for (const s of number(steps)) {
      if (s.type === 'section') { items.push({ type: 'section', text: s.text || '', note: s.note || '' }); continue; }
      const im = imgs.get(s.id);
      // Nur echtes JPEG einbetten (DCTDecode); sonst ohne Bild statt kaputter Datei.
      const img = im && im.blob.type === 'image/jpeg' ? { bytes: await bytes(im.blob), w: im.width, h: im.height } : null;
      items.push({ type: 'step', n: s.n, text: s.text || '', note: s.note || '', img });
    }
    let cover = null;
    if (opts.cover && guide.logo) {
      const l = await Render.toJpeg(guide.logo, { maxWidth: 800 });
      cover = { logo: { bytes: await bytes(l.blob), w: l.width, h: l.height } };
    }
    const count = stepCount(steps);
    return Pdf.build({
      title: guide.title || 'Anleitung',
      meta: `${U.stepsLabel(count)}   ·   ca. ${minutes(count)} ${minutes(count) === 1 ? 'Minute' : 'Minuten'}   ·   Stand: ${U.dateDE(guide.updatedAt || Date.now())}`,
      intro: guide.intro || '',
      footer: settings.footer,
      cover,
      items
    });
  }

  // ---------- Odoo Wissen ----------

  const ODOO_IMG = { maxWidth: 1000, type: 'image/webp', quality: 0.85 };

  async function odoo(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const imgs = await renderImages(steps, { ...ODOO_IMG, crop: opts.crop, marker: opts.marker }, 'dataurl', onProgress);
    const numbered = number(steps);
    let h = `<h2>${esc(guide.title)}</h2>`;
    let t = `${guide.title}\n\n`;
    if (guide.intro) {
      h += `<p>${esc(guide.intro)}</p>`;
      t += `${guide.intro}\n\n`;
    }
    let open = false;
    for (const s of numbered) {
      if (s.type === 'section') {
        if (open) { h += '</ol>'; open = false; }
        h += `<h3>${esc(s.text)}</h3>${s.note ? `<p>${esc(s.note)}</p>` : ''}`;
        t += `\n${s.text}\n${s.note ? s.note + '\n' : ''}\n`;
        continue;
      }
      if (!open) { h += `<ol start="${s.n}">`; open = true; }
      const img = imgs.get(s.id);
      h += `<li><p><strong>${esc(s.text)}</strong></p>`;
      // Keine feste Breite: die Spalte in Odoo Wissen ist oft schmaler und schneidet das Bild sonst ab.
      // img-fluid ist Odoos eigene Klasse für mitskalierende Bilder, der Stil greift auch ohne sie.
      if (img) h += `<p><img class="img-fluid" style="width: 100%; max-width: 100%; height: auto;" src="${esc(img.src)}" alt="Schritt ${s.n}"></p>`;
      if (s.note) h += `<blockquote><p>${esc(s.note)}</p></blockquote>`;
      h += '</li>';
      t += `${s.n}. ${s.text}\n${s.note ? `   Hinweis: ${s.note}\n` : ''}`;
    }
    if (open) h += '</ol>';
    const bytes = new TextEncoder().encode(h).length;
    return { html: h, text: t.trim() + '\n', bytes };
  }

  // ---------- Testcheckliste ----------

  // Kleine Bilder: in der Checkliste nur zur Orientierung. Ohne feste Breite eingefügt (siehe oben),
  // die natürliche Breite bleibt so unter der Artikelspalte.
  const CHECK_IMG = { maxWidth: 480, type: 'image/webp', quality: 0.85 };
  const HOWTO = 'Führe die Punkte der Reihe nach aus. Stimmt das Ergebnis, setze den Haken. ' +
    'Stimmt es nicht, lass den Haken weg und beschreibe unter „Bemerkung“, was passiert ist.';
  const SIGN_OFF = 'Alle Punkte erfüllt, der Ablauf ist freigegeben.';

  /** Zeilen des Kopfs: leere Angaben bleiben weg, Namensfelder zum Ausfüllen immer. */
  function checkHead(guide) {
    const t = guide.test || {};
    return [
      ['Getestet von', ''],
      ['Datum', ''],
      ['Ziel', guide.intro || ''],
      ['Vorbedingungen', t.pre || ''],
      ['Testdaten', t.data || '']
    ].filter(([k, v], i) => i < 2 || v.trim());
  }

  const escLines = (v) => esc(v).replace(/\r?\n/g, '<br>');

  /** Odoo Wissen: Odoo-Checklisten (ul.o_checklist), die der Kunde im Artikel abhakt. */
  async function odooChecklist(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const imgs = opts.images === false
      ? new Map()
      : await renderImages(steps, { ...CHECK_IMG, crop: opts.crop, marker: opts.marker }, 'dataurl', onProgress);
    let h = `<h2>${esc(guide.title)}</h2><p><strong>So testest du:</strong> ${esc(HOWTO)}</p>`;
    let t = `${guide.title}\n\n${HOWTO}\n\n`;
    // Leere Zellen brauchen einen Absatz, sonst lässt Odoo nicht hineinschreiben.
    h += '<table class="table table-bordered"><tbody>' + checkHead(guide).map(([k, v]) =>
      `<tr><td><strong>${esc(k)}</strong></td><td>${v ? `<p>${escLines(v)}</p>` : '<p><br></p>'}</td></tr>`).join('') + '</tbody></table>';
    t += checkHead(guide).map(([k, v]) => `${k}: ${v.replace(/\s*\n\s*/g, ', ') || '________'}`).join('\n') + '\n';

    let open = false;
    const close = () => { if (open) { h += '</ul>'; open = false; } };
    for (const s of number(steps)) {
      if (s.type === 'section') {
        close();
        h += `<h3>${esc(s.text)}</h3>${s.note ? `<p>${escLines(s.note)}</p>` : ''}`;
        t += `\n${s.text}\n${s.note ? s.note + '\n' : ''}`;
        continue;
      }
      if (!open) { h += '<ul class="o_checklist">'; open = true; }
      const img = imgs.get(s.id);
      // Inhalt bewusst als Zeilen in einem Listenpunkt: Odoo behält so einen Haken pro Prüfpunkt.
      h += `<li><strong>${s.n}. ${esc(s.text)}</strong>`;
      if (s.expected) h += `<br>Erwartet: ${escLines(s.expected)}`;
      if (s.note) h += `<br><em>Hinweis: ${escLines(s.note)}</em>`;
      if (img) h += `<br><img class="img-fluid" src="${esc(img.src)}" alt="Prüfpunkt ${s.n}">`;
      h += '<br>Bemerkung: </li>';
      t += `[ ] ${s.n}. ${s.text}\n${s.expected ? `    Erwartet: ${s.expected}\n` : ''}${s.note ? `    Hinweis: ${s.note}\n` : ''}    Bemerkung:\n`;
    }
    close();
    h += `<h3>Abnahme</h3><ul class="o_checklist"><li>${esc(SIGN_OFF)}</li></ul><p>Name, Datum: </p>`;
    t += `\nAbnahme\n[ ] ${SIGN_OFF}\nName, Datum:\n`;
    const bytes = new TextEncoder().encode(h).length;
    return { html: h, text: t, bytes };
  }

  async function markdownChecklist(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const imgs = opts.images === false
      ? new Map()
      : await renderImages(steps, { maxWidth: 800, crop: opts.crop, marker: opts.marker, type: 'image/png' }, 'blob', onProgress);
    const files = [];
    let md = `# ${mdEscape(guide.title)}\n\n${mdEscape(HOWTO)}\n\n`;
    md += checkHead(guide).map(([k, v]) => `**${mdEscape(k)}:** ${v ? mdBlock(v) : '________'}`).join('  \n') + '\n\n';
    for (const s of number(steps)) {
      if (s.type === 'section') {
        md += `## ${mdEscape(s.text)}\n\n${s.note ? mdBlock(s.note) + '\n\n' : ''}`;
        continue;
      }
      md += `- [ ] **${s.n}. ${mdEscape(s.text)}**  \n`;
      if (s.expected) md += `  Erwartet: ${mdBlock(s.expected).split('\n').join('\n  ')}  \n`;
      if (s.note) md += `  *Hinweis: ${mdBlock(s.note).split('\n').join('\n  ')}*  \n`;
      const img = imgs.get(s.id);
      if (img) {
        const name = `bilder/pruefpunkt-${String(s.n).padStart(2, '0')}.png`;
        files.push({ name, data: img.blob });
        md += `  ![Prüfpunkt ${s.n}](${name})  \n`;
      }
      md += '  Bemerkung:\n\n';
    }
    md += `## Abnahme\n\n- [ ] ${mdEscape(SIGN_OFF)}\n\nName, Datum: ________\n`;
    files.unshift({ name: 'checkliste.md', data: md, compress: true });
    return Zip.create(files);
  }

  /** Kopiert HTML + Text. Fallback: Inhalt markieren und execCommand('copy'). */
  async function copyToClipboard(htmlStr, text) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([htmlStr], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
        return true;
      }
    } catch (_) { /* Fallback unten */ }
    const holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    Object.assign(holder.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px' });
    // Nur eigenes, vollständig escaptes HTML. DOMParser führt keine Skripte aus.
    const parsed = new DOMParser().parseFromString(htmlStr, 'text/html');
    holder.append(...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true)));
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    sel.removeAllRanges();
    holder.remove();
    return ok;
  }

  // ---------- Markdown ----------

  function mdEscape(s) {
    return String(s ?? '').replace(/[\\`*_[\]<>|#]/g, '\\$&').replace(/^([-+]|\d+\.)\s/, (m) => '\\' + m);
  }

  function mdBlock(s) {
    return String(s ?? '').split('\n').map(mdEscape).join('  \n');
  }

  async function markdown(guideId, opts, onProgress) {
    const { guide, steps } = await load(guideId);
    const imgs = await renderImages(steps, { marker: opts.marker, crop: opts.crop, type: 'image/png' }, 'blob', onProgress);
    const numbered = number(steps);
    const files = [];
    let md = `# ${mdEscape(guide.title)}\n\n`;
    if (guide.intro) md += `${mdBlock(guide.intro)}\n\n`;
    for (const s of numbered) {
      if (s.type === 'section') {
        md += `## ${mdEscape(s.text)}\n\n${s.note ? mdBlock(s.note) + '\n\n' : ''}`;
        continue;
      }
      md += `### ${s.n}. ${mdEscape(s.text)}\n\n`;
      const img = imgs.get(s.id);
      if (img) {
        const name = `bilder/schritt-${String(s.n).padStart(2, '0')}.png`;
        files.push({ name, data: img.blob });
        md += `![Schritt ${s.n}](${name})\n\n`;
      }
      if (s.note) md += `> ${mdBlock(s.note).split('\n').join('\n> ')}\n\n`;
    }
    files.unshift({ name: 'anleitung.md', data: md, compress: true });
    return Zip.create(files);
  }

  // ---------- Projektsicherung ----------

  async function backup(guideId) {
    const { guide, steps } = await load(guideId);
    const man = Project.manifest(guide, steps);
    const files = [{ name: Project.MANIFEST, data: JSON.stringify(man, null, 2), compress: true }];
    let i = 0;
    for (const s of steps) {
      if (s.type === 'section') continue;
      const entry = man.steps.filter((x) => x.type !== 'section')[i++];
      // Auch die Sicherung enthält nie ungeschwärzte Originale: Schwärzungen werden eingerechnet.
      const data = (s.redactions || []).length
        ? (await Render.renderStep(s, { marker: false, annotations: false, type: 'image/png' })).blob
        : s.image;
      files.push({ name: entry.image, data });
    }
    if (guide.logo) files.push({ name: 'logo.png', data: guide.logo });
    return Zip.create(files);
  }

  const MAX_MANIFEST = 10 * 1024 * 1024;

  async function decodeImage(bytes) {
    // Neu kodieren: nur Pixel werden übernommen, nichts anderes aus der Datei.
    const r = await Render.reencode(new Blob([bytes]), { type: 'image/png' });
    return r;
  }

  /** Liest eine Projektsicherung ein und legt eine neue Anleitung an. Liefert die neue ID. */
  async function importProject(file, onProgress) {
    if (!(file instanceof Blob)) throw new Error('Keine Datei');
    const entries = await Zip.read(file);
    const manEntry = entries.get(Project.MANIFEST);
    if (!manEntry) throw new Error('Keine Projektsicherung des Workflow Recorders');
    if (manEntry.size > MAX_MANIFEST) throw new Error('Projektbeschreibung ist zu groß');
    let raw;
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await manEntry.read()));
    } catch (_) {
      throw new Error('Projektbeschreibung ist beschädigt');
    }
    const { guide: g, steps } = Project.validate(raw);

    // Erst alles prüfen und dekodieren, dann speichern: keine halben Importe.
    const prepared = [];
    let done = 0;
    for (const s of steps) {
      if (s.type === 'section') { prepared.push(s); continue; }
      const e = entries.get(s.image);
      if (!e) throw new Error(`Bild fehlt: ${s.image}`);
      let img;
      try { img = await decodeImage(await e.read()); } catch (_) { throw new Error(`Bild ist ungültig: ${s.image}`); }
      // Maße aus dem echten Bild, Verhältnis zum Viewport beibehalten.
      const kx = img.width / s.imgW;
      const ky = img.height / s.imgH;
      const annotations = s.annotations.map((a) => (a.type !== 'arrow'
        ? { ...a, x: a.x * kx, y: a.y * ky, ...(a.w != null ? { w: a.w * kx, h: a.h * ky } : {}) }
        : { ...a, x1: a.x1 * kx, y1: a.y1 * ky, x2: a.x2 * kx, y2: a.y2 * ky }));
      const redactions = s.redactions.map((q) => ({ ...q, x: q.x * kx, y: q.y * ky, w: q.w * kx, h: q.h * ky }));
      prepared.push({ ...s, image: img.blob, imgW: img.width, imgH: img.height, annotations, redactions });
      if (onProgress) onProgress(++done);
    }
    let logo = null;
    if (g.logo && entries.has('logo.png')) {
      try {
        logo = (await Render.reencode(new Blob([await entries.get('logo.png').read()]), { maxWidth: 800 })).blob;
      } catch (_) { logo = null; }
    }

    const guide = await DB.addGuide({
      title: g.title, intro: g.intro, logo,
      ...(g.kind === 'checklist' ? { kind: 'checklist', test: g.test } : {})
    });
    try {
      let order = 0;
      for (const s of prepared) {
        await DB.addStep({ ...s, guideId: guide.id, order: ++order, type: s.type });
      }
    } catch (e) {
      await DB.deleteGuide(guide.id).catch(() => {});
      throw e;
    }
    return guide.id;
  }

  return {
    load, number, stepCount, minutes, renderImages, guideBody, html, pdf, odoo, copyToClipboard, markdown, backup, importProject, mdEscape,
    odooChecklist, markdownChecklist
  };
})();
