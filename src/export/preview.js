/* Vorschau und Druckansicht (PDF über „Als PDF speichern“ im Druckdialog). */
'use strict';

(async () => {
  const p = new URLSearchParams(location.search);
  const guideId = U.intParam('guide');
  const flag = (k, d) => (p.has(k) ? p.get(k) === '1' : d);
  const opts = { marker: flag('marker', true), crop: flag('crop', false), cover: flag('cover', false) };
  const printMode = flag('print', false);
  const root = document.getElementById('root');
  const loading = document.getElementById('loading');

  try {
    if (!guideId) throw new Error('Keine Anleitung angegeben');
    const { guide, steps } = await Exporter.load(guideId);
    document.title = guide.title + (printMode ? ' – PDF' : ' – Vorschau');
    const settings = await Settings.get();
    const imgs = await Exporter.renderImages(steps, { marker: opts.marker, crop: opts.crop, type: 'image/png' }, 'objecturl');
    const logoSrc = guide.logo ? URL.createObjectURL(guide.logo) : null;
    const html = Exporter.guideBody(guide, steps, imgs, { logoSrc, cover: opts.cover, footer: settings.footer });
    // Eigenes, vollständig escaptes HTML. DOMParser führt keine Skripte aus.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = Array.from(doc.body.childNodes).map((n) => document.importNode(n, true));

    const bar = U.el('div', { class: 'p-bar' },
      U.el('span', { text: printMode ? 'Im Druckdialog „Als PDF speichern“ wählen.' : 'Vorschau der Anleitung, so sieht sie der Kunde.' }),
      U.el('button', { type: 'button', text: printMode ? 'Druckdialog öffnen' : 'Drucken / PDF', onclick: () => window.print() }));
    root.replaceChildren(bar, ...nodes);
    loading.remove();
    const btn = document.getElementById('g-print');
    if (btn) btn.addEventListener('click', () => window.print());

    if (printMode) {
      await Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      setTimeout(() => window.print(), 300);
    }
  } catch (e) {
    loading.textContent = 'Die Anleitung konnte nicht geladen werden: ' + (e && e.message ? e.message : e);
  }
})();
