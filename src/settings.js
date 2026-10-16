/* Einstellungen in chrome.storage.local, mit Standardwerten und Prüfung.
   Klassisches Skript für Hintergrund und Erweiterungsseiten. */
'use strict';

// eslint-disable-next-line no-unused-vars
var Settings = (() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const DEFAULT_FIELDS = [
    'partner_id', 'partner_invoice_id', 'partner_shipping_id', 'commercial_partner_id',
    'email', 'email_from', 'phone', 'mobile', 'vat', 'street', 'street2', 'zip', 'city',
    'bank_account_id', 'partner_bank_id', 'acc_number'
  ];

  const DEFAULTS = Object.freeze({
    autoRedact: true,
    keySteps: false,
    redactHeader: true,
    openSidebar: true,
    mode: 'guide', // Art neuer Aufnahmen: 'guide' (Klickweg) oder 'checklist' (Testcheckliste)
    fields: DEFAULT_FIELDS,
    footer: ''
  });

  const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;

  function sanitizeFields(list) {
    if (!Array.isArray(list)) return DEFAULT_FIELDS.slice();
    const out = [];
    for (const f of list) {
      if (typeof f !== 'string') continue;
      const v = f.trim();
      if (FIELD_RE.test(v) && !out.includes(v)) out.push(v);
      if (out.length >= 200) break;
    }
    return out;
  }

  function sanitize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      autoRedact: typeof s.autoRedact === 'boolean' ? s.autoRedact : DEFAULTS.autoRedact,
      keySteps: typeof s.keySteps === 'boolean' ? s.keySteps : DEFAULTS.keySteps,
      openSidebar: typeof s.openSidebar === 'boolean' ? s.openSidebar : DEFAULTS.openSidebar,
      redactHeader: typeof s.redactHeader === 'boolean' ? s.redactHeader : DEFAULTS.redactHeader,
      mode: s.mode === 'checklist' ? 'checklist' : 'guide',
      fields: s.fields === undefined ? DEFAULT_FIELDS.slice() : sanitizeFields(s.fields),
      footer: typeof s.footer === 'string' ? s.footer.slice(0, 200) : ''
    };
  }

  async function get() {
    const r = await api.storage.local.get('settings');
    return sanitize(r.settings);
  }

  async function set(patch) {
    const cur = await get();
    const next = sanitize({ ...cur, ...patch });
    await api.storage.local.set({ settings: next });
    return next;
  }

  return { DEFAULTS, DEFAULT_FIELDS, FIELD_RE, sanitize, sanitizeFields, get, set };
})();
