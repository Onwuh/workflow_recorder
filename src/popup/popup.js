/* Popup: bereit / Aufnahme läuft. */
'use strict';

(() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);

  let rec = null;
  let timer = 0;
  let poller = 0;
  let lastRendered = -1;
  let thumbUrls = [];
  let windowId = null;
  api.windows.getCurrent().then((w) => { windowId = w.id; }, () => {});

  function show(view) {
    $('view-ready').hidden = view !== 'ready';
    $('view-rec').hidden = view !== 'rec';
  }

  function showError(msg) {
    const e = $('error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function openPage(path) {
    api.tabs.create({ url: api.runtime.getURL(path) });
    window.close();
  }

  // ---------- Bereit ----------

  async function renderReady() {
    show('ready');
    $('shortcut').textContent = U.isMac() ? '⌥ ⇧ R' : 'Alt ⇧ R';
    try {
      const cmds = await api.commands.getAll();
      const c = cmds.find((x) => x.name === 'toggle-recording');
      if (c && c.shortcut) $('shortcut').textContent = c.shortcut;
    } catch (_) { /* Standardanzeige */ }

    const st = await U.send({ type: 'status' }).catch(() => null);
    const p = st && st.pendingInsert;
    $('pending').hidden = !p;
    $('start-label').textContent = p ? 'Schritte einfügen' : 'Aufnahme starten';
    if (p) {
      $('pending-text').textContent = p.number
        ? `Neue Schritte werden in „${p.title}“ nach Schritt ${p.number} eingefügt.`
        : `Neue Schritte werden in „${p.title}“ am Anfang eingefügt.`;
    }

    const s = await Settings.get();
    $('opt-redact').checked = s.autoRedact;
    $('opt-keys').checked = s.keySteps;

    await checkPermission();
    await renderRecent();
  }

  async function activeTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function checkPermission() {
    const tab = await activeTab();
    let ok = true;
    try {
      const u = new URL(tab && tab.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        ok = await api.permissions.contains({ origins: [u.origin + '/*'] });
      }
    } catch (_) { /* keine prüfbare Seite */ }
    $('perm').hidden = ok;
    return ok;
  }

  async function renderRecent() {
    const box = $('recent');
    const guides = (await DB.listGuides()).slice(0, 3);
    if (!guides.length) {
      box.replaceChildren(el('p', { class: 'empty', text: 'Noch keine Anleitungen. Starte eine Aufnahme auf der Seite, die du erklären möchtest.' }));
      return;
    }
    box.replaceChildren(...guides.map((g) => {
      const fmt = typeof g.lastExport === 'string' ? g.lastExport : null;
      return el('a', {
        class: 'recent-item',
        href: `../editor/editor.html?guide=${g.id}`,
        onclick: (e) => { e.preventDefault(); openPage(`src/editor/editor.html?guide=${g.id}`); }
      },
      el('span', { class: 'recent-text' },
        el('span', { class: 'recent-title', text: g.title || 'Ohne Titel' }),
        el('span', { class: 'recent-meta', text: `${U.stepsLabel(g.stepCount)} · ${fmt ? U.relDay(g.updatedAt) : 'Entwurf'}` })
      ),
      el('span', { class: 'badge' + (fmt ? '' : ' none'), text: fmt || '—' }));
    }));
  }

  async function start() {
    showError('');
    $('btn-start').disabled = true;
    try {
      const r = await U.send({ type: 'start' });
      if (r && r.ok) {
        rec = r.rec;
        renderRec();
        return;
      }
      if (r && r.error === 'permission') {
        $('perm').hidden = false;
        showError('Bitte zuerst den Zugriff erlauben.');
      } else {
        showError((r && r.error) || 'Die Aufnahme konnte nicht gestartet werden.');
      }
    } catch (e) {
      showError('Die Aufnahme konnte nicht gestartet werden.');
    } finally {
      $('btn-start').disabled = false;
    }
  }

  async function requestPermission() {
    try {
      // Firefox: Host-Berechtigungen sind unter MV3 optional und müssen erteilt werden.
      const granted = await api.permissions.request({ origins: ['<all_urls>'] });
      if (granted) {
        $('perm').hidden = true;
        showError('');
      }
    } catch (_) {
      showError('Zugriff bitte in den Add-on-Einstellungen unter „Berechtigungen“ erteilen.');
    }
  }

  // ---------- Aufnahme ----------

  function elapsed(r) {
    const now = Date.now();
    const paused = r.pausedMs + (r.paused && r.pauseStart ? now - r.pauseStart : 0);
    const s = Math.max(0, Math.floor((now - r.startedAt - paused) / 1000));
    const h = Math.floor(s / 3600);
    const mm = U.pad2(Math.floor((s % 3600) / 60));
    const ss = U.pad2(s % 60);
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function renderRecHead() {
    $('rec-time').textContent = elapsed(rec);
    $('rec-count').textContent = String(rec.count);
    $('rec-count-label').textContent = rec.count === 1 ? 'Schritt erfasst' : 'Schritte erfasst';
    $('rec-status').textContent = rec.paused ? 'PAUSIERT' : 'AUFNAHME';
    $('rec-dot').classList.toggle('paused', rec.paused);
    $('pause-label').textContent = rec.paused ? 'Fortsetzen' : 'Pause';
    $('ico-pause').hidden = rec.paused;
    $('ico-play').hidden = !rec.paused;
    $('rec-host').textContent = rec.host || '—';
    $('rec-insert').hidden = !rec.insert;
    if (rec.insert) {
      $('rec-insert').textContent = rec.insert.number
        ? `Einfügen in „${rec.insert.title}“ nach Schritt ${rec.insert.number}`
        : `Einfügen in „${rec.insert.title}“ am Anfang`;
    }
    $('btn-discard').disabled = rec.count === 0;
  }

  async function renderLast() {
    lastRendered = rec.count;
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls = [];
    const steps = await DB.lastSteps(rec.guideId, 6);
    const box = $('last');
    if (!steps.length) {
      box.replaceChildren(el('p', { class: 'empty', text: 'Klicke auf der Seite, jeder Klick wird ein Schritt.' }));
      return;
    }
    box.replaceChildren(...steps.map((s) => {
      const thumb = U.thumb(s, 'thumb', thumbUrls);
      return el('div', { class: 'last-item' }, thumb,
        el('div', { class: 'last-text' },
          el('span', { class: 'last-num', text: U.pad2(s.number) }),
          el('span', { class: 'last-label', text: s.text })));
    }));
  }

  function renderRec() {
    show('rec');
    renderRecHead();
    renderLast();
    clearInterval(timer);
    clearInterval(poller);
    timer = setInterval(() => { if (rec) $('rec-time').textContent = elapsed(rec); }, 500);
    poller = setInterval(refresh, 800);
  }

  async function refresh() {
    const r = await U.send({ type: 'status' }).catch(() => null);
    if (!r || !r.rec) {
      rec = null;
      clearInterval(timer);
      clearInterval(poller);
      renderReady();
      return;
    }
    rec = r.rec;
    renderRecHead();
    if (rec.count !== lastRendered) renderLast();
  }

  async function act(type) {
    const r = await U.send({ type }).catch(() => null);
    if (r && r.rec) {
      rec = r.rec;
      renderRecHead();
      if (type === 'discard') renderLast();
    }
    return r;
  }

  /** Seitenleiste öffnen (muss direkt in der Klickbehandlung passieren). */
  function openSidebar() {
    try {
      if (api.sidePanel && api.sidePanel.open && windowId != null) {
        // Chrome: open() ohne vorheriges await, sonst gilt die Nutzeraktion als verbraucht.
        api.sidePanel.open({ windowId }).then(() => window.close(), () => {
          showError('Die Seitenleiste konnte nicht geöffnet werden.');
        });
        return;
      }
      if (globalThis.browser && browser.sidebarAction) {
        // Firefox: open() muss ohne vorheriges await aus der Nutzeraktion kommen.
        browser.sidebarAction.open().then(() => window.close(), () => showError('Die Seitenleiste konnte nicht geöffnet werden.'));
        return;
      }
    } catch (_) { /* unten */ }
    showError('Dieser Browser unterstützt keine Seitenleiste für Erweiterungen.');
  }

  // ---------- Verdrahtung ----------

  $('btn-sidebar').addEventListener('click', openSidebar);
  $('btn-sidebar-rec').addEventListener('click', openSidebar);

  $('btn-start').addEventListener('click', start);
  $('pending-clear').addEventListener('click', async () => {
    await U.send({ type: 'clear-insert' });
    renderReady();
  });
  $('btn-perm').addEventListener('click', requestPermission);
  $('btn-settings').addEventListener('click', () => { api.runtime.openOptionsPage(); window.close(); });
  $('link-all').addEventListener('click', (e) => { e.preventDefault(); openPage('src/editor/editor.html'); });
  $('opt-redact').addEventListener('change', async (e) => {
    await Settings.set({ autoRedact: e.target.checked });
    U.send({ type: 'settings-changed' });
  });
  $('opt-keys').addEventListener('change', async (e) => {
    await Settings.set({ keySteps: e.target.checked });
    U.send({ type: 'settings-changed' });
  });
  $('btn-pause').addEventListener('click', () => act(rec && rec.paused ? 'resume' : 'pause'));
  $('btn-stop').addEventListener('click', async () => {
    $('btn-stop').disabled = true;
    const r = await U.send({ type: 'stop' }).catch(() => null);
    if (r && r.empty) {
      rec = null;
      clearInterval(timer);
      clearInterval(poller);
      $('btn-stop').disabled = false;
      await renderReady();
      showError('Keine Schritte aufgenommen, die Aufnahme wurde verworfen.');
      return;
    }
    window.close();
  });
  $('btn-discard').addEventListener('click', () => act('discard'));

  (async () => {
    const r = await U.send({ type: 'status' }).catch(() => null);
    rec = r && r.rec;
    if (rec) renderRec();
    else renderReady();
  })();
})();
