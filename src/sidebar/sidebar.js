/* Seitenleiste (Chrome side_panel, Firefox sidebar_action): bleibt offen, steuert die Aufnahme
   und zeigt alle Schritte zum Prüfen. */
'use strict';

(() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);

  let rec = null;
  let guideId = null;
  let renderedKey = '';
  let urls = [];
  const saveTimers = new Map();

  function elapsed(r) {
    const now = Date.now();
    const paused = r.pausedMs + (r.paused && r.pauseStart ? now - r.pauseStart : 0);
    const s = Math.max(0, Math.floor((now - r.startedAt - paused) / 1000));
    const h = Math.floor(s / 3600);
    const mm = U.pad2(Math.floor((s % 3600) / 60));
    const ss = U.pad2(s % 60);
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function showError(msg) {
    $('sb-error').textContent = msg || '';
    $('sb-error').hidden = !msg;
  }

  function renderHead() {
    $('sb-ready').hidden = !!rec;
    $('sb-rec').hidden = !rec;
    $('sb-discard').hidden = !rec || !rec.count;
    if (!rec) return;
    $('sb-time').textContent = elapsed(rec);
    $('sb-count').textContent = String(rec.count);
    $('sb-count-label').textContent = rec.count === 1 ? 'Schritt erfasst' : 'Schritte erfasst';
    $('sb-status').textContent = rec.paused ? 'PAUSIERT' : 'AUFNAHME';
    $('sb-dot').classList.toggle('paused', rec.paused);
    $('sb-pause-label').textContent = rec.paused ? 'Fortsetzen' : 'Pause';
  }

  function openEditor(stepId) {
    const q = stepId ? `&step=${stepId}` : '';
    api.tabs.create({ url: api.runtime.getURL(`src/editor/editor.html?guide=${guideId}${q}`) });
  }

  function saveLater(step) {
    clearTimeout(saveTimers.get(step.id));
    saveTimers.set(step.id, setTimeout(async () => {
      saveTimers.delete(step.id);
      // Frisch laden, damit Änderungen aus dem Editor (Bild, Schwärzungen) nicht überschrieben werden.
      const fresh = await DB.getStep(step.id);
      if (!fresh) return;
      fresh.text = step.text;
      await DB.putStep(fresh);
    }, 400));
  }

  async function renderSteps(force) {
    const guide = guideId ? await DB.getGuide(guideId) : null;
    if (!guide) {
      $('sb-guide-title').textContent = '—';
      $('sb-open').hidden = true;
      $('sb-steps').replaceChildren();
      $('sb-empty').hidden = false;
      renderedKey = '';
      return;
    }
    const steps = await DB.getSteps(guideId);
    const key = `${guideId}:${guide.updatedAt}:${steps.length}`;
    if (!force && key === renderedKey) return;
    // Nicht neu zeichnen, während jemand gerade einen Text bearbeitet.
    if (!force && document.activeElement && document.activeElement.classList.contains('sb-text')) return;
    renderedKey = key;

    $('sb-guide-label').textContent = rec && rec.guideId === guideId ? 'Aktuelle Aufnahme' : 'Zuletzt bearbeitet';
    $('sb-guide-title').textContent = guide.title || 'Ohne Titel';
    $('sb-open').hidden = false;
    $('sb-empty').hidden = steps.length > 0;

    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    let n = 0;
    const items = steps.map((s, i) => {
      const isSec = s.type === 'section';
      if (!isSec) n++;
      const input = el('input', {
        class: 'sb-text', type: 'text', maxlength: '200', value: s.text || '',
        'aria-label': isSec ? 'Überschrift des Abschnitts' : `Text von Schritt ${n}`
      });
      input.addEventListener('input', () => {
        s.text = input.value.slice(0, 200);
        saveLater(s);
      });
      const del = el('button', {
        class: 'btn-icon sb-del', type: 'button', title: 'Schritt löschen', 'aria-label': 'Schritt löschen',
        onclick: async () => {
          if (!confirm(isSec ? 'Diesen Abschnitt löschen?' : 'Diesen Schritt löschen?')) return;
          await DB.deleteStep(s.id);
          if (rec && rec.guideId === guideId) await U.send({ type: 'recount' }).catch(() => null);
          renderSteps(true);
        }
      }, U.icon(['M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14']));
      const card = el('li', { class: 'sb-step' + (i === steps.length - 1 && rec ? ' new' : '') },
        el('div', { class: 'sb-step-head' },
          el('span', { class: 'sb-num' + (isSec ? ' section' : ''), text: isSec ? '§' : String(n) }),
          input, del));
      if (!isSec && s.image) {
        const th = U.thumb(s, 'sb-thumb-in', urls);
        th.style.width = '100%';
        th.style.height = '100%';
        const btn = el('button', { class: 'sb-thumb thumb-box', type: 'button', title: 'Im Editor öffnen', onclick: () => openEditor(s.id) }, th);
        if (s.imgW && s.imgH) btn.style.aspectRatio = `${s.imgW} / ${s.imgH}`;
        card.appendChild(btn);
      }
      if (!isSec && s.unredacted > 0 && !s.reviewed) {
        card.appendChild(el('div', { class: 'sb-flag', text: s.navigated ? 'Seite hat beim Screenshot neu geladen: Schwärzung prüfen.' : 'Ungeschwärzte Eingabefelder: bitte im Editor prüfen.' }));
      }
      return card;
    });
    $('sb-steps').replaceChildren(...items);
    if (rec && rec.guideId === guideId && items.length) items[items.length - 1].scrollIntoView({ block: 'nearest' });
  }

  async function refresh(force) {
    const r = await U.send({ type: 'status' }).catch(() => null);
    rec = r && r.rec ? r.rec : null;
    if (rec) guideId = rec.guideId;
    else if (!guideId) {
      const gs = await DB.listGuides();
      guideId = gs.length ? gs[0].id : null;
    }
    renderHead();
    await renderSteps(force);
  }

  async function start() {
    showError('');
    $('sb-start').disabled = true;
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const r = await U.send({ type: 'start', tabId: tab ? tab.id : undefined });
      if (r && r.ok) {
        guideId = r.rec.guideId;
        await refresh(true);
      } else if (r && r.error === 'permission') {
        $('sb-perm').hidden = false;
      } else {
        showError((r && r.error) || 'Die Aufnahme konnte nicht gestartet werden.');
      }
    } finally {
      $('sb-start').disabled = false;
    }
  }

  $('sb-start').addEventListener('click', start);
  $('sb-settings').addEventListener('click', () => api.runtime.openOptionsPage());
  $('sb-perm-btn').addEventListener('click', async () => {
    try {
      if (await api.permissions.request({ origins: ['<all_urls>'] })) $('sb-perm').hidden = true;
    } catch (_) { showError('Zugriff bitte in den Add-on-Einstellungen erteilen.'); }
  });
  $('sb-pause').addEventListener('click', async () => {
    await U.send({ type: rec && rec.paused ? 'resume' : 'pause' });
    refresh();
  });
  // Aus der Seitenleiste beendet: Schritte bleiben hier offen, kein Editor-Tab.
  $('sb-stop').addEventListener('click', async () => {
    await U.send({ type: 'stop', openEditor: false });
    await refresh(true);
  });
  $('sb-discard').addEventListener('click', async () => {
    await U.send({ type: 'discard' });
    refresh(true);
  });
  $('sb-open').addEventListener('click', () => openEditor());

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.rec) refresh();
  });
  setInterval(() => { if (rec) $('sb-time').textContent = elapsed(rec); }, 500);
  // Rückfall, falls Änderungen aus dem Editor kommen.
  setInterval(() => refresh(), 2000);
  refresh(true);
})();
