/* Übersicht (editor.html) und Editor (editor.html?guide=<id>). */
'use strict';

// eslint-disable-next-line no-unused-vars
var Editor = (() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  const guideId = U.intParam('guide');

  // ======================= Übersicht =======================

  let ovUrls = [];

  async function renderOverview() {
    document.title = 'Anleitungen – Workflow Recorder';
    $('overview').hidden = false;
    ovUrls.forEach((u) => URL.revokeObjectURL(u));
    ovUrls = [];
    const guides = await DB.listGuides();
    $('ov-meta').textContent = guides.length === 1 ? '1 Anleitung, lokal gespeichert' : `${guides.length} Anleitungen, lokal gespeichert`;
    const list = $('ov-list');
    if (!guides.length) {
      list.replaceChildren(el('div', { class: 'ov-empty' },
        'Noch keine Anleitungen.', el('br'),
        'Öffne die Seite, die du erklären möchtest, und starte die Aufnahme über das Symbol der Erweiterung oder mit dem Kurzbefehl.'));
      return;
    }
    const items = [];
    for (const g of guides) {
      const steps = await DB.getSteps(g.id);
      const thumb = U.thumb(steps.find((s) => s.image), 'ov-thumb', ovUrls, { marker: false });
      const href = `editor.html?guide=${g.id}`;
      items.push(el('div', { class: 'ov-item' },
        thumb,
        el('div', { class: 'ov-text' },
          el('a', { class: 'ov-title', href, text: g.title || 'Ohne Titel' }),
          el('span', { class: 'ov-meta', text: `${U.stepsLabel(g.stepCount)} · geändert ${U.relDay(g.updatedAt)}${g.lastExport ? ` · zuletzt als ${g.lastExport} exportiert` : ' · Entwurf'}` })),
        el('div', { class: 'ov-actions' },
          el('a', { class: 'btn', href, text: 'Öffnen' }),
          el('button', {
            class: 'btn btn-danger', type: 'button', text: 'Löschen',
            onclick: async () => {
              if (!confirm(`„${g.title}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
              await DB.deleteGuide(g.id);
              U.toast('Anleitung gelöscht');
              renderOverview();
            }
          }))));
    }
    list.replaceChildren(...items);
  }

  async function importFile(file) {
    if (!file) return;
    U.toast('Projekt wird geprüft …', { ms: 60000 });
    try {
      const id = await Exporter.importProject(file);
      location.href = `editor.html?guide=${id}`;
    } catch (e) {
      U.toast('Import fehlgeschlagen: ' + (e && e.message ? e.message : e), { error: true, ms: 6000 });
    }
  }

  // ======================= Editor =======================

  const S = {
    guide: null,
    steps: [],
    sel: 0,
    tool: null,
    imgUrl: null,
    undo: new Map(), // stepId -> [Schnappschuss], nur im Speicher
    drag: null,
    pendingCrop: null,
    selAnno: -1, // ausgewählte Annotation (Pfeil, Text, Form)
    color: (() => {
      try {
        const c = localStorage.getItem('wfr-color');
        return Render.COLORS.some((x) => x.hex === c) ? c : Render.DEFAULT_COLOR;
      } catch (_) { return Render.DEFAULT_COLOR; }
    })()
  };

  const current = () => S.steps[S.sel] || null;

  function numbering() {
    let n = 0;
    return S.steps.map((s) => (s.type === 'section' ? 0 : ++n));
  }

  function stepCount() {
    return S.steps.filter((s) => s.type !== 'section').length;
  }

  // ---- Speichern ----

  const timers = new Map(); // key -> { t, fn }
  async function runSave(fn) {
    try {
      await fn();
      S.guide.updatedAt = Date.now();
      renderMeta();
    } catch (e) {
      U.toast('Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e), { error: true });
    }
  }

  function saveLater(key, fn, ms = 400) {
    const prev = timers.get(key);
    if (prev) clearTimeout(prev.t);
    const t = setTimeout(() => { timers.delete(key); runSave(fn); }, ms);
    timers.set(key, { t, fn });
  }

  /** Wartende Speichervorgänge sofort ausführen (vor Export, Vorschau oder Verlassen). */
  async function flushSaves() {
    const pending = Array.from(timers.values());
    timers.clear();
    for (const p of pending) {
      clearTimeout(p.t);
      await runSave(p.fn);
    }
  }

  async function saveGuide() {
    const g = await DB.getGuide(S.guide.id);
    if (!g) return;
    g.title = S.guide.title;
    g.intro = S.guide.intro;
    await DB.putGuide(g);
  }

  async function saveStep(step) {
    await DB.putStep(step);
  }

  function renderMeta() {
    $('ed-meta').textContent = `${U.stepsLabel(stepCount())} · gespeichert ${U.relTime(S.guide.updatedAt)}`;
  }

  // ---- Laden ----

  async function load() {
    $('editor').hidden = false;
    const guide = await DB.getGuide(guideId);
    if (!guide) {
      $('editor').hidden = true;
      U.toast('Diese Anleitung gibt es nicht mehr.', { error: true });
      return renderOverview();
    }
    S.guide = guide;
    S.steps = await DB.getSteps(guideId);
    document.title = `${guide.title} – Workflow Recorder`;
    $('ed-title').value = guide.title;
    $('ed-intro').value = guide.intro || '';
    renderMeta();
    setInterval(renderMeta, 30000);
    renderList();
    const want = U.intParam('step');
    const idx = want ? S.steps.findIndex((x) => x.id === want) : -1;
    select(idx >= 0 ? idx : 0);
  }

  // ---- Schrittliste ----

  function renderList() {
    const nums = numbering();
    const box = $('ed-steps');
    box.replaceChildren(...S.steps.map((s, i) => {
      const isSec = s.type === 'section';
      const flagged = !isSec && s.unredacted > 0 && !s.reviewed;
      return el('button', {
        class: 'step-btn' + (isSec ? ' section' : ''),
        type: 'button',
        role: 'option',
        'aria-selected': i === S.sel ? 'true' : 'false',
        dataset: { idx: String(i) },
        onclick: () => select(i)
      },
      el('span', { class: 'n', text: isSec ? '§' : U.pad2(nums[i]) }),
      el('span', { class: 't', text: s.text || (isSec ? 'Abschnitt' : 'Ohne Text') }),
      flagged ? el('span', { class: 'flag', title: 'Ungeschwärzte Eingabefelder prüfen', text: 'prüfen' }) : null);
    }));
    $('ed-empty').hidden = S.steps.length > 0;
    $('ed-card').hidden = S.steps.length === 0;
    $('ed-note-wrap').hidden = S.steps.length === 0;
  }

  function updateListItem(i) {
    const btn = $('ed-steps').querySelector(`[data-idx="${i}"] .t`);
    if (btn) btn.textContent = S.steps[i].text || (S.steps[i].type === 'section' ? 'Abschnitt' : 'Ohne Text');
  }

  function select(i) {
    if (!S.steps.length) return;
    S.sel = Math.max(0, Math.min(S.steps.length - 1, i));
    setTool(null);
    cancelCrop();
    S.selAnno = -1;
    $('ed-anno-bar').hidden = true;
    for (const b of $('ed-steps').children) {
      b.setAttribute('aria-selected', b.dataset.idx === String(S.sel) ? 'true' : 'false');
    }
    renderStep();
  }

  // ---- Schrittansicht ----

  function renderStep() {
    const s = current();
    if (!s) return;
    const isSec = s.type === 'section';
    const nums = numbering();
    const num = $('ed-num');
    num.textContent = isSec ? '§' : String(nums[S.sel]);
    num.classList.toggle('section', isSec);
    $('ed-text-label').textContent = isSec ? 'Überschrift des Abschnitts' : 'Schritttext';
    $('ed-text').value = s.text || '';
    $('ed-note-label').textContent = isSec ? 'Text des Abschnitts (optional)' : 'Hinweis zu diesem Schritt (optional)';
    $('ed-note').value = s.note || '';
    $('ed-toolbar').querySelectorAll('[data-tool]').forEach((b) => { b.hidden = isSec; });
    $('ed-undo').hidden = isSec;
    $('ed-stage').hidden = isSec || !s.image;
    $('ed-show-marker').parentElement.hidden = isSec;
    $('ed-show-marker').checked = s.showMarker !== false;
    $('ed-up').disabled = S.sel === 0;
    $('ed-down').disabled = S.sel === S.steps.length - 1;

    const flagged = !isSec && s.unredacted > 0 && !s.reviewed;
    $('ed-warn').hidden = !flagged;
    if (flagged) {
      $('ed-warn-text').textContent = s.navigated
        ? 'Während des Screenshots hat die Seite neu geladen. Die automatische Schwärzung ist hier nicht sicher, bitte prüfen.'
        : s.unredacted === 1
        ? 'Beim Aufnehmen war ein ausgefülltes Eingabefeld nicht geschwärzt. Bitte prüfen und bei Bedarf schwärzen.'
        : `Beim Aufnehmen waren ${s.unredacted} ausgefüllte Eingabefelder nicht geschwärzt. Bitte prüfen und bei Bedarf schwärzen.`;
    }
    updateUndo();

    if (S.imgUrl) URL.revokeObjectURL(S.imgUrl);
    S.imgUrl = null;
    if (!isSec && s.image) {
      S.imgUrl = URL.createObjectURL(s.image);
      $('ed-img').src = S.imgUrl;
      $('ed-img').alt = `Screenshot zu Schritt ${nums[S.sel]}`;
      drawOverlay();
    }
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  }

  /** Klickmarker, Schwärzungen, Annotationen und Auswahl als SVG in Bildpixeln. */
  function drawOverlay() {
    const s = current();
    const svg = $('ed-svg');
    if (!s || !s.image) { svg.replaceChildren(); return; }
    svg.setAttribute('viewBox', `0 0 ${s.imgW} ${s.imgH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const k = Render.scaleOf(s);
    const nodes = [];

    // Pfeilspitzen in jeder Farbe der Palette
    const defs = svgEl('defs', {});
    Render.COLORS.forEach((c, i) => {
      const m = svgEl('marker', { id: `ah${i}`, viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' });
      m.appendChild(svgEl('path', { d: 'M0 0L10 5L0 10z', fill: c.hex }));
      defs.appendChild(m);
    });
    nodes.push(defs);
    const markerFor = (hex) => `url(#ah${Math.max(0, Render.COLORS.findIndex((c) => c.hex === hex))})`;

    // Schwärzungen: im Editor als Flächen, im Schwärzungs-Modus anklickbar zum Entfernen.
    for (const q of s.redactions || []) {
      nodes.push(svgEl('rect', {
        x: q.x, y: q.y, width: q.w, height: q.h, rx: 3 * k, fill: '#1B1D1F',
        stroke: S.tool === 'redact' ? '#FF5A4E' : 'none', 'stroke-width': 2 * k,
        'stroke-dasharray': `${6 * k} ${4 * k}`
      }));
    }

    const list = (s.annotations || []).slice();
    if (S.drag && S.drag.mode === 'new') list.push(S.drag.anno);
    list.forEach((a) => nodes.push(...annoNodes(a, k, markerFor)));

    if (s.showMarker !== false) {
      const { cx, cy } = Render.markerPos(s);
      nodes.push(svgEl('circle', {
        cx, cy, r: 22 * k - 1.5 * k, fill: 'rgba(200,55,45,0.12)', stroke: Render.REC, 'stroke-width': 3 * k
      }));
    }

    // Auswahl mit Griffen
    const selA = selected();
    if (selA && ANNO_TOOLS.has(S.tool)) {
      const bb = annoBox(selA, k);
      nodes.push(svgEl('rect', {
        x: bb.x - 4 * k, y: bb.y - 4 * k, width: bb.w + 8 * k, height: bb.h + 8 * k, fill: 'none',
        stroke: '#2B59C3', 'stroke-width': 1.5 * k, 'stroke-dasharray': `${5 * k} ${3 * k}`
      }));
      for (const h of handles(selA)) {
        nodes.push(svgEl('rect', {
          x: h.x - 6 * k, y: h.y - 6 * k, width: 12 * k, height: 12 * k, rx: 2 * k,
          fill: '#FFFFFF', stroke: '#2B59C3', 'stroke-width': 2 * k
        }));
      }
    }

    const r = S.drag && S.drag.rect ? S.drag.rect : S.pendingCrop;
    if (r) {
      const rr = Render.clampRect(r, s.imgW, s.imgH);
      if (S.tool === 'redact') {
        nodes.push(svgEl('rect', { x: rr.x, y: rr.y, width: rr.w, height: rr.h, fill: '#1B1D1F', opacity: 0.85 }));
      } else {
        // Abdunkeln außerhalb des Zuschnitts
        nodes.push(svgEl('path', {
          d: `M0 0H${s.imgW}V${s.imgH}H0Z M${rr.x} ${rr.y}V${rr.y + rr.h}H${rr.x + rr.w}V${rr.y}Z`,
          fill: 'rgba(0,0,0,0.45)', 'fill-rule': 'evenodd'
        }));
        nodes.push(svgEl('rect', { x: rr.x, y: rr.y, width: rr.w, height: rr.h, fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2 * k, 'stroke-dasharray': `${6 * k} ${4 * k}` }));
      }
    }
    svg.replaceChildren(...nodes);
  }

  /** SVG-Knoten einer Annotation, optisch gleich wie im Export (Render). */
  function annoNodes(a, k, markerFor) {
    const col = Render.colorOf(a);
    if (a.type === 'text') {
      if (!a.text) return [];
      const b = Render.textBox(a.text, k);
      const t = svgEl('text', {
        x: a.x + b.padX, y: a.y, fill: Render.textInk(col), 'font-size': b.fs, 'font-weight': 600,
        'font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', 'dominant-baseline': 'middle'
      });
      t.textContent = a.text;
      return [svgEl('rect', {
        x: a.x, y: a.y - b.h / 2, width: b.w, height: b.h, rx: b.r, fill: col,
        stroke: col === '#FFFFFF' ? '#6B6E72' : 'none', 'stroke-width': 1.5 * k
      }), t];
    }
    if (a.type === 'rect' || a.type === 'ellipse') {
      const n = norm(a);
      if (a.type === 'ellipse') {
        return [svgEl('ellipse', { cx: n.x + n.w / 2, cy: n.y + n.h / 2, rx: n.w / 2, ry: n.h / 2, fill: 'none', stroke: col, 'stroke-width': 4 * k })];
      }
      return [svgEl('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 4 * k, fill: 'none', stroke: col, 'stroke-width': 4 * k })];
    }
    const out = [svgEl('line', {
      x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: col, 'stroke-width': 4 * k,
      'stroke-linecap': 'round', 'marker-end': markerFor(col)
    })];
    // Ältere Pfeile mit Beschriftung am Anfang
    if (a.text) {
      const t = svgEl('text', {
        x: a.x1, y: a.y1, fill: Render.textInk(col), 'font-size': 15 * k, 'font-weight': 600,
        'font-family': 'system-ui, sans-serif', 'dominant-baseline': 'middle',
        'text-anchor': a.x2 >= a.x1 ? 'end' : 'start', stroke: col, 'stroke-width': 8 * k,
        'paint-order': 'stroke', 'stroke-linejoin': 'round'
      });
      t.textContent = a.text;
      out.push(t);
    }
    return out;
  }

  // ---- Werkzeuge ----

  const ANNO_TOOLS = new Set(['arrow', 'text', 'rect', 'ellipse']);
  const SEL_HINT = ' Vorhandenes anklicken zum Auswählen, ziehen zum Verschieben, an den Griffen ändern, Entf zum Löschen.';
  const HINTS = {
    redact: 'Rechteck ziehen, um zu schwärzen. Auf eine bestehende Schwärzung klicken, um sie zu entfernen. Beim Export wird die Schwärzung fest ins Bild gerechnet.',
    crop: 'Rechteck über den Bereich ziehen, der erhalten bleiben soll.',
    marker: 'Auf die Stelle klicken, an der der Klickpunkt sitzen soll.',
    arrow: 'Ziehen, um einen Pfeil zu zeichnen.' + SEL_HINT,
    text: 'Auf eine freie Stelle klicken, um einen Text zu setzen.' + SEL_HINT,
    rect: 'Ziehen, um ein Rechteck zu zeichnen.' + SEL_HINT,
    ellipse: 'Ziehen, um einen Kreis oder ein Oval zu zeichnen.' + SEL_HINT
  };
  const TYPE_LABEL = { arrow: 'Pfeil', text: 'Text', rect: 'Rechteck', ellipse: 'Kreis' };

  function selected() {
    const s = current();
    return s && s.annotations ? s.annotations[S.selAnno] || null : null;
  }

  function norm(a) {
    return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  }

  /** Umrandung einer Annotation in Bildpixeln. */
  function annoBox(a, k) {
    if (a.type === 'text') {
      const b = Render.textBox(a.text || ' ', k);
      return { x: a.x, y: a.y - b.h / 2, w: b.w, h: b.h };
    }
    if (a.type === 'arrow') {
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    }
    return norm(a);
  }

  function handles(a) {
    if (a.type === 'arrow') return [{ id: 'p1', x: a.x1, y: a.y1 }, { id: 'p2', x: a.x2, y: a.y2 }];
    if (a.type === 'rect' || a.type === 'ellipse') {
      const n = norm(a);
      return [
        { id: 'nw', x: n.x, y: n.y }, { id: 'ne', x: n.x + n.w, y: n.y },
        { id: 'sw', x: n.x, y: n.y + n.h }, { id: 'se', x: n.x + n.w, y: n.y + n.h }
      ];
    }
    return [];
  }

  /** Oberste Annotation unter dem Punkt. */
  function hitAnnotation(s, p) {
    const k = Render.scaleOf(s);
    const tol = 10 * k;
    const list = s.annotations || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type === 'arrow') {
        const dx = a.x2 - a.x1;
        const dy = a.y2 - a.y1;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x1) * dx + (p.y - a.y1) * dy) / len2));
        if (Math.hypot(p.x - (a.x1 + t * dx), p.y - (a.y1 + t * dy)) <= tol) return i;
      } else if (a.type === 'text') {
        if (!a.text) continue;
        const b = annoBox(a, k);
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
      } else if (a.type === 'rect') {
        const n = norm(a);
        const inside = p.x >= n.x - tol && p.x <= n.x + n.w + tol && p.y >= n.y - tol && p.y <= n.y + n.h + tol;
        const innerCore = p.x > n.x + tol && p.x < n.x + n.w - tol && p.y > n.y + tol && p.y < n.y + n.h - tol;
        if (inside && !innerCore) return i; // nur am Rand, damit man darin neue Formen ziehen kann
      } else if (a.type === 'ellipse') {
        const n = norm(a);
        const rx = n.w / 2 || 1;
        const ry = n.h / 2 || 1;
        const d = Math.hypot((p.x - n.x - rx) / rx, (p.y - n.y - ry) / ry);
        if (Math.abs(d - 1) * Math.min(rx, ry) <= tol) return i;
      }
    }
    return -1;
  }

  function hitHandle(a, p, k) {
    for (const h of handles(a)) {
      if (Math.abs(p.x - h.x) <= 9 * k && Math.abs(p.y - h.y) <= 9 * k) return h.id;
    }
    return null;
  }

  /** Leer gelassene Texte nicht stehen lassen. */
  function dropEmptyTexts() {
    const s = current();
    if (!s || !(s.annotations || []).some((a) => a.type === 'text' && !a.text)) return;
    s.annotations = s.annotations.filter((a) => a.type !== 'text' || a.text);
    S.selAnno = -1;
    saveStep(s);
  }

  function setTool(t) {
    dropEmptyTexts();
    S.tool = S.tool === t ? null : t;
    $('ed-toolbar').querySelectorAll('[data-tool]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.tool === S.tool ? 'true' : 'false');
    });
    const stage = $('ed-stage');
    stage.classList.toggle('tool-on', !!S.tool);
    stage.classList.toggle('tool-marker', S.tool === 'marker');
    $('ed-hint').textContent = S.tool ? HINTS[S.tool] : '';
    $('ed-colors').hidden = !ANNO_TOOLS.has(S.tool);
    if (!ANNO_TOOLS.has(S.tool)) S.selAnno = -1;
    drawOverlay();
    if (S.tool !== 'crop') cancelCrop();
    showAnnoBar();
  }

  function showAnnoBar() {
    const a = selected();
    const on = ANNO_TOOLS.has(S.tool) && !!a;
    $('ed-anno-bar').hidden = !on;
    if (!on) return;
    $('ed-anno-text-wrap').hidden = a.type !== 'text';
    $('ed-anno-text').value = a.type === 'text' ? a.text || '' : '';
    $('ed-anno-remove').textContent = `${TYPE_LABEL[a.type] || 'Element'} entfernen`;
    renderColors();
  }

  function setColor(hex) {
    S.color = hex;
    try { localStorage.setItem('wfr-color', hex); } catch (_) { /* nur Komfort */ }
    const a = selected();
    const s = current();
    if (a && s) {
      pushUndo(s);
      a.color = hex;
      saveStep(s);
      drawOverlay();
    }
    renderColors();
  }

  /** Farbleiste: zeigt die Farbe der Auswahl, sonst die zuletzt gewählte. */
  function renderColors() {
    const a = selected();
    const cur = a ? Render.colorOf(a) : S.color;
    for (const b of $('ed-colors').querySelectorAll('.swatch')) {
      b.setAttribute('aria-checked', b.dataset.hex === cur ? 'true' : 'false');
    }
  }

  function focusText() {
    const inp = $('ed-anno-text');
    inp.focus();
    inp.select();
  }

  function toImg(e) {
    const s = current();
    const r = $('ed-stage').getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(s.imgW, ((e.clientX - r.left) / r.width) * s.imgW)),
      y: Math.max(0, Math.min(s.imgH, ((e.clientY - r.top) / r.height) * s.imgH))
    };
  }

  function snapshot(s) {
    return {
      image: s.image, imgW: s.imgW, imgH: s.imgH, x: s.x, y: s.y, vw: s.vw, vh: s.vh,
      showMarker: s.showMarker, annotations: (s.annotations || []).map((a) => ({ ...a })),
      redactions: (s.redactions || []).map((q) => ({ ...q }))
    };
  }

  function pushUndo(s, snap) {
    const st = S.undo.get(s.id) || [];
    st.push(snap || snapshot(s));
    if (st.length > 30) st.shift();
    S.undo.set(s.id, st);
    updateUndo();
  }

  function updateUndo() {
    const s = current();
    $('ed-undo').disabled = !s || !(S.undo.get(s.id) || []).length;
  }

  async function undo() {
    const s = current();
    const st = s && S.undo.get(s.id);
    if (!st || !st.length) return;
    Object.assign(s, st.pop());
    S.selAnno = -1;
    await saveStep(s);
    renderStep();
    showAnnoBar();
  }

  async function removeSelected() {
    const s = current();
    if (!s || !selected()) return;
    pushUndo(s);
    s.annotations = s.annotations.filter((_, j) => j !== S.selAnno);
    S.selAnno = -1;
    await saveStep(s);
    drawOverlay();
    showAnnoBar();
  }

  function onStageDown(e) {
    const s = current();
    if (!s || !S.tool || e.button !== 0) return;
    e.preventDefault();
    const p = toImg(e);
    const k = Render.scaleOf(s);
    if (S.tool === 'marker') {
      pushUndo(s);
      s.x = (p.x / s.imgW) * s.vw;
      s.y = (p.y / s.imgH) * s.vh;
      s.showMarker = true;
      $('ed-show-marker').checked = true;
      saveStep(s);
      drawOverlay();
      return;
    }
    if (S.tool === 'redact') {
      const list = s.redactions || [];
      for (let i = list.length - 1; i >= 0; i--) {
        const q = list[i];
        if (p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) {
          pushUndo(s);
          s.redactions = list.filter((_, j) => j !== i);
          saveStep(s);
          drawOverlay();
          U.toast('Schwärzung entfernt');
          return;
        }
      }
    }
    $('ed-stage').setPointerCapture(e.pointerId);

    if (ANNO_TOOLS.has(S.tool)) {
      // 1. Griff der aktuellen Auswahl, 2. vorhandene Annotation, 3. neu anlegen
      const sel = selected();
      const handle = sel ? hitHandle(sel, p, k) : null;
      if (handle) {
        S.drag = { mode: 'handle', handle, start: p, orig: { ...sel }, before: snapshot(s), moved: false };
        return;
      }
      const hit = hitAnnotation(s, p);
      if (hit >= 0) {
        S.selAnno = hit;
        S.drag = { mode: 'move', start: p, orig: { ...s.annotations[hit] }, before: snapshot(s), moved: false };
        drawOverlay();
        showAnnoBar();
        return;
      }
      S.selAnno = -1;
      showAnnoBar();
      if (S.tool === 'text') {
        dropEmptyTexts();
        pushUndo(s);
        s.annotations = (s.annotations || []).concat({ type: 'text', x: p.x, y: p.y, text: 'Text', color: S.color });
        S.selAnno = s.annotations.length - 1;
        saveStep(s);
        drawOverlay();
        showAnnoBar();
        focusText();
        S.drag = null;
        return;
      }
      const anno = S.tool === 'arrow'
        ? { type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: S.color }
        : { type: S.tool, x: p.x, y: p.y, w: 0, h: 0, color: S.color };
      S.drag = { mode: 'new', start: p, anno };
      drawOverlay();
      return;
    }

    S.pendingCrop = null;
    $('ed-crop-bar').hidden = true;
    S.drag = { start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
  }

  function onStageMove(e) {
    const d = S.drag;
    if (!d) return;
    const p = toImg(e);
    const s = current();
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.mode === 'new') {
      if (d.anno.type === 'arrow') { d.anno.x2 = p.x; d.anno.y2 = p.y; } else { d.anno.w = dx; d.anno.h = dy; }
    } else if (d.mode === 'move' || d.mode === 'handle') {
      const a = s.annotations[S.selAnno];
      if (!a) return;
      d.moved = d.moved || Math.hypot(dx, dy) > 2;
      const o = d.orig;
      if (d.mode === 'move') {
        if (a.type === 'arrow') Object.assign(a, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
        else Object.assign(a, { x: o.x + dx, y: o.y + dy });
      } else if (a.type === 'arrow') {
        if (d.handle === 'p1') Object.assign(a, { x1: p.x, y1: p.y });
        else Object.assign(a, { x2: p.x, y2: p.y });
      } else {
        // Gegenüberliegende Ecke bleibt fest.
        const n = norm(o);
        const fx = d.handle.includes('w') ? n.x + n.w : n.x;
        const fy = d.handle.includes('n') ? n.y + n.h : n.y;
        Object.assign(a, { x: fx, y: fy, w: p.x - fx, h: p.y - fy });
      }
    } else if (d.rect) {
      d.rect = { x: d.start.x, y: d.start.y, w: dx, h: dy };
    }
    drawOverlay();
  }

  async function onStageUp() {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    const s = current();
    const k = Render.scaleOf(s);

    if (d.mode === 'move' || d.mode === 'handle') {
      const a = s.annotations[S.selAnno];
      if (d.moved && a) {
        if (a.type === 'rect' || a.type === 'ellipse') Object.assign(a, norm(a));
        pushUndo(s, d.before);
        await saveStep(s);
      }
      drawOverlay();
      showAnnoBar();
      return;
    }
    if (d.mode === 'new') {
      const a = d.anno;
      const big = a.type === 'arrow'
        ? Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= 12 * k
        : Math.abs(a.w) >= 8 * k && Math.abs(a.h) >= 8 * k;
      if (big) {
        if (a.type !== 'arrow') Object.assign(a, norm(a));
        pushUndo(s);
        s.annotations = (s.annotations || []).concat(a);
        S.selAnno = s.annotations.length - 1;
        await saveStep(s);
      }
      drawOverlay();
      showAnnoBar();
      return;
    }

    const r = Render.clampRect(d.rect, s.imgW, s.imgH);
    if (r.w < 4 * k || r.h < 4 * k) { drawOverlay(); return; }
    if (S.tool === 'redact') {
      pushUndo(s);
      s.redactions = (s.redactions || []).concat({ ...r, auto: false });
      await saveStep(s);
      drawOverlay();
    } else if (S.tool === 'crop') {
      S.pendingCrop = r;
      $('ed-crop-bar').hidden = false;
      drawOverlay();
    }
  }

  function cancelCrop() {
    S.pendingCrop = null;
    $('ed-crop-bar').hidden = true;
    drawOverlay();
  }

  async function applyCrop() {
    const s = current();
    if (!s || !S.pendingCrop) return;
    const patch = await Render.bakeCrop(s, S.pendingCrop);
    if (!patch) { U.toast('Der Bereich ist zu klein.', { error: true }); return; }
    pushUndo(s);
    Object.assign(s, patch);
    await saveStep(s);
    S.pendingCrop = null;
    $('ed-crop-bar').hidden = true;
    setTool(null);
    renderStep();
    U.toast('Screenshot zugeschnitten');
  }

  // ---- Schritte verwalten ----

  async function renumberAndSave() {
    S.steps.forEach((s, i) => { s.order = i + 1; });
    await DB.putSteps(S.steps);
  }

  async function move(delta) {
    const i = S.sel;
    const j = i + delta;
    if (j < 0 || j >= S.steps.length) return;
    [S.steps[i], S.steps[j]] = [S.steps[j], S.steps[i]];
    await renumberAndSave();
    S.sel = j;
    renderList();
    select(j);
    $('ed-steps').querySelector(`[data-idx="${j}"]`)?.focus();
  }

  async function deleteCurrent() {
    const s = current();
    if (!s) return;
    const label = s.type === 'section' ? 'diesen Abschnitt' : 'diesen Schritt';
    if (!confirm(`Möchtest du ${label} löschen?`)) return;
    await DB.deleteStep(s.id);
    S.undo.delete(s.id);
    S.steps.splice(S.sel, 1);
    await renumberAndSave();
    renderList();
    renderMeta();
    if (S.steps.length) select(Math.min(S.sel, S.steps.length - 1));
  }

  async function addSection() {
    const at = S.steps.length ? S.sel + 1 : 0;
    const rec = await DB.addStep({ guideId: S.guide.id, type: 'section', text: 'Neuer Abschnitt', note: '', order: at + 0.5 });
    S.steps.splice(at, 0, rec);
    await renumberAndSave();
    renderList();
    select(at);
    $('ed-text').focus();
    $('ed-text').select();
  }

  function goToFlagged() {
    const i = S.steps.findIndex((s) => s.type !== 'section' && s.unredacted > 0 && !s.reviewed);
    if (i >= 0) select(i);
    return i;
  }

  // ---- Verdrahtung ----

  function wire() {
    $('ov-settings').addEventListener('click', () => api.runtime.openOptionsPage());
    $('ov-import').addEventListener('change', (e) => { importFile(e.target.files[0]); e.target.value = ''; });

    $('ed-title').addEventListener('input', (e) => {
      S.guide.title = e.target.value.replace(/\s+/g, ' ').slice(0, 200);
      document.title = `${S.guide.title || 'Ohne Titel'} – Workflow Recorder`;
      saveLater('guide', saveGuide);
    });
    $('ed-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('ed-intro').addEventListener('input', (e) => {
      S.guide.intro = e.target.value.slice(0, 5000);
      saveLater('guide', saveGuide);
    });
    $('ed-text').addEventListener('input', (e) => {
      const s = current();
      if (!s) return;
      s.text = e.target.value.slice(0, 200);
      updateListItem(S.sel);
      saveLater('step-' + s.id, () => saveStep(s));
    });
    $('ed-note').addEventListener('input', (e) => {
      const s = current();
      if (!s) return;
      s.note = e.target.value.slice(0, 5000);
      saveLater('step-' + s.id, () => saveStep(s));
    });
    $('ed-show-marker').addEventListener('change', (e) => {
      const s = current();
      if (!s) return;
      s.showMarker = e.target.checked;
      saveStep(s);
      drawOverlay();
    });
    $('ed-reviewed').addEventListener('click', async () => {
      const s = current();
      if (!s) return;
      s.reviewed = true;
      await saveStep(s);
      renderList();
      renderStep();
    });

    $('ed-toolbar').querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('ed-undo').addEventListener('click', undo);
    $('ed-delete').addEventListener('click', deleteCurrent);
    $('ed-up').addEventListener('click', () => move(-1));
    $('ed-down').addEventListener('click', () => move(1));
    $('ed-add-section').addEventListener('click', addSection);
    $('ed-crop-apply').addEventListener('click', applyCrop);
    $('ed-crop-cancel').addEventListener('click', cancelCrop);
    $('ed-anno-text').addEventListener('input', (e) => {
      const s = current();
      const a = selected();
      if (!a || a.type !== 'text') return;
      a.text = e.target.value.replace(/\s+/g, ' ').slice(0, 80);
      drawOverlay();
      saveLater('step-' + s.id, () => saveStep(s));
    });
    $('ed-anno-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('ed-anno-remove').addEventListener('click', removeSelected);
    $('ed-colors').append(U.el('span', { class: 'lbl', text: 'Farbe' }), ...Render.COLORS.map((c) => U.el('button', {
      class: 'swatch', type: 'button', role: 'radio', title: c.name, 'aria-label': c.name,
      dataset: { hex: c.hex }, style: { background: c.hex }, onclick: () => setColor(c.hex)
    })));
    renderColors();

    const stage = $('ed-stage');
    stage.addEventListener('pointerdown', onStageDown);
    stage.addEventListener('pointermove', onStageMove);
    stage.addEventListener('pointerup', onStageUp);
    stage.addEventListener('pointercancel', () => { S.drag = null; drawOverlay(); });

    $('ed-steps').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      select(S.sel + (e.key === 'ArrowDown' ? 1 : -1));
      $('ed-steps').querySelector(`[data-idx="${S.sel}"]`)?.focus();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.tool && !$('export').open) setTool(null);
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName);
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected() && ANNO_TOOLS.has(S.tool)) {
        e.preventDefault();
        removeSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) {
        e.preventDefault();
        undo();
      }
    });

    $('ed-preview').addEventListener('click', async () => {
      await flushSaves();
      api.tabs.create({ url: api.runtime.getURL(`src/export/preview.html?guide=${S.guide.id}`) });
    });
    $('ed-backup').addEventListener('click', async () => {
      await flushSaves();
      U.toast('Sicherung wird erstellt …', { ms: 60000 });
      try {
        const blob = await Exporter.backup(S.guide.id);
        U.download(blob, `${U.safeFilename(S.guide.title)} (Sicherung).zip`);
        U.toast('Sicherung gespeichert');
      } catch (e) {
        U.toast('Sicherung fehlgeschlagen: ' + (e && e.message ? e.message : e), { error: true });
      }
    });

    window.addEventListener('beforeunload', () => { if (S.guide) flushSaves(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.guide) flushSaves(); });
  }

  wire();
  if (guideId) load(); else renderOverview();

  return {
    get state() { return S; },
    flushSaves,
    goToFlagged,
    reloadGuide: async () => { S.guide = await DB.getGuide(S.guide.id); }
  };
})();
