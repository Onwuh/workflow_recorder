/* IndexedDB der Erweiterung.
   Stores: "guides" (Anleitungen) und "steps" (Schritte, Index guideId).
   Der Screenshot liegt als Blob direkt im Schritt.
   Wird als klassisches Skript geladen (Service Worker, Firefox-Hintergrundseite, Erweiterungsseiten). */
'use strict';

// eslint-disable-next-line no-unused-vars
var DB = (() => {
  const NAME = 'workflow-recorder';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('guides')) {
          db.createObjectStore('guides', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('steps')) {
          const steps = db.createObjectStore('steps', { keyPath: 'id', autoIncrement: true });
          steps.createIndex('guideId', 'guideId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Bei einem Versionswechsel aus einem anderen Kontext sauber schließen.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => reject(new Error('Datenbank blockiert'));
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, (e) => { try { t.abort(); } catch (_) {} reject(e); });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaktion abgebrochen'));
    });
  }

  function validId(id) {
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Ungültige ID');
    return n;
  }

  // ---- Anleitungen ----

  async function addGuide(data) {
    const now = Date.now();
    const guide = {
      title: 'Neue Anleitung',
      intro: '',
      createdAt: now,
      updatedAt: now,
      lastExport: null,
      logo: null,
      ...data
    };
    delete guide.id;
    const id = await tx(['guides'], 'readwrite', (t) => reqP(t.objectStore('guides').add(guide)));
    return { ...guide, id };
  }

  function getGuide(id) {
    id = validId(id);
    return tx(['guides'], 'readonly', (t) => reqP(t.objectStore('guides').get(id)));
  }

  function putGuide(guide) {
    validId(guide.id);
    guide.updatedAt = Date.now();
    return tx(['guides'], 'readwrite', (t) => reqP(t.objectStore('guides').put(guide)));
  }

  async function updateGuide(id, patch) {
    id = validId(id);
    return tx(['guides'], 'readwrite', async (t) => {
      const store = t.objectStore('guides');
      const g = await reqP(store.get(id));
      if (!g) throw new Error('Anleitung nicht gefunden');
      Object.assign(g, patch, { id, updatedAt: Date.now() });
      await reqP(store.put(g));
      return g;
    });
  }

  async function listGuides() {
    const guides = await tx(['guides'], 'readonly', (t) => reqP(t.objectStore('guides').getAll()));
    // Abschnitte zählen nicht als Schritt.
    const counts = await tx(['steps'], 'readonly', (t) => {
      const idx = t.objectStore('steps').index('guideId');
      return Promise.all(guides.map((g) => reqP(idx.getAll(g.id)).then((all) => all.filter((s) => s.type !== 'section').length)));
    });
    guides.forEach((g, i) => { g.stepCount = counts[i]; });
    guides.sort((a, b) => b.updatedAt - a.updatedAt);
    return guides;
  }

  function deleteGuide(id) {
    id = validId(id);
    return tx(['guides', 'steps'], 'readwrite', async (t) => {
      const keys = await reqP(t.objectStore('steps').index('guideId').getAllKeys(id));
      const steps = t.objectStore('steps');
      await Promise.all(keys.map((k) => reqP(steps.delete(k))));
      await reqP(t.objectStore('guides').delete(id));
    });
  }

  function touchGuide(t, guideId) {
    const store = t.objectStore('guides');
    return reqP(store.get(guideId)).then((g) => {
      if (!g) return;
      g.updatedAt = Date.now();
      return reqP(store.put(g));
    });
  }

  // ---- Schritte ----

  async function getSteps(guideId) {
    guideId = validId(guideId);
    const steps = await tx(['steps'], 'readonly', (t) =>
      reqP(t.objectStore('steps').index('guideId').getAll(guideId)));
    steps.sort((a, b) => (a.order - b.order) || (a.id - b.id));
    return steps;
  }

  function countSteps(guideId) {
    guideId = validId(guideId);
    return tx(['steps'], 'readonly', (t) => reqP(t.objectStore('steps').index('guideId').count(guideId)));
  }

  function getStep(id) {
    id = validId(id);
    return tx(['steps'], 'readonly', (t) => reqP(t.objectStore('steps').get(id)));
  }

  /** Hängt einen Schritt ans Ende der Anleitung an. */
  function addStep(step) {
    const guideId = validId(step.guideId);
    return tx(['steps', 'guides'], 'readwrite', async (t) => {
      const store = t.objectStore('steps');
      const existing = await reqP(store.index('guideId').getAll(guideId));
      const maxOrder = existing.reduce((m, s) => Math.max(m, s.order || 0), 0);
      const rec = { createdAt: Date.now(), ...step, guideId, order: step.order ?? maxOrder + 1 };
      delete rec.id;
      const id = await reqP(store.add(rec));
      await touchGuide(t, guideId);
      return { ...rec, id };
    });
  }

  function putStep(step) {
    validId(step.id);
    validId(step.guideId);
    return tx(['steps', 'guides'], 'readwrite', async (t) => {
      await reqP(t.objectStore('steps').put(step));
      await touchGuide(t, step.guideId);
    });
  }

  function putSteps(steps) {
    if (!steps.length) return Promise.resolve();
    const guideId = validId(steps[0].guideId);
    return tx(['steps', 'guides'], 'readwrite', async (t) => {
      const store = t.objectStore('steps');
      await Promise.all(steps.map((s) => reqP(store.put(s))));
      await touchGuide(t, guideId);
    });
  }

  async function deleteStep(id) {
    id = validId(id);
    return tx(['steps', 'guides'], 'readwrite', async (t) => {
      const store = t.objectStore('steps');
      const s = await reqP(store.get(id));
      if (!s) return null;
      await reqP(store.delete(id));
      await touchGuide(t, s.guideId);
      return s;
    });
  }

  /** Entfernt den Schritt mit der höchsten Reihenfolge. */
  async function deleteLastStep(guideId) {
    const steps = await getSteps(guideId);
    const last = steps[steps.length - 1];
    if (!last) return null;
    await deleteStep(last.id);
    return last;
  }

  /** Letzte n Schritte, neueste zuerst. */
  async function lastSteps(guideId, n) {
    const steps = await getSteps(guideId);
    return steps.slice(-n).reverse().map((s, i, arr) => ({ ...s, number: steps.length - i }));
  }

  return {
    open, addGuide, getGuide, putGuide, updateGuide, listGuides, deleteGuide,
    getSteps, countSteps, getStep, addStep, putStep, putSteps, deleteStep, deleteLastStep, lastSteps
  };
})();
