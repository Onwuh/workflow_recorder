/* Content-Script: Klick-Erkennung, Schritttext, Auto-Schwärzung.
   Läuft in der isolierten Welt der Erweiterung. Die Seite kann weder unsere Variablen
   noch unsere Nachrichten sehen. Eingabewerte werden nie gelesen oder verschickt. */
(() => {
  'use strict';

  // Schutz gegen doppelte Initialisierung (Manifest + executeScript beim Start).
  if (globalThis.__workflowRecorderLoaded) return;
  globalThis.__workflowRecorderLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const MAX_TEXT = 60;

  let state = { recording: false, paused: false, autoRedact: true, keySteps: false, fields: [] };
  let lastStepAt = 0;
  let busy = false;

  // ---------- Zustand ----------

  function applyState(msg) {
    if (!msg || msg.type !== 'state') return;
    state = {
      recording: msg.recording === true,
      paused: msg.paused === true,
      autoRedact: msg.autoRedact !== false,
      keySteps: msg.keySteps === true,
      fields: Array.isArray(msg.fields) ? msg.fields.filter((f) => typeof f === 'string' && /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/.test(f)) : []
    };
  }

  function send(msg) {
    try {
      if (!api || !api.runtime || !api.runtime.id) return Promise.resolve(null);
      return api.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      // Erweiterung wurde neu geladen, dieses Skript ist verwaist.
      return Promise.resolve(null);
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== api.runtime.id || !msg) return false;
    if (msg.type === 'measure') {
      let r;
      try { r = state.recording ? measure() : null; } catch (_) { r = null; }
      sendResponse(r);
      return false;
    }
    applyState(msg);
    return false;
  });

  send({ type: 'hello' }).then(applyState);

  // ---------- Hilfen für Texte ----------

  function clean(text) {
    return String(text || '')
      .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Beschriftung säubern: Odoo-Tooltip-„?“, Pflicht-Sternchen, Doppelpunkt am Ende. */
  function cleanLabel(text) {
    let t = clean(text);
    t = t.replace(/(\s*[?*:])+$/, '').trim();
    return t;
  }

  /** Setzt die Beschriftung in die Vorlage ein und kürzt so, dass der ganze Satz ≤ 60 Zeichen bleibt. */
  function fmt(template, label) {
    const base = template.replace('%s', '');
    const avail = MAX_TEXT - base.length;
    let l = label;
    if (l.length > avail) l = l.slice(0, Math.max(1, avail - 1)).trimEnd() + '…';
    return template.replace('%s', l);
  }

  function visibleText(el) {
    // innerText berücksichtigt CSS (versteckte Teile fallen weg).
    const t = el.innerText !== undefined ? el.innerText : el.textContent;
    return clean(t);
  }

  function textByIds(ids) {
    return clean(String(ids || '').split(/\s+/).map((id) => {
      const n = id && document.getElementById(id);
      return n ? visibleText(n) : '';
    }).join(' '));
  }

  /** Name eines Elements aus aria-label, aria-labelledby oder title. */
  function ariaName(el) {
    return cleanLabel(el.getAttribute('aria-label')) ||
      cleanLabel(textByIds(el.getAttribute('aria-labelledby'))) ||
      cleanLabel(el.getAttribute('title'));
  }

  /** Feldbeschriftung ohne Eingabewert. Platzhalter werden bewusst nicht genutzt (oft Beispieldaten). */
  function fieldLabel(el) {
    const a = cleanLabel(el.getAttribute('aria-label')) || cleanLabel(textByIds(el.getAttribute('aria-labelledby')));
    if (a) return a;
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) {
        const t = cleanLabel(visibleText(lab));
        if (t) return t;
      }
    }
    const wrapLabel = el.closest('label');
    if (wrapLabel) {
      const t = cleanLabel(labelTextWithoutControls(wrapLabel));
      if (t) return t;
    }
    const widget = el.closest('.o_field_widget[name]');
    if (widget) {
      const t = odooFieldLabel(widget);
      if (t) return t;
    }
    const cell = el.closest('td[name]');
    if (cell) {
      const t = listColumnLabel(cell);
      if (t) return t;
    }
    return cleanLabel(el.getAttribute('title'));
  }

  function labelTextWithoutControls(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, [contenteditable]').forEach((n) => n.remove());
    return clone.textContent;
  }

  /** Odoo: Beschriftung eines Feld-Widgets über label[for="<name>_<n>"] oder die Spaltenüberschrift. */
  function odooFieldLabel(widget) {
    const name = widget.getAttribute('name');
    if (!name) return '';
    const inner = widget.querySelector('input[id], select[id], textarea[id]');
    if (inner) {
      const lab = document.querySelector(`label[for="${CSS.escape(inner.id)}"]`);
      if (lab) {
        const t = cleanLabel(visibleText(lab));
        if (t) return t;
      }
    }
    const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_\\d+$');
    for (const lab of document.querySelectorAll('label[for]')) {
      if (re.test(lab.getAttribute('for'))) {
        const t = cleanLabel(visibleText(lab));
        if (t) return t;
      }
    }
    const cell = widget.closest('td[name]');
    return cell ? listColumnLabel(cell) : '';
  }

  /** Odoo-Listen: Spaltenüberschrift th[data-name] zur Zelle td[name]. */
  function listColumnLabel(cell) {
    const name = cell.getAttribute('name');
    const table = cell.closest('table');
    if (!name || !table) return '';
    const th = table.querySelector(`thead th[data-name="${CSS.escape(name)}"]`);
    return th ? cleanLabel(visibleText(th)) : '';
  }

  // ---------- Schritttext ----------

  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', '']);
  const DATE_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

  // Bereiche, deren Texte oft Kundendaten enthalten: generischer Text statt Inhalt.
  const PRIVATE_AREAS = [
    ['.o_breadcrumb, .breadcrumb, .o_last_breadcrumb_item, [aria-label="breadcrumb"]', 'Gehe über die Navigationsleiste zurück'],
    ['.o-autocomplete--dropdown-menu, .o-autocomplete--dropdown-item, .ui-autocomplete, .o_m2o_dropdown_option, [role="listbox"]', 'Wähle einen Eintrag aus der Vorschlagsliste'],
    ['.o_kanban_record', 'Öffne eine Karte'],
    ['.o_data_row, .o_list_table tbody tr', 'Öffne einen Eintrag aus der Liste'],
    ['.o-mail-Chatter, .o_Chatter, .o-mail-Thread, .o_mail_thread', 'Klicke im Verlauf an die markierte Stelle'],
    ['.o_searchview_facet, .o_facet_values', 'Klicke auf einen aktiven Filter'],
    ['table:not(.o_group):not(.o_inner_group) > tbody > tr', 'Klicke auf eine Zeile der Tabelle']
  ];

  const CLICKABLE = [
    'button', 'a[href]', 'summary', 'label',
    'input[type="submit"]', 'input[type="button"]', 'input[type="reset"]',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="tab"]', '[role="switch"]', '[role="option"]', '[role="treeitem"]',
    '.o_app', '.o-app', '.dropdown-item', '.dropdown-toggle', '.nav-link', '.o_nav_entry'
  ].join(',');

  function isTextInput(el) {
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
  }

  function describeInput(el) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const label = fieldLabel(el);
    const L = (tpl, fallback) => (label ? fmt(tpl, label) : fallback);

    if (tag === 'SELECT') return { kind: 'click', text: L('Wähle bei „%s“ einen Eintrag aus', 'Wähle einen Eintrag aus der Liste') };
    if (tag === 'INPUT' && type === 'checkbox') {
      return { kind: 'click', text: el.checked ? L('Entferne den Haken bei „%s“', 'Entferne den Haken') : L('Setze den Haken bei „%s“', 'Setze den Haken') };
    }
    if (tag === 'INPUT' && type === 'radio') return { kind: 'click', text: L('Wähle „%s“', 'Wähle die markierte Option') };
    if (tag === 'INPUT' && (type === 'file')) return { kind: 'click', text: L('Lade bei „%s“ eine Datei hoch', 'Lade eine Datei hoch') };
    if (tag === 'INPUT' && (DATE_INPUT_TYPES.has(type) || el.closest('.o_field_date, .o_field_datetime, .o_datepicker'))) {
      return { kind: 'click', text: L('Wähle bei „%s“ ein Datum', 'Wähle ein Datum') };
    }
    const combo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' ||
      el.closest('.o_field_many2one, .o_field_many2many_tags, .o_field_many2one_avatar, .o_field_many2one_avatar_user');
    if (combo) return { kind: 'click', text: L('Wähle bei „%s“ einen Eintrag aus', 'Wähle einen Eintrag aus') };
    if (el.isContentEditable) return { kind: 'click', text: L('Gib bei „%s“ einen Text ein', 'Gib im markierten Bereich einen Text ein') };
    if (state.keySteps) return { kind: 'click', text: L('Klicke in das Feld „%s“', 'Klicke in das markierte Feld') };
    return { kind: 'click', text: L('Gib bei „%s“ einen Wert ein', 'Gib im markierten Feld einen Wert ein') };
  }

  function describeClickable(el) {
    let name = ariaName(el);
    if (!name) {
      if (el.matches('.o_stat_button')) {
        // Statistik-Buttons: nur die Beschriftung, nicht die Zahl.
        const st = el.querySelector('.o_stat_text');
        name = st ? cleanLabel(visibleText(st)) : '';
      } else if (el.tagName === 'INPUT') {
        name = cleanLabel(el.value);
      } else if (el.tagName === 'LABEL') {
        name = cleanLabel(labelTextWithoutControls(el));
      } else {
        name = cleanLabel(visibleText(el));
        if (!name) {
          const img = el.querySelector('img[alt]');
          if (img) name = cleanLabel(img.getAttribute('alt'));
        }
      }
    }
    if (!name) return null;

    if (el.matches('.o_app, .o-app, .o_home_menu .o_menuitem')) return fmt('Öffne die App „%s“', name);
    if (el.closest('.o_menu_sections') && el.matches('.dropdown-toggle, .o_nav_entry, [data-menu-xmlid]') && !el.matches('.dropdown-item')) {
      return fmt('Öffne das Menü „%s“', name);
    }
    if (el.matches('.dropdown-item, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
      return fmt('Klicke im Menü auf „%s“', name);
    }
    if (el.matches('[role="tab"]') || (el.matches('.nav-link') && el.closest('.nav-tabs, .o_notebook_headers'))) {
      return fmt('Öffne den Reiter „%s“', name);
    }
    if (el.closest('.o_statusbar_status')) return fmt('Setze den Status auf „%s“', name);
    if (el.matches('[role="switch"]')) return fmt('Schalte „%s“ um', name);
    return fmt('Klicke auf „%s“', name);
  }

  function describe(target) {
    // 1. Eingabefeld
    const input = target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]');
    if (input && !(input.tagName === 'INPUT' && ['submit', 'button', 'reset', 'image'].includes((input.getAttribute('type') || '').toLowerCase()))) {
      return describeInput(input);
    }
    // Klick auf ein <label>, das zu einem Eingabefeld gehört.
    const label = target.closest('label');
    if (label && label.control && label.control !== target) {
      const ctl = label.control;
      if (ctl.type === 'checkbox' || ctl.type === 'radio') return describeInput(ctl);
    }

    // 2. Private Bereiche
    for (const [sel, text] of PRIVATE_AREAS) {
      if (target.closest(sel)) return { kind: 'click', text };
    }

    // Feld-Widget ohne Eingabe (z. B. schreibgeschützt, Many2one-Link, Tags): nur die Beschriftung.
    const widget = target.closest('.o_field_widget[name]');
    if (widget && !target.closest('button, .btn')) {
      const l = odooFieldLabel(widget);
      return { kind: 'click', text: l ? fmt('Klicke auf das Feld „%s“', l) : 'Klicke an die markierte Stelle' };
    }

    // 3. Button, Link, Menü, Tab
    const clickable = target.closest(CLICKABLE);
    if (clickable) {
      const t = describeClickable(clickable);
      if (t) return { kind: 'click', text: t };
    }

    // 4. Fallback
    return { kind: 'click', text: 'Klicke an die markierte Stelle' };
  }

  // ---------- Auto-Schwärzung ----------
  // Der Hintergrund fragt direkt vor und nach dem Screenshot die zu schwärzenden Flächen ab.
  // Gespeichert werden Rechtecke; fest ins Bild gerechnet wird erst beim Export.

  function redactSelector() {
    const parts = ['input[type="email" i]', 'input[type="tel" i]', 'input[type="password" i]', 'input[autocomplete^="cc-"]'];
    for (const f of state.fields) {
      const n = CSS.escape(f);
      parts.push(`.o_field_widget[name="${n}"]`, `td[name="${n}"]`);
    }
    return parts.join(',');
  }

  // Ebenen, die über anderen Inhalten liegen können (Dialoge/Wizards, Menüs, Popover).
  const OCCLUDERS = [
    '.modal-content', '[role="dialog"]', '[role="alertdialog"]', '.o_dialog .modal-content',
    '.dropdown-menu.show', '.o-dropdown--menu', '[role="menu"]', '[role="listbox"]',
    '.popover', '.o_popover', '.o-autocomplete--dropdown-menu', '.ui-autocomplete', '.o_notification'
  ].join(',');

  function isVisibleRect(r) {
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;
  }

  function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  }

  /** Rechteck a ohne Loch b, als bis zu vier Teilrechtecke. */
  function subtract(a, b) {
    const i = intersect(a, b);
    if (!i) return [a];
    const out = [];
    if (i.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: i.y - a.y });
    if (i.y + i.h < a.y + a.h) out.push({ x: a.x, y: i.y + i.h, w: a.w, h: a.y + a.h - i.y - i.h });
    if (i.x > a.x) out.push({ x: a.x, y: i.y, w: i.x - a.x, h: i.h });
    if (i.x + i.w < a.x + a.w) out.push({ x: i.x + i.w, y: i.y, w: a.x + a.w - i.x - i.w, h: i.h });
    return out.filter((r) => r.w >= 1 && r.h >= 1);
  }

  const box = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });

  /** Liegt die Ebene an diesem Punkt über dem Element? */
  function coversAt(occ, el, area) {
    const hit = document.elementFromPoint(area.x + area.w / 2, area.y + area.h / 2);
    return !!hit && occ.contains(hit) && !el.contains(hit);
  }

  /**
   * Flächen (CSS-Pixel im Viewport), die geschwärzt werden müssen, und die Zahl ausgefüllter,
   * nicht geschwärzter Felder. Teile, die ein darüberliegender Dialog verdeckt, werden ausgespart,
   * damit Balken nicht über Wizards liegen.
   */
  function measure() {
    const view = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const covered = state.autoRedact ? Array.from(document.querySelectorAll(redactSelector())) : [];
    const occluders = Array.from(document.querySelectorAll(OCCLUDERS))
      .map((o) => ({ el: o, r: box(o.getBoundingClientRect()) }))
      .filter((o) => o.r.w > 0 && o.r.h > 0);
    const rects = [];
    for (const el of covered) {
      const r = el.getBoundingClientRect();
      if (!isVisibleRect(r)) continue;
      // 2 px größer als das Feld (Gestaltungsregel).
      let parts = [intersect({ x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 }, view)].filter(Boolean);
      for (const o of occluders) {
        if (o.el.contains(el) || el.contains(o.el)) continue;
        parts = parts.flatMap((p) => {
          const i = intersect(p, o.r);
          return i && coversAt(o.el, el, i) ? subtract(p, o.r) : [p];
        });
      }
      rects.push(...parts);
      if (rects.length > 400) break;
    }
    return { rects: rects.slice(0, 400), unredacted: countUnredacted(covered) };
  }

  /** Zählt sichtbare, ausgefüllte Eingabefelder, die nicht geschwärzt sind. Werte werden nicht übertragen. */
  function countUnredacted(covered) {
    let n = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.tagName === 'INPUT') {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color'].includes(t)) continue;
      }
      if (el.tagName === 'SELECT' ? el.selectedIndex <= 0 : !el.value) continue;
      if (!isVisibleRect(el.getBoundingClientRect())) continue;
      if (covered.some((c) => c === el || c.contains(el))) continue;
      n++;
    }
    return n;
  }

  // ---------- Schritt aufnehmen ----------

  async function record(info, x, y) {
    busy = true;
    try {
      await send({
        type: 'step',
        step: {
          kind: info.kind,
          text: info.text,
          x, y,
          vw: window.innerWidth,
          vh: window.innerHeight,
          dpr: window.devicePixelRatio || 1
        }
      });
    } finally {
      busy = false;
    }
  }

  function eventTarget(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (const n of path) if (n instanceof Element) return n;
    return e.target instanceof Element ? e.target : null;
  }

  function onPointerDown(e) {
    if (!state.recording || state.paused) return;
    if (!e.isTrusted || e.button !== 0 || !e.isPrimary) return;
    const now = performance.now();
    if (busy && now - lastStepAt < 400) return; // Doppelklicks nicht doppelt zählen
    const target = eventTarget(e);
    if (!target) return;
    lastStepAt = now;
    let info;
    try {
      info = describe(target);
    } catch (_) {
      info = { kind: 'click', text: 'Klicke an die markierte Stelle' };
    }
    record(info, e.clientX, e.clientY);
  }

  function onChange(e) {
    if (!state.recording || state.paused || !state.keySteps || !e.isTrusted) return;
    const el = eventTarget(e);
    if (!el || !isTextInput(el)) return;
    const label = fieldLabel(el);
    const r = el.getBoundingClientRect();
    record({
      kind: 'input',
      text: label ? fmt('Gib bei „%s“ einen Wert ein', label) : 'Gib im markierten Feld einen Wert ein'
    }, r.left + r.width / 2, r.top + r.height / 2);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('change', onChange, true);
})();
