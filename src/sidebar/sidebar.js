/* Seitenleiste (Chrome side_panel, Firefox sidebar_action): bleibt offen, steuert die Aufnahme
   und zeigt alle Schritte zum Prüfen. */
'use strict';

(() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);

  let rec = null;
  let pending = null;
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
    $('sb-pending').hidden = !pending;
    $('sb-start-label').textContent = pending ? 'Schritte einfügen' : 'Aufnahme starten';
    if (pending) {
      $('sb-pending-text').textContent = pending.number
        ? `Neue Schritte werden in „${pending.title}“ nach Schritt ${pending.number} eingefügt.`
        : `Neue Schritte werden in „${pending.title}“ am Anfang eingefügt.`;
    }
    if (!rec) return;
    $('sb-insert').hidden = !rec.insert;
    if (rec.insert) {
      $('sb-insert').textContent = rec.insert.number
        ? `Einfügen in „${rec.insert.title}“ nach Schritt ${rec.insert.number}`
        : `Einfügen in „${rec.insert.title}“ am Anfang`;
    }
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
    const key = `${guideId}:${guide.updatedAt}:${steps.length}:${rec ? 'r' : '-'}`;
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
      const addedIds = new Set(rec && rec.guideId === guideId ? (rec.added || []).map((a) => a.id) : []);
      const card = el('li', { class: 'sb-step' + (addedIds.has(s.id) ? ' added' : ''), dataset: { id: String(s.id) } },
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
      if (!rec) {
        card.appendChild(el('button', {
          class: 'sb-insert-here', type: 'button',
          title: 'Neue Schritte direkt nach diesem aufnehmen',
          text: '+ Ab hier Schritte aufnehmen',
          onclick: () => start({ guideId, afterStepId: s.id })
        }));
      }
      return card;
    });
    $('sb-steps').replaceChildren(...items);
    // Zum zuletzt aufgenommenen Schritt scrollen (beim Einfügen steht er mitten in der Liste).
    const lastAdded = rec && rec.guideId === guideId && rec.added && rec.added.length ? rec.added[rec.added.length - 1].id : null;
    const target = lastAdded ? $('sb-steps').querySelector(`[data-id="${lastAdded}"]`) : null;
    if (target) target.scrollIntoView({ block: 'nearest' });
  }

  async function refresh(force) {
    const r = await U.send({ type: 'status' }).catch(() => null);
    rec = r && r.rec ? r.rec : null;
    pending = r && r.pendingInsert ? r.pendingInsert : null;
    if (rec) guideId = rec.guideId;
    else if (pending) guideId = pending.guideId;
    else if (!guideId) {
      const gs = await DB.listGuides();
      guideId = gs.length ? gs[0].id : null;
    }
    renderHead();
    renderBlocked();
    await renderSteps(force);
  }

  // ---------- Freigabe der Website im aktiven Tab ----------

  let windowId = null;
  let activeTabId = null;
  let site = null; // vorab geladen: die Browser-Abfrage muss synchron im Klick starten

  async function refreshSite() {
    const q = windowId != null ? { active: true, windowId } : { active: true, currentWindow: true };
    const [tab] = await api.tabs.query(q);
    activeTabId = tab ? tab.id : null;
    site = await U.siteInfo(tab && tab.url);
    U.renderSiteBox($('sb-perm'), site && site.recordable ? site : null, { onGranted: refreshSite });
  }

  let lastBlocked = '';
  function renderBlocked() {
    const b = rec && rec.blocked;
    const key = JSON.stringify(b || null);
    if (key === lastBlocked) return;
    lastBlocked = key;
    if (b && b.reason === 'permission') {
      U.renderSiteBox($('sb-blocked'), { ...b, granted: false }, { text: `Für ${b.host} gibt es keine Freigabe. Hier werden keine Schritte aufgenommen.` });
    } else if (b) {
      $('sb-blocked').hidden = false;
      $('sb-blocked').textContent = 'Auf dieser Seite kann nicht aufgenommen werden.';
    } else {
      $('sb-blocked').hidden = true;
    }
  }

  /** target: { guideId, afterStepId } zum Einfügen; ohne Ziel gilt eine vorgemerkte Einfügestelle. */
  function start(target) {
    const ask = site && site.recordable && !site.granted && site.site ? U.requestOrigins([site.site]) : null;
    doStart(target, ask);
  }

  async function doStart(target, ask) {
    showError('');
    $('sb-start').disabled = true;
    try {
      if (ask && !(await ask)) {
        await refreshSite();
        showError('Ohne Freigabe für diese Website kann hier nicht aufgenommen werden.');
        return;
      }
      const msg = { type: 'start', tabId: activeTabId != null ? activeTabId : undefined };
      if (target && target.guideId) Object.assign(msg, { guideId: target.guideId, afterStepId: target.afterStepId || 0 });
      const r = await U.send(msg);
      if (r && r.ok) {
        guideId = r.rec.guideId;
        await refresh(true);
      } else if (r && r.error === 'permission') {
        await refreshSite();
        showError('Ohne Freigabe für diese Website kann hier nicht aufgenommen werden.');
      } else {
        showError((r && r.error) || 'Die Aufnahme konnte nicht gestartet werden.');
        window.scrollTo(0, 0);
      }
    } finally {
      $('sb-start').disabled = false;
      refreshSite();
    }
  }

  $('sb-start').addEventListener('click', () => start());
  $('sb-all').addEventListener('click', () => api.tabs.create({ url: api.runtime.getURL('src/editor/editor.html') }));
  $('sb-pending-clear').addEventListener('click', async () => {
    await U.send({ type: 'clear-insert' });
    refresh(true);
  });
  $('sb-settings').addEventListener('click', () => api.runtime.openOptionsPage());
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
    if (area === 'session' && (changes.rec || changes.pendingInsert)) refresh(!!changes.pendingInsert);
  });
  // Aktiven Tab dieses Fensters verfolgen, damit der Freigabe-Hinweis zur sichtbaren Seite passt.
  api.windows.getCurrent().then((w) => { windowId = w.id; refreshSite(); }, () => refreshSite());
  api.tabs.onActivated.addListener((info) => { if (windowId == null || info.windowId === windowId) refreshSite(); });
  api.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab.active && (windowId == null || tab.windowId === windowId) && (info.status === 'complete' || info.url)) refreshSite();
  });
  if (api.permissions.onAdded) api.permissions.onAdded.addListener(() => refreshSite());
  if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(() => refreshSite());
  setInterval(() => { if (rec) $('sb-time').textContent = elapsed(rec); }, 500);
  // Rückfall, falls Änderungen aus dem Editor kommen.
  setInterval(() => refresh(), 2000);
  refresh(true);
})();
