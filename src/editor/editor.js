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
    selText: -1 // ausgewählte Text-Annotation
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
    S.selText = -1;
    $('ed-text-bar').hidden = true;
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

  /** Klickmarker, Pfeile und Auswahlrahmen als SVG in Bildpixeln. */
  function drawOverlay() {
    const s = current();
    const svg = $('ed-svg');
    if (!s || !s.image) { svg.replaceChildren(); return; }
    svg.setAttribute('viewBox', `0 0 ${s.imgW} ${s.imgH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const k = Render.scaleOf(s);
    const nodes = [];

    const defs = svgEl('defs', {});
    const marker = svgEl('marker', { id: 'ah', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' });
    marker.appendChild(svgEl('path', { d: 'M0 0L10 5L0 10z', fill: Render.REC }));
    defs.appendChild(marker);
    nodes.push(defs);

    // Schwärzungen: im Editor als Flächen, im Schwärzen-Modus anklickbar zum Entfernen.
    for (const q of s.redactions || []) {
      nodes.push(svgEl('rect', {
        x: q.x, y: q.y, width: q.w, height: q.h, rx: 3 * k, fill: '#1B1D1F',
        stroke: S.tool === 'redact' ? '#FF5A4E' : 'none', 'stroke-width': 2 * k,
        'stroke-dasharray': `${6 * k} ${4 * k}`
      }));
    }

    (s.annotations || []).forEach((a, i) => {
      if (a.type === 'text') {
        if (!a.text) return;
        const b = Render.textBox(a.text, k);
        nodes.push(svgEl('rect', {
          x: a.x, y: a.y - b.h / 2, width: b.w, height: b.h, rx: b.r, fill: Render.REC,
          stroke: i === S.selText && S.tool === 'text' ? '#1B1D1F' : 'none', 'stroke-width': 2 * k,
          'stroke-dasharray': `${5 * k} ${3 * k}`
        }));
        const t = svgEl('text', {
          x: a.x + b.padX, y: a.y, fill: '#FFFFFF', 'font-size': b.fs, 'font-weight': 600,
          'font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', 'dominant-baseline': 'middle'
        });
        t.textContent = a.text;
        nodes.push(t);
        return;
      }
      nodes.push(svgEl('line', {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: Render.REC, 'stroke-width': 4 * k,
        'stroke-linecap': 'round', 'marker-end': 'url(#ah)'
      }));
      // Ältere Pfeile mit Beschriftung am Anfang
      if (a.text) {
        const t = svgEl('text', {
          x: a.x1, y: a.y1, fill: '#FFFFFF', 'font-size': 15 * k, 'font-weight': 600,
          'font-family': 'system-ui, sans-serif', 'dominant-baseline': 'middle',
          'text-anchor': a.x2 >= a.x1 ? 'end' : 'start', stroke: Render.REC, 'stroke-width': 8 * k,
          'paint-order': 'stroke', 'stroke-linejoin': 'round'
        });
        t.textContent = a.text;
        nodes.push(t);
      }
    });

    if (s.showMarker !== false) {
      const { cx, cy } = Render.markerPos(s);
      nodes.push(svgEl('circle', {
        cx, cy, r: 22 * k - 1.5 * k, fill: 'rgba(200,55,45,0.12)', stroke: Render.REC, 'stroke-width': 3 * k
      }));
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
    if (S.drag && S.drag.arrow) {
      const a = S.drag.arrow;
      nodes.push(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: Render.REC, 'stroke-width': 4 * k, 'stroke-linecap': 'round', 'marker-end': 'url(#ah)' }));
    }
    svg.replaceChildren(...nodes);
  }

  // ---- Werkzeuge ----

  const HINTS = {
    redact: 'Rechteck ziehen, um zu schwärzen. Auf eine bestehende Schwärzung klicken, um sie zu entfernen. Beim Export wird die Schwärzung fest ins Bild gerechnet.',
    crop: 'Rechteck über den Bereich ziehen, der erhalten bleiben soll.',
    marker: 'Auf die Stelle klicken, an der der Klickpunkt sitzen soll.',
    arrow: 'Ziehen, um einen Pfeil zu zeichnen. Auf einen Pfeil klicken, um ihn zu entfernen.',
    text: 'Auf das Bild klicken, um einen Text zu setzen. Auf einen Text klicken, um ihn zu bearbeiten.'
  };

  /** Leer gelassene Texte nicht stehen lassen. */
  function dropEmptyTexts() {
    const s = current();
    if (!s || !(s.annotations || []).some((a) => a.type === 'text' && !a.text)) return;
    s.annotations = s.annotations.filter((a) => a.type !== 'text' || a.text);
    S.selText = -1;
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
    drawOverlay();
    if (S.tool !== 'crop') cancelCrop();
    showTextBar();
  }

  function showTextBar() {
    const s = current();
    const a = s && s.annotations && s.annotations[S.selText];
    const on = S.tool === 'text' && !!a && a.type === 'text';
    $('ed-text-bar').hidden = !on;
    $('ed-anno-text').value = on ? a.text || '' : '';
  }

  /** Index der Annotation unter dem Punkt (Text: Box, Pfeil: Abstand zur Linie). */
  function hitAnnotation(s, p, type) {
    const k = Render.scaleOf(s);
    const list = s.annotations || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type !== type) continue;
      if (type === 'text') {
        const b = Render.textBox(a.text || ' ', k);
        if (p.x >= a.x && p.x <= a.x + b.w && p.y >= a.y - b.h / 2 && p.y <= a.y + b.h / 2) return i;
      } else {
        const dx = a.x2 - a.x1;
        const dy = a.y2 - a.y1;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x1) * dx + (p.y - a.y1) * dy) / len2));
        if (Math.hypot(p.x - (a.x1 + t * dx), p.y - (a.y1 + t * dy)) <= 10 * k) return i;
      }
    }
    return -1;
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

  function pushUndo(s) {
    const st = S.undo.get(s.id) || [];
    st.push(snapshot(s));
    if (st.length > 20) st.shift();
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
    await saveStep(s);
    renderStep();
  }

  function onStageDown(e) {
    const s = current();
    if (!s || !S.tool || e.button !== 0) return;
    e.preventDefault();
    const p = toImg(e);
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
    if (S.tool === 'text') {
      const hit = hitAnnotation(s, p, 'text');
      if (hit >= 0) {
        S.selText = hit;
      } else {
        dropEmptyTexts();
        pushUndo(s);
        s.annotations = (s.annotations || []).concat({ type: 'text', x: p.x, y: p.y, text: 'Text' });
        S.selText = s.annotations.length - 1;
        saveStep(s);
      }
      drawOverlay();
      showTextBar();
      focusText();
      return;
    }
    if (S.tool === 'arrow') {
      const hit = hitAnnotation(s, p, 'arrow');
      if (hit >= 0) {
        pushUndo(s);
        s.annotations = s.annotations.filter((_, j) => j !== hit);
        saveStep(s);
        drawOverlay();
        U.toast('Pfeil entfernt');
        return;
      }
    }
    $('ed-stage').setPointerCapture(e.pointerId);
    if (S.tool === 'arrow') {
      S.drag = { start: p, arrow: { x1: p.x, y1: p.y, x2: p.x, y2: p.y } };
    } else {
      S.pendingCrop = null;
      $('ed-crop-bar').hidden = true;
      S.drag = { start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
    }
  }

  function onStageMove(e) {
    if (!S.drag) return;
    const p = toImg(e);
    if (S.drag.arrow) {
      S.drag.arrow.x2 = p.x;
      S.drag.arrow.y2 = p.y;
    } else {
      S.drag.rect = { x: S.drag.start.x, y: S.drag.start.y, w: p.x - S.drag.start.x, h: p.y - S.drag.start.y };
    }
    drawOverlay();
  }

  async function onStageUp() {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    const s = current();
    const k = Render.scaleOf(s);
    if (d.arrow) {
      const a = d.arrow;
      if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 12 * k) { drawOverlay(); return; }
      pushUndo(s);
      s.annotations = (s.annotations || []).concat({ type: 'arrow', ...a });
      await saveStep(s);
      drawOverlay();
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
      const a = s && s.annotations && s.annotations[S.selText];
      if (!a || a.type !== 'text') return;
      a.text = e.target.value.replace(/\s+/g, ' ').slice(0, 80);
      drawOverlay();
      saveLater('step-' + s.id, () => saveStep(s));
    });
    $('ed-anno-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('ed-anno-remove').addEventListener('click', async () => {
      const s = current();
      if (!s || S.selText < 0) return;
      pushUndo(s);
      s.annotations = s.annotations.filter((_, j) => j !== S.selText);
      S.selText = -1;
      await saveStep(s);
      drawOverlay();
      showTextBar();
    });

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
