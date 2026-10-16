/* Seitenleiste (Chrome side_panel, Firefox sidebar_action): bleibt offen, steuert die Aufnahme
   und zeigt alle Schritte zum Prüfen. */
'use strict';

(() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);

  let rec = null;
  let pending = null;
  let guideId = null;
  let guideKind = 'guide'; // Art der angezeigten Anleitung
  let mode = 'guide';      // Art neuer Aufnahmen (Einstellung)
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
    // Beim Einfügen bestimmt die Anleitung die Art, nicht die Auswahl.
    $('sb-mode').hidden = !!pending;
    $('sb-mode-hint').hidden = !!pending;
    for (const b of $('sb-mode').querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
    $('sb-mode-hint').textContent = mode === 'checklist'
      ? 'Jeder Klick wird ein Prüfpunkt. Das erwartete Ergebnis trägst du während oder nach der Aufnahme ein.'
      : 'Jeder Klick wird ein Schritt mit Screenshot. Später kannst du daraus eine Checkliste machen.';
    $('sb-start-label').textContent = pending ? 'Schritte einfügen' : mode === 'checklist' ? 'Checkliste aufnehmen' : 'Klickweg aufnehmen';
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
    const check = recKind() === 'checklist';
    $('sb-count').textContent = String(rec.count);
    $('sb-count-label').textContent = check
      ? (rec.count === 1 ? 'Prüfpunkt erfasst' : 'Prüfpunkte erfasst')
      : (rec.count === 1 ? 'Schritt erfasst' : 'Schritte erfasst');
    $('sb-check').hidden = !check || rec.paused;
    $('sb-status').textContent = rec.paused ? 'PAUSIERT' : 'AUFNAHME';
    $('sb-dot').classList.toggle('paused', rec.paused);
    $('sb-pause-label').textContent = rec.paused ? 'Fortsetzen' : 'Pause';
  }

  /** Art der Anleitung, in die gerade aufgenommen wird. */
  function recKind() {
    return rec && rec.guideId === guideId ? guideKind : 'guide';
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
      if (typeof step.expected === 'string') fresh.expected = step.expected;
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
    const kindBefore = guideKind;
    guideKind = guide.kind === 'checklist' ? 'checklist' : 'guide';
    if (kindBefore !== guideKind) renderHead();
    const isCheck = guideKind === 'checklist';
    const key = `${guideId}:${guide.updatedAt}:${steps.length}:${rec ? 'r' : '-'}`;
    if (!force && key === renderedKey) return;
    // Nicht neu zeichnen, während jemand gerade einen Text bearbeitet.
    const ae = document.activeElement;
    if (!force && ae && (ae.classList.contains('sb-text') || ae.classList.contains('sb-exp'))) return;
    renderedKey = key;

    const what = isCheck ? 'Checkliste' : 'Anleitung';
    $('sb-guide-label').textContent = rec && rec.guideId === guideId ? `Aktuelle Aufnahme · ${what}` : `Zuletzt bearbeitet · ${what}`;
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
        'aria-label': isSec ? (isCheck ? 'Name des Testfalls' : 'Überschrift des Abschnitts') : `Text von ${isCheck ? 'Prüfpunkt' : 'Schritt'} ${n}`
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
          el('span', { class: 'sb-num' + (isSec ? ' section' : s.kind === 'check' ? ' check' : ''), text: isSec ? '§' : String(n) }),
          input, del));
      if (isCheck && !isSec) card.appendChild(expectedField(s, n));
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
          text: isCheck ? '+ Ab hier Prüfpunkte aufnehmen' : '+ Ab hier Schritte aufnehmen',
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

  /** Feld „Erwartet“ mit Vorschlag aus der Aufnahme (Statuswechsel, Dialog). */
  function expectedField(s, n) {
    const id = `sb-exp-${s.id}`;
    const ta = el('textarea', {
      id, class: 'sb-exp', rows: '1', maxlength: '300', placeholder: 'Was soll der Kunde danach sehen?'
    });
    ta.value = s.expected || '';
    const chip = el('div', { class: 'sb-suggest' });
    const renderChip = () => {
      const show = s.suggest && !s.expected;
      chip.hidden = !show;
      if (!show) return;
      chip.replaceChildren(el('span', { text: 'Vorschlag:' }), el('button', {
        class: 'sb-chip', type: 'button', text: s.suggest, title: 'Als erwartetes Ergebnis übernehmen',
        onclick: () => {
          ta.value = s.suggest;
          s.expected = s.suggest;
          saveLater(s);
          renderChip();
        }
      }));
    };
    ta.addEventListener('input', () => {
      s.expected = ta.value.slice(0, 300);
      saveLater(s);
      renderChip();
    });
    renderChip();
    return el('div', { class: 'sb-exp-wrap' },
      el('label', { class: 'sb-exp-label', for: id, text: `Erwartet (Prüfpunkt ${n})` }), ta, chip);
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
    await renderSteps(force);
  }

  /** target: { guideId, afterStepId } zum Einfügen; ohne Ziel gilt eine vorgemerkte Einfügestelle. */
  async function start(target) {
    showError('');
    $('sb-start').disabled = true;
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const msg = { type: 'start', tabId: tab ? tab.id : undefined };
      if (target && target.guideId) Object.assign(msg, { guideId: target.guideId, afterStepId: target.afterStepId || 0 });
      const r = await U.send(msg);
      if (r && r.ok) {
        guideId = r.rec.guideId;
        await refresh(true);
      } else if (r && r.error === 'permission') {
        $('sb-perm').hidden = false;
      } else {
        showError((r && r.error) || 'Die Aufnahme konnte nicht gestartet werden.');
        window.scrollTo(0, 0);
      }
    } finally {
      $('sb-start').disabled = false;
    }
  }

  $('sb-start').addEventListener('click', () => start());
  for (const b of $('sb-mode').querySelectorAll('[data-mode]')) {
    b.addEventListener('click', async () => {
      mode = b.dataset.mode;
      renderHead();
      await Settings.set({ mode });
    });
  }
  $('sb-check').addEventListener('click', async () => {
    $('sb-check').disabled = true;
    try {
      const r = await U.send({ type: 'checkpoint' }).catch(() => null);
      if (!r || !r.ok) {
        U.toast((r && r.error) || 'Der Prüfpunkt konnte nicht aufgenommen werden. Ist der Tab der Aufnahme sichtbar?', { error: true });
      }
    } finally {
      $('sb-check').disabled = false;
    }
  });
  api.commands.getAll().then((cmds) => {
    const c = cmds.find((x) => x.name === 'add-checkpoint');
    $('sb-check-key').textContent = c && c.shortcut ? c.shortcut : '';
  }, () => {});

  // Aufnahme-Optionen (gleiche Einstellungen wie Popup und Einstellungsseite)
  const OPTS = [['sb-opt-redact', 'autoRedact'], ['sb-opt-keys', 'keySteps']];
  async function renderOpts() {
    const st = await Settings.get();
    for (const [id, key] of OPTS) $(id).checked = st[key];
    if (st.mode !== mode) { mode = st.mode; renderHead(); }
  }
  for (const [id, key] of OPTS) {
    $(id).addEventListener('change', async (e) => {
      await Settings.set({ [key]: e.target.checked });
      U.send({ type: 'settings-changed' }).catch(() => {});
    });
  }
  api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) renderOpts(); });
  renderOpts();
  $('sb-all').addEventListener('click', () => api.tabs.create({ url: api.runtime.getURL('src/editor/editor.html') }));
  $('sb-pending-clear').addEventListener('click', async () => {
    await U.send({ type: 'clear-insert' });
    refresh(true);
  });
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
    if (area === 'session' && (changes.rec || changes.pendingInsert)) refresh(!!changes.pendingInsert);
  });
  setInterval(() => { if (rec) $('sb-time').textContent = elapsed(rec); }, 500);
  // Rückfall, falls Änderungen aus dem Editor kommen.
  setInterval(() => refresh(), 2000);
  refresh(true);
})();
