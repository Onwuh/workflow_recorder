// ESLint-Konfiguration (flat config). Aufruf: npm run lint
'use strict';

const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', performance: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
  Response: 'readonly', fetch: 'readonly', crypto: 'readonly', atob: 'readonly', btoa: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', DataView: 'readonly',
  CompressionStream: 'readonly', DecompressionStream: 'readonly', createImageBitmap: 'readonly',
  indexedDB: 'readonly', Element: 'readonly', MutationObserver: 'readonly', DOMParser: 'readonly',
  ClipboardItem: 'readonly', CSS: 'readonly', confirm: 'readonly', importScripts: 'readonly',
  globalThis: 'readonly', self: 'readonly', module: 'readonly', require: 'readonly'
};
const ext = { DB: 'readonly', Settings: 'readonly', U: 'readonly', Render: 'readonly', Zip: 'readonly', Project: 'readonly', Exporter: 'readonly', Editor: 'readonly' };

module.exports = [
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...browser, ...ext } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-redeclare': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Kein innerHTML: DOM über createElement/textContent bauen.' },
        { property: 'outerHTML', message: 'Kein outerHTML.' },
        { property: 'insertAdjacentHTML', message: 'Kein insertAdjacentHTML.' }],
      'no-restricted-globals': ['error', { name: 'eval', message: 'Kein eval.' }]
    }
  },
  {
    // E2E läuft in Node und wertet Code in Erweiterungsseiten aus.
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', process: 'readonly', chrome: 'readonly', OffscreenCanvas: 'readonly', getComputedStyle: 'readonly' }
    }
  }
];
