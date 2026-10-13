/* Einstellungsseite. */
'use strict';

(async () => {
  const { api } = U;
  const $ = (id) => document.getElementById(id);

  function msg(text, cls) {
    $('fields-msg').textContent = text || '';
    $('fields-msg').className = 'msg ' + (cls || '');
  }

  async function notify() {
    try { await U.send({ type: 'settings-changed' }); } catch (_) { /* Hintergrund schläft */ }
  }

  async function render() {
    const s = await Settings.get();
    $('autoRedact').checked = s.autoRedact;
    $('keySteps').checked = s.keySteps;
    $('openSidebar').checked = s.openSidebar;
    $('fields').value = s.fields.join('\n');
    $('footer').value = s.footer;
  }

  async function checkPerm() {
    const ok = await api.permissions.contains({ origins: ['<all_urls>'] });
    $('perm-card').hidden = ok;
  }

  $('autoRedact').addEventListener('change', async (e) => { await Settings.set({ autoRedact: e.target.checked }); notify(); });
  $('keySteps').addEventListener('change', async (e) => { await Settings.set({ keySteps: e.target.checked }); notify(); });
  $('openSidebar').addEventListener('change', async (e) => { await Settings.set({ openSidebar: e.target.checked }); });

  $('fields-save').addEventListener('click', async () => {
    const lines = $('fields').value.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
    const bad = lines.filter((l) => !Settings.FIELD_RE.test(l));
    if (bad.length) {
      msg(`Ungültige Feldnamen: ${bad.slice(0, 5).join(', ')}. Erlaubt sind Buchstaben, Ziffern, _ und Punkt.`, 'bad');
      return;
    }
    const s = await Settings.set({ fields: lines });
    $('fields').value = s.fields.join('\n');
    msg(`${s.fields.length} Felder gespeichert.`, 'ok');
    notify();
  });

  $('fields-reset').addEventListener('click', async () => {
    const s = await Settings.set({ fields: Settings.DEFAULT_FIELDS });
    $('fields').value = s.fields.join('\n');
    msg('Standardliste wiederhergestellt.', 'ok');
    notify();
  });

  let t = 0;
  $('footer').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => Settings.set({ footer: e.target.value }), 400);
  });

  $('perm-btn').addEventListener('click', async () => {
    try {
      await api.permissions.request({ origins: ['<all_urls>'] });
    } catch (_) { /* Nutzer hat abgelehnt */ }
    checkPerm();
  });

  $('shortcut').textContent = U.isMac() ? '⌥ ⇧ R' : 'Alt + Shift + R';
  try {
    const c = (await api.commands.getAll()).find((x) => x.name === 'toggle-recording');
    if (c && c.shortcut) $('shortcut').textContent = c.shortcut;
  } catch (_) { /* Standardanzeige */ }

  await render();
  await checkPerm();
})();
