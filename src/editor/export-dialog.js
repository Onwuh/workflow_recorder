/* Export-Dialog im Editor (Entwurf: docs/design/screens/Export.dc.html). */
'use strict';

(() => {
  const { api, el } = U;
  const $ = (id) => document.getElementById(id);
  const dlg = $('export');
  if (!dlg) return;

  const FORMATS = [
    { id: 'html', label: 'HTML-Datei', hint: 'Eine Datei, öffnet in jedem Browser', cta: 'HTML herunterladen', badge: 'HTML' },
    { id: 'pdf', label: 'PDF', hint: 'Zum Anhängen und Drucken', cta: 'PDF erstellen', badge: 'PDF' },
    { id: 'odoo', label: 'Odoo Wissen', hint: 'Kopieren und in einen Artikel einfügen', cta: 'In Zwischenablage kopieren', badge: 'Odoo' },
    { id: 'md', label: 'Markdown', hint: 'Text plus Bilderordner als ZIP', cta: 'ZIP herunterladen', badge: 'MD' }
  ];
  const MAX_LOGO = 5 * 1024 * 1024;

  let picked = 'html';
  let busy = false;
  let odooPrep = null; // { key, promise }
  const cropByFormat = { html: false, pdf: false, odoo: true, md: false };

  function opts() {
    return { cover: $('ex-cover').checked, marker: $('ex-marker').checked, crop: $('ex-crop').checked };
  }

  function guide() { return Editor.state.guide; }

  function status(msg) { $('ex-status').textContent = msg || ''; }

  function renderFormats() {
    $('ex-formats').replaceChildren(...FORMATS.map((f) => el('button', {
      class: 'fmt', type: 'button', role: 'radio', 'aria-checked': f.id === picked ? 'true' : 'false',
      onclick: () => pick(f.id)
    }, el('span', { class: 'l', text: f.label }), el('span', { class: 'h', text: f.hint }))));
  }

  function pick(id) {
    picked = id;
    renderFormats();
    $('ex-crop').checked = cropByFormat[id];
    $('ex-odoo').hidden = id !== 'odoo';
    // Titelseite gibt es nur in HTML und PDF.
    $('ex-cover').parentElement.hidden = !(id === 'html' || id === 'pdf');
    renderLogo();
    $('ex-go').textContent = FORMATS.find((f) => f.id === id).cta;
    status('');
    if (id === 'odoo') prepareOdoo();
  }

  function renderWarn() {
    const flagged = Editor.state.steps.filter((s) => s.type !== 'section' && s.unredacted > 0 && !s.reviewed).length;
    $('ex-warn').hidden = flagged === 0;
    $('ex-warn-text').textContent = flagged === 1
      ? '1 Schritt enthält ungeschwärzte Eingabefelder.'
      : `${flagged} Schritte enthalten ungeschwärzte Eingabefelder.`;
  }

  let logoUrl = null;
  function renderLogo() {
    const g = guide();
    const show = !$('ex-cover').parentElement.hidden && $('ex-cover').checked;
    $('ex-logo').hidden = !show;
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = g.logo ? URL.createObjectURL(g.logo) : null;
    $('ex-logo-img').hidden = !logoUrl;
    if (logoUrl) $('ex-logo-img').src = logoUrl;
    $('ex-logo-label').textContent = g.logo ? 'Logo ändern' : 'Logo wählen';
    $('ex-logo-remove').hidden = !g.logo;
  }

  async function setLogo(file) {
    if (!file) return;
    if (file.size > MAX_LOGO) { U.toast('Das Logo ist zu groß (max. 5 MB).', { error: true }); return; }
    try {
      // Neu kodieren: nur Pixel werden übernommen.
      const r = await Render.reencode(file, { maxWidth: 800 });
      const g = await DB.updateGuide(guide().id, { logo: r.blob });
      Editor.state.guide.logo = g.logo;
      renderLogo();
    } catch (_) {
      U.toast('Die Datei ist kein lesbares Bild.', { error: true });
    }
  }

  function kb(bytes) {
    return bytes >= 1024 * 1024 ? `≈ ${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `≈ ${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function prepareOdoo() {
    const o = opts();
    const key = JSON.stringify([o.marker, o.crop]);
    if (odooPrep && odooPrep.key === key) return odooPrep.promise;
    $('ex-size').textContent = '…';
    const promise = Editor.flushSaves().then(() => Exporter.odoo(guide().id, o));
    odooPrep = { key, promise };
    promise.then((r) => {
      if (odooPrep && odooPrep.promise === promise) $('ex-size').textContent = kb(r.bytes);
    }, () => { $('ex-size').textContent = '—'; });
    return promise;
  }

  async function markExported(badge) {
    try {
      const g = await DB.updateGuide(guide().id, { lastExport: badge });
      Editor.state.guide.updatedAt = g.updatedAt;
      Editor.state.guide.lastExport = badge;
    } catch (_) { /* nur Anzeige */ }
  }

  async function go() {
    if (busy) return;
    const fmt = FORMATS.find((f) => f.id === picked);
    const o = opts();
    const title = U.safeFilename(guide().title);
    const progress = (n) => status(`Bilder werden vorbereitet … ${n}`);

    // Odoo: Zwischenablage braucht die Nutzeraktion, daher ohne Umweg über weitere Dialoge.
    if (picked === 'odoo') {
      busy = true;
      status('Wird kopiert …');
      try {
        const r = await prepareOdoo();
        const ok = await Exporter.copyToClipboard(r.html, r.text);
        if (ok) {
          status('Kopiert. Jetzt in Odoo Wissen in einen leeren Artikel einfügen.');
          markExported(fmt.badge);
        } else {
          status('Kopieren wurde vom Browser blockiert. Bitte erneut versuchen.');
        }
      } catch (e) {
        status('Fehler: ' + (e && e.message ? e.message : e));
      } finally {
        busy = false;
      }
      return;
    }

    busy = true;
    $('ex-go').disabled = true;
    try {
      await Editor.flushSaves();
      if (picked === 'html') {
        const blob = await Exporter.html(guide().id, o, progress);
        U.download(blob, `${title}.html`);
        status('HTML-Datei gespeichert.');
      } else if (picked === 'pdf') {
        const q = new URLSearchParams({ guide: String(guide().id), print: '1', marker: o.marker ? '1' : '0', crop: o.crop ? '1' : '0', cover: o.cover ? '1' : '0' });
        await api.tabs.create({ url: api.runtime.getURL(`src/export/preview.html?${q}`) });
        status('Druckansicht geöffnet. Dort „Als PDF speichern“ wählen.');
      } else if (picked === 'md') {
        const blob = await Exporter.markdown(guide().id, o, progress);
        U.download(blob, `${title} (Markdown).zip`);
        status('ZIP-Datei gespeichert.');
      }
      markExported(fmt.badge);
    } catch (e) {
      status('Fehler: ' + (e && e.message ? e.message : e));
    } finally {
      busy = false;
      $('ex-go').disabled = false;
    }
  }

  function open() {
    if (!Editor.state.guide) return;
    const g = guide();
    $('ex-sub').textContent = `${g.title} · ${U.stepsLabel(Editor.state.steps.filter((s) => s.type !== 'section').length)}`;
    $('ex-paste-key').textContent = U.isMac() ? '⌘ V' : 'Strg + V';
    odooPrep = null;
    renderWarn();
    pick(picked);
    dlg.showModal();
  }

  $('ed-export').addEventListener('click', open);
  $('ex-close').addEventListener('click', () => dlg.close());
  $('ex-cancel').addEventListener('click', () => dlg.close());
  $('ex-go').addEventListener('click', go);
  $('ex-cover').addEventListener('change', renderLogo);
  $('ex-crop').addEventListener('change', (e) => {
    cropByFormat[picked] = e.target.checked;
    if (picked === 'odoo') prepareOdoo();
  });
  $('ex-marker').addEventListener('change', () => { if (picked === 'odoo') prepareOdoo(); });
  $('ex-logo-file').addEventListener('change', (e) => { setLogo(e.target.files[0]); e.target.value = ''; });
  $('ex-logo-remove').addEventListener('click', async () => {
    await DB.updateGuide(guide().id, { logo: null });
    Editor.state.guide.logo = null;
    renderLogo();
  });
  $('ex-warn-check').addEventListener('click', () => {
    dlg.close();
    Editor.goToFlagged();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
})();
