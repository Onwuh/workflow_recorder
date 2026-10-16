/* Export-Dialog im Editor (Entwurf: docs/design/screens/Export.dc.html). */
'use strict';

(() => {
  const { el } = U;
  const $ = (id) => document.getElementById(id);
  const dlg = $('export');
  if (!dlg) return;

  const FORMATS = [
    { id: 'html', label: 'HTML-Datei', hint: 'Eine Datei, öffnet in jedem Browser', cta: 'HTML herunterladen', badge: 'HTML' },
    { id: 'pdf', label: 'PDF', hint: 'Zum Anhängen und Drucken', cta: 'PDF herunterladen', badge: 'PDF' },
    { id: 'odoo', label: 'Odoo Wissen', hint: 'Kopieren und in einen Artikel einfügen', cta: 'In Zwischenablage kopieren', badge: 'Odoo' },
    { id: 'md', label: 'Markdown', hint: 'Text plus Bilderordner als ZIP', cta: 'ZIP herunterladen', badge: 'MD' }
  ];
  // Testchecklisten: der Kunde hakt in Odoo ab. Kein HTML und kein PDF.
  const CHECK_FORMATS = [
    { id: 'odoo', label: 'Odoo Wissen', hint: 'Checkliste zum Abhaken im Artikel', cta: 'In Zwischenablage kopieren', badge: 'Odoo' },
    { id: 'md', label: 'Markdown', hint: 'Checkliste plus Bilderordner als ZIP', cta: 'ZIP herunterladen', badge: 'MD' }
  ];
  const MAX_LOGO = 5 * 1024 * 1024;

  let picked = 'html';
  let busy = false;
  let odooPrep = null; // { key, promise }
  // Zuschneiden ist nirgends voreingestellt: zugeschnittene Bilder wirken in Odoo Wissen gezoomt.
  const cropByFormat = { html: false, pdf: false, odoo: false, md: false };

  function opts() {
    return { cover: $('ex-cover').checked, marker: $('ex-marker').checked, crop: $('ex-crop').checked, images: $('ex-shots').checked };
  }

  function guide() { return Editor.state.guide; }
  const isCheck = () => guide().kind === 'checklist';
  const formats = () => (isCheck() ? CHECK_FORMATS : FORMATS);

  function status(msg) { $('ex-status').textContent = msg || ''; }

  function renderFormats() {
    $('ex-formats').replaceChildren(...formats().map((f) => el('button', {
      class: 'fmt', type: 'button', role: 'radio', 'aria-checked': f.id === picked ? 'true' : 'false',
      onclick: () => pick(f.id)
    }, el('span', { class: 'l', text: f.label }), el('span', { class: 'h', text: f.hint }))));
  }

  function pick(id) {
    if (!formats().some((f) => f.id === id)) id = formats()[0].id;
    picked = id;
    renderFormats();
    $('ex-crop').checked = cropByFormat[id];
    $('ex-odoo').hidden = id !== 'odoo';
    // Titelseite gibt es nur in HTML und PDF.
    $('ex-cover').parentElement.hidden = !(id === 'html' || id === 'pdf');
    $('ex-shots').parentElement.hidden = !isCheck();
    renderShots();
    renderLogo();
    $('ex-go').textContent = formats().find((f) => f.id === id).cta;
    status('');
    if (id === 'odoo') prepareOdoo();
  }

  function renderWarn() {
    const flagged = Editor.state.steps.filter((s) => s.type !== 'section' && s.unredacted > 0 && !s.reviewed).length;
    $('ex-warn').hidden = flagged === 0;
    const one = isCheck() ? 'Prüfpunkt' : 'Schritt';
    const many = isCheck() ? 'Prüfpunkte' : 'Schritte';
    $('ex-warn-text').textContent = flagged === 1
      ? `1 ${one} enthält ungeschwärzte Eingabefelder.`
      : `${flagged} ${many} enthalten ungeschwärzte Eingabefelder.`;
  }

  /** Ohne Screenshots sind Klickpunkt und Zuschnitt bedeutungslos. */
  function renderShots() {
    const off = isCheck() && !$('ex-shots').checked;
    $('ex-marker').parentElement.hidden = off;
    $('ex-crop').parentElement.hidden = off;
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
    const check = isCheck();
    $('ex-size-label').textContent = check
      ? (!o.images ? 'Ohne Bilder' : o.crop ? 'Kleine Bilder, zugeschnitten, WebP' : 'Kleine Bilder, max. 480 px breit, WebP')
      : (o.crop ? 'Bilder zugeschnitten, max. 1000 px, WebP' : 'Bilder max. 1000 px breit, WebP');
    const key = JSON.stringify([check, o.marker, o.crop, o.images]);
    if (odooPrep && odooPrep.key === key) return odooPrep.promise;
    $('ex-size').textContent = '…';
    const promise = Editor.flushSaves().then(() => (check ? Exporter.odooChecklist(guide().id, o) : Exporter.odoo(guide().id, o)));
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
    const fmt = formats().find((f) => f.id === picked);
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
          status(isCheck()
            ? 'Kopiert. Jetzt in Odoo Wissen in einen leeren Artikel einfügen und den Artikel für den Kunden freigeben.'
            : 'Kopiert. Jetzt in Odoo Wissen in einen leeren Artikel einfügen.');
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
        const blob = await Exporter.pdf(guide().id, o, progress);
        U.download(blob, `${title}.pdf`);
        status('PDF-Datei gespeichert.');
      } else if (picked === 'md') {
        const blob = isCheck() ? await Exporter.markdownChecklist(guide().id, o, progress) : await Exporter.markdown(guide().id, o, progress);
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
    const items = Editor.state.steps.filter((s) => s.type !== 'section');
    const n = items.length;
    $('ex-title').textContent = isCheck() ? 'Checkliste exportieren' : 'Anleitung exportieren';
    $('ex-sub').textContent = `${g.title} · ${isCheck() ? (n === 1 ? '1 Prüfpunkt' : `${n} Prüfpunkte`) : U.stepsLabel(n)}`;
    $('ex-paste-key').textContent = U.isMac() ? '⌘ V' : 'Strg + V';
    odooPrep = null;
    renderWarn();
    pick(picked);
    if (isCheck()) {
      const open = items.filter((s) => !s.expected).length;
      if (open) status(open === 1 ? '1 Prüfpunkt hat noch kein erwartetes Ergebnis.' : `${open} Prüfpunkte haben noch kein erwartetes Ergebnis.`);
    }
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
  $('ex-shots').addEventListener('change', () => { renderShots(); if (picked === 'odoo') prepareOdoo(); });
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
