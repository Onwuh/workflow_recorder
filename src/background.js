/* Hintergrund: Aufnahmezustand, Screenshots, Speichern.
   Chrome: Service Worker (db.js und settings.js per importScripts).
   Firefox: Hintergrundseite, Skripte kommen über manifest.background.scripts. */
'use strict';

if (typeof DB === 'undefined') importScripts('db.js', 'settings.js');

const api = globalThis.browser ?? globalThis.chrome;

const CAPTURE_GAP_MS = 550;      // captureVisibleTab: max. 2 Aufrufe pro Sekunde in Chrome
const MAX_PENDING_CAPTURES = 3;  // Schutz gegen Klickfluten
const MAX_TEXT = 60;

// ---------- Aufnahmezustand (chrome.storage.session, überlebt Neustarts des Service Workers) ----------

async function getState() {
  const r = await api.storage.session.get('rec');
  return r.rec || null;
}

async function setState(rec) {
  if (rec) await api.storage.session.set({ rec });
  else await api.storage.session.remove('rec');
  await updateBadge(rec);
}

async function updateBadge(rec) {
  try {
    if (!rec) {
      await api.action.setBadgeText({ text: '' });
      return;
    }
    await api.action.setBadgeBackgroundColor({ color: rec.paused ? '#6B6E72' : '#C8372D' });
    if (api.action.setBadgeTextColor) await api.action.setBadgeTextColor({ color: '#FFFFFF' });
    await api.action.setBadgeText({ text: rec.paused ? 'II' : String(rec.count || 0) });
  } catch (_) { /* Badge ist nur Komfort */ }
}

function notifyTab(tabId, payload) {
  return api.tabs.sendMessage(tabId, payload, { frameId: 0 }).catch(() => {});
}

async function contentState(rec) {
  const settings = await Settings.get();
  return {
    type: 'state',
    recording: !!rec,
    paused: !!(rec && rec.paused),
    autoRedact: settings.autoRedact,
    keySteps: settings.keySteps,
    fields: settings.fields
  };
}

function guideTitle() {
  // Bewusst nicht der Seitentitel: der enthält oft Datensatznamen.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Neue Anleitung · ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isRecordableUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function hasHostPermission(url) {
  try {
    const origin = new URL(url).origin + '/*';
    return await api.permissions.contains({ origins: [origin] });
  } catch (_) {
    return false;
  }
}

// ---------- Aktionen ----------

/**
 * Einfügestelle in einer bestehenden Anleitung bestimmen.
 * afterStepId 0 = ganz am Anfang. Neue Schritte bekommen Reihenfolgewerte zwischen Anker und Nachfolger.
 */
async function insertPoint(guideId, afterStepId) {
  const guide = await DB.getGuide(guideId);
  if (!guide) return null;
  const steps = await DB.getSteps(guideId);
  let idx = -1;
  if (afterStepId) {
    idx = steps.findIndex((x) => x.id === afterStepId);
    if (idx < 0) return null;
  }
  const after = idx >= 0 ? steps[idx].order : (steps.length ? steps[0].order - 1 : 0);
  const next = idx + 1 < steps.length ? steps[idx + 1].order : null;
  // Sichtbare Nummer des Ankers (Abschnitte zählen nicht).
  const number = steps.slice(0, idx + 1).filter((x) => x.type !== 'section').length;
  return { anchor: after, after, next, number, title: String(guide.title || '').slice(0, 120) };
}

function nextInsertOrder(ins) {
  return ins.next == null ? ins.after + 1 : ins.after + (ins.next - ins.after) / 2;
}

async function getPendingInsert() {
  const r = await api.storage.session.get('pendingInsert');
  return r.pendingInsert || null;
}

async function start(tabId, target) {
  const existing = await getState();
  if (existing) return { ok: false, error: 'Es läuft bereits eine Aufnahme.' };

  let tab;
  if (tabId) tab = await api.tabs.get(tabId);
  else [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return { ok: false, error: 'Kein aktiver Tab gefunden.' };
  if (!isRecordableUrl(tab.url)) {
    return { ok: false, error: 'Auf dieser Seite kann nicht aufgenommen werden. Bitte eine Webseite (http/https) öffnen.' };
  }
  if (!(await hasHostPermission(tab.url))) {
    return { ok: false, error: 'permission' };
  }

  // Ohne ausdrückliches Ziel gilt eine im Editor vorgemerkte Einfügestelle.
  if (!target) target = await getPendingInsert();
  let insert = null;
  if (target && target.guideId) {
    insert = await insertPoint(target.guideId, target.afterStepId || 0);
    if (!insert) return { ok: false, error: 'Die Anleitung oder der Schritt zum Einfügen existiert nicht mehr.' };
  }

  // Content-Script nachladen, falls der Tab schon vor der Installation offen war.
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['src/content.js'] });
  } catch (_) {
    return { ok: false, error: 'Auf dieser Seite lässt der Browser keine Erweiterungen zu.' };
  }

  const guideId = insert ? target.guideId : (await DB.addGuide({ title: guideTitle() })).id;
  // Herkunft merken (nur lokal, nicht in Exporten), damit der Editor später dorthin zurückspringen kann.
  await DB.updateGuide(guideId, { sourceTabId: tab.id, sourceOrigin: safeOrigin(tab.url) }).catch(() => {});
  await api.storage.session.remove('pendingInsert');
  const rec = {
    guideId,
    tabId: tab.id,
    windowId: tab.windowId,
    startedAt: Date.now(),
    count: 0,
    paused: false,
    pausedMs: 0,
    pauseStart: 0,
    host: safeHost(tab.url),
    insert,       // null = neue Anleitung, sonst Einfügen in bestehende
    added: []     // in dieser Aufnahme erzeugte Schritte { id, order }
  };
  await setState(rec);
  await notifyTab(tab.id, await contentState(rec));
  return { ok: true, rec };
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

/** Tab, aus dem die Anleitung aufgenommen wurde; sonst ein offener Tab mit derselben Adresse. */
async function findSourceTab(guide) {
  if (!guide || !guide.sourceOrigin) return null;
  if (Number.isSafeInteger(guide.sourceTabId)) {
    const t = await api.tabs.get(guide.sourceTabId).catch(() => null);
    if (t && safeOrigin(t.url) === guide.sourceOrigin) return t;
  }
  const all = await api.tabs.query({});
  return all.find((t) => safeOrigin(t.url) === guide.sourceOrigin) || null;
}

/** Editor „Schritte danach aufnehmen“: zum Herkunfts-Tab springen und dort einfügen. */
async function insertHere(guideId, afterStepId) {
  const guide = await DB.getGuide(guideId);
  const tab = await findSourceTab(guide);
  if (!tab) {
    const ins = await insertPoint(guideId, afterStepId);
    if (!ins) return { ok: false };
    const pendingInsert = { guideId, afterStepId, number: ins.number, title: ins.title };
    await api.storage.session.set({ pendingInsert });
    return { ok: false, reason: 'no-tab', pendingInsert };
  }
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await sleep(200); // Tab muss sichtbar sein, bevor Screenshots möglich sind
  return start(tab.id, { guideId, afterStepId });
}

function safeHost(url) {
  try { return new URL(url).host.slice(0, 120); } catch (_) { return ''; }
}

async function stop({ openEditor = true } = {}) {
  const rec = await getState();
  if (!rec) return { ok: false };
  await setState(null);
  await notifyTab(rec.tabId, await contentState(null));
  const count = await DB.countSteps(rec.guideId).catch(() => 0);
  if (count === 0 && !rec.insert) {
    // Leere Aufnahmen nicht als Anleitung behalten.
    await DB.deleteGuide(rec.guideId).catch(() => {});
    return { ok: true, empty: true };
  }
  if (openEditor && (count > 0)) {
    await api.tabs.create({ url: api.runtime.getURL(`src/editor/editor.html?guide=${rec.guideId}`) });
  }
  return { ok: true, guideId: rec.guideId };
}

async function setPaused(paused) {
  const rec = await getState();
  if (!rec || rec.paused === paused) return { ok: !!rec, rec };
  const now = Date.now();
  if (paused) {
    rec.paused = true;
    rec.pauseStart = now;
  } else {
    rec.paused = false;
    rec.pausedMs += Math.max(0, now - (rec.pauseStart || now));
    rec.pauseStart = 0;
  }
  await setState(rec);
  await notifyTab(rec.tabId, await contentState(rec));
  return { ok: true, rec };
}

async function discardLast() {
  const rec = await getState();
  if (!rec) return { ok: false };
  const added = rec.added || [];
  const last = added.pop();
  if (last) await DB.deleteStep(last.id).catch(() => {});
  if (rec.insert) rec.insert.after = added.length ? added[added.length - 1].order : rec.insert.anchor;
  rec.added = added;
  rec.count = added.length;
  await setState(rec);
  return { ok: true, rec };
}

/** Nach Löschen in der Seitenleiste: nur noch vorhandene Schritte zählen. */
async function recount() {
  const rec = await getState();
  if (!rec) return { ok: false };
  const alive = new Set((await DB.getSteps(rec.guideId)).map((x) => x.id));
  rec.added = (rec.added || []).filter((a) => alive.has(a.id));
  rec.count = rec.added.length;
  if (rec.insert) rec.insert.after = rec.added.length ? rec.added[rec.added.length - 1].order : rec.insert.anchor;
  await setState(rec);
  return { ok: true, rec };
}

// ---------- Screenshots ----------

let captureChain = Promise.resolve();
let lastCaptureAt = 0;
let pendingCaptures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Screenshot mit Mindestabstand. `around` misst direkt vor und nach der Aufnahme
 * (Schwärzungsflächen), damit Messung und Bild so nah wie möglich beieinander liegen.
 */
function captureSerialized(windowId, around) {
  const run = captureChain.then(async () => {
    const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const before = await around();
    try {
      const dataUrl = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
      const after = await around();
      return { dataUrl, before, after };
    } finally {
      lastCaptureAt = Date.now();
    }
  });
  captureChain = run.catch(() => {});
  return run;
}

/** Fragt das Content-Script nach Schwärzungsflächen. null, wenn es nicht antwortet (z. B. Seite lädt neu). */
async function measureTab(tabId) {
  try {
    const r = await Promise.race([
      api.tabs.sendMessage(tabId, { type: 'measure' }, { frameId: 0 }),
      sleep(400).then(() => null)
    ]);
    return r && Array.isArray(r.rects) ? r : null;
  } catch (_) {
    return null;
  }
}

/** Prüft die gemeldeten Flächen und rechnet sie in Bildpixel um. */
function sanitizeRedactions(list, info, imgW, imgH) {
  const k = imgW / info.vw;
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list.slice(0, 800) : []) {
    if (!r || typeof r !== 'object') continue;
    const x = num(r.x, 0, info.vw, NaN);
    const y = num(r.y, -1e5, 1e5, NaN);
    const w = num(r.w, 0, info.vw, NaN);
    const h = num(r.h, 0, 1e5, NaN);
    if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) continue;
    // Auf das Bild begrenzen
    const y1 = Math.max(0, y);
    const y2 = Math.min(info.vh, y + h);
    if (y2 - y1 < 1) continue;
    const rr = { x: Math.floor(x * k), y: Math.floor(y1 * k), w: Math.ceil(w * k), h: Math.ceil((y2 - y1) * k), auto: true };
    const key = `${rr.x},${rr.y},${rr.w},${rr.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rr);
  }
  return out;
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('Unerwartetes Screenshot-Format');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// ---------- Eingaben aus dem Content-Script prüfen ----------

function num(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(v) {
  if (typeof v !== 'string') return '';
  // Steuerzeichen raus, Leerraum zusammenfassen.
  let t = v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT - 1).trimEnd() + '…';
  return t;
}

function sanitizeStepInfo(s) {
  s = s && typeof s === 'object' ? s : {};
  const vw = num(s.vw, 1, 100000, 1);
  const vh = num(s.vh, 1, 100000, 1);
  return {
    kind: ['click', 'input'].includes(s.kind) ? s.kind : 'click',
    text: cleanText(s.text) || 'Klicke an die markierte Stelle',
    x: num(s.x, 0, vw, 0),
    y: num(s.y, 0, vh, 0),
    vw,
    vh,
    dpr: num(s.dpr, 0.25, 10, 1),
    showMarker: s.kind !== 'input'
  };
}

async function onStep(msg, sender) {
  const rec = await getState();
  if (!rec || rec.paused || sender.tab.id !== rec.tabId) return { ok: false, reason: 'not-recording' };
  if (pendingCaptures >= MAX_PENDING_CAPTURES) return { ok: false, reason: 'busy' };

  const info = sanitizeStepInfo(msg.step);
  pendingCaptures++;
  try {
    const tab = await api.tabs.get(rec.tabId);
    if (!tab.active) return { ok: false, reason: 'inactive' };
    const shot = await captureSerialized(tab.windowId, () => measureTab(rec.tabId));
    // Antwortet das Content-Script nicht (Seite lädt neu), ist die Schwärzung unsicher:
    // Schritt dann zur Prüfung markieren.
    const tabAfter = await api.tabs.get(rec.tabId).catch(() => null);
    const navigated = !shot.before || !shot.after || !tabAfter || tabAfter.status === 'loading';
    const image = dataUrlToBlob(shot.dataUrl);
    const unredacted = Math.round(num(Math.max(shot.before ? shot.before.unredacted : 0, shot.after ? shot.after.unredacted : 0), 0, 999, 0));
    let imgW = Math.round(info.vw * info.dpr);
    let imgH = Math.round(info.vh * info.dpr);
    try {
      const bmp = await createImageBitmap(image);
      imgW = bmp.width;
      imgH = bmp.height;
      bmp.close();
    } catch (_) { /* Maße geschätzt */ }
    // Ein Maßstab für beide Achsen (Gerätepixel pro CSS-Pixel). Ist der Screenshot niedriger als
    // innerHeight, ist er abgeschnitten, nicht gestaucht: sichtbare Höhe aus dem Bild ableiten.
    const scale = imgW / info.vw;
    info.vh = imgH / scale;
    info.y = Math.min(info.y, info.vh);

    // Aufnahme könnte inzwischen beendet worden sein.
    const now = await getState();
    if (!now || now.guideId !== rec.guideId || now.paused) return { ok: false, reason: 'stopped' };

    const order = now.insert ? nextInsertOrder(now.insert) : undefined;
    const saved = await DB.addStep({
      guideId: rec.guideId,
      order,
      type: 'step',
      kind: info.kind,
      text: info.text,
      note: '',
      x: info.x, y: info.y, vw: info.vw, vh: info.vh, dpr: info.dpr,
      imgW, imgH,
      image,
      showMarker: info.showMarker,
      annotations: [],
      // Vereinigung aus Messung vor und nach dem Screenshot, falls sich die Seite dazwischen ändert.
      redactions: sanitizeRedactions([
        ...(shot.before ? shot.before.rects : []),
        ...(shot.after ? shot.after.rects : [])
      ], info, imgW, imgH),
      unredacted: navigated ? Math.max(1, unredacted) : unredacted,
      navigated,
      reviewed: !navigated && unredacted === 0
    });
    now.added = (now.added || []).concat({ id: saved.id, order: saved.order });
    if (now.insert) now.insert.after = saved.order;
    now.count = now.added.length;
    await setState(now);
    return { ok: true, count: now.count };
  } catch (e) {
    return { ok: false, reason: 'capture-failed', error: String(e && e.message || e) };
  } finally {
    pendingCaptures--;
  }
}

// ---------- Nachrichten ----------

const EXT_ORIGIN = api.runtime.getURL('');

function fromExtensionPage(sender) {
  return sender.id === api.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(EXT_ORIGIN);
}

function fromContentScript(sender) {
  return sender.id === api.runtime.id && sender.tab && sender.tab.id != null && sender.frameId === 0 &&
    typeof sender.url === 'string' && !sender.url.startsWith(EXT_ORIGIN);
}

async function handle(msg, sender) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return { ok: false };

  if (fromContentScript(sender)) {
    switch (msg.type) {
      case 'hello': {
        const rec = await getState();
        const mine = rec && rec.tabId === sender.tab.id ? rec : null;
        return contentState(mine);
      }
      case 'step':
        return onStep(msg, sender);
      default:
        return { ok: false };
    }
  }

  if (fromExtensionPage(sender)) {
    switch (msg.type) {
      case 'status': return { ok: true, rec: await getState(), pendingInsert: await getPendingInsert() };
      case 'start': {
        const tabId = Number.isSafeInteger(msg.tabId) ? msg.tabId : undefined;
        const target = Number.isSafeInteger(msg.guideId) && msg.guideId > 0
          ? { guideId: msg.guideId, afterStepId: Number.isSafeInteger(msg.afterStepId) && msg.afterStepId > 0 ? msg.afterStepId : 0 }
          : (msg.newGuide === true ? { guideId: 0 } : undefined);
        return start(tabId, target);
      }
      case 'set-insert': {
        if (!Number.isSafeInteger(msg.guideId) || msg.guideId <= 0) return { ok: false };
        const afterStepId = Number.isSafeInteger(msg.afterStepId) && msg.afterStepId > 0 ? msg.afterStepId : 0;
        const ins = await insertPoint(msg.guideId, afterStepId);
        if (!ins) return { ok: false };
        const pendingInsert = { guideId: msg.guideId, afterStepId, number: ins.number, title: ins.title };
        await api.storage.session.set({ pendingInsert });
        return { ok: true, pendingInsert };
      }
      case 'insert-here': {
        if (!Number.isSafeInteger(msg.guideId) || msg.guideId <= 0) return { ok: false };
        const afterStepId = Number.isSafeInteger(msg.afterStepId) && msg.afterStepId > 0 ? msg.afterStepId : 0;
        return insertHere(msg.guideId, afterStepId);
      }
      case 'clear-insert':
        await api.storage.session.remove('pendingInsert');
        return { ok: true };
      case 'stop': return stop({ openEditor: msg.openEditor !== false });
      case 'recount': return recount();
      case 'pause': return setPaused(true);
      case 'resume': return setPaused(false);
      case 'discard': return discardLast();
      case 'settings-changed': {
        const rec = await getState();
        if (rec) await notifyTab(rec.tabId, await contentState(rec));
        return { ok: true };
      }
      default: return { ok: false };
    }
  }

  return { ok: false };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// ---------- Symbol und Seitenleiste ----------

// Zwischengespeichert, weil sidebarAction.open()/sidePanel.open() nur synchron in der Nutzeraktion erlaubt sind.
let openSidebarSetting = Settings.DEFAULTS.openSidebar;

async function applyActionBehavior() {
  const s = await Settings.get();
  openSidebarSetting = s.openSidebar;
  try {
    // Ohne Popup löst der Klick aufs Symbol die Seitenleiste aus.
    await api.action.setPopup({ popup: s.openSidebar ? '' : 'src/popup/popup.html' });
    if (api.sidePanel && api.sidePanel.setPanelBehavior) {
      await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: s.openSidebar });
    }
  } catch (_) { /* ältere Browser: Popup bleibt */ }
}

/** Seitenleiste öffnen, synchron aus einer Nutzeraktion heraus aufrufen. */
function openSidebarNow(windowId) {
  try {
    if (api.sidePanel && api.sidePanel.open && windowId != null) {
      api.sidePanel.open({ windowId }).catch(() => {});
    } else if (globalThis.browser && browser.sidebarAction) {
      browser.sidebarAction.open().catch(() => {});
    }
  } catch (_) { /* nicht unterstützt */ }
}

// Firefox: ohne Popup kommt der Klick hier an.
api.action.onClicked.addListener((tab) => {
  if (globalThis.browser && browser.sidebarAction) {
    try { browser.sidebarAction.toggle(); } catch (_) { /* ignorieren */ }
  } else if (api.sidePanel && api.sidePanel.open && tab) {
    api.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applyActionBehavior();
});
api.runtime.onInstalled.addListener(() => applyActionBehavior());
if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => applyActionBehavior());
applyActionBehavior();

api.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  // Vor jedem await: sonst gilt die Nutzeraktion als verbraucht.
  if (openSidebarSetting) openSidebarNow(tab && tab.windowId);
  const rec = await getState();
  if (rec) {
    await stop({ openEditor: !openSidebarSetting });
  } else {
    const r = await start(tab && tab.id);
    if (!r.ok && r.error === 'permission') {
      // Ohne Popup kann keine Berechtigung angefragt werden, Einstellungen öffnen.
      api.runtime.openOptionsPage();
    }
  }
});

api.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getState();
  if (rec && rec.tabId === tabId) await stop({ openEditor: false });
});

// Badge nach Neustart des Service Workers wiederherstellen.
getState().then(updateBadge).catch(() => {});
