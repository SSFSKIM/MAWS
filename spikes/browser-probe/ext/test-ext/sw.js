// MV3 background service worker. Reports what exists and what works to the probe's local server.
const REPORT = 'http://127.0.0.1:17333/ext-report?from=sw';

const NAMESPACES = [
  'runtime', 'storage', 'tabs', 'scripting', 'action', 'alarms', 'cookies', 'webRequest', 'declarativeNetRequest',
  'webNavigation', 'contextMenus', 'notifications', 'offscreen', 'sidePanel', 'windows', 'tabGroups', 'identity',
  'history', 'bookmarks', 'downloads', 'commands', 'management', 'i18n', 'permissions', 'debugger', 'proxy', 'privacy',
  'extension', 'webRequestAuthProvider', 'sessions', 'favicon', 'search', 'topSites',
];

async function attempt(name, fn) {
  try {
    const value = await fn();
    return { name, ok: true, value };
  } catch (e) {
    return { name, ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function run(trigger) {
  const present = {};
  for (const ns of NAMESPACES) present[ns] = typeof chrome[ns];
  const results = [];
  results.push(await attempt('storage.local.set+get', async () => {
    await chrome.storage.local.set({ probe: 'value-' + Date.now() });
    const got = await chrome.storage.local.get('probe');
    return typeof got.probe;
  }));
  results.push(await attempt('storage.session.set+get', async () => {
    await chrome.storage.session.set({ s: 1 });
    return (await chrome.storage.session.get('s')).s;
  }));
  results.push(await attempt('tabs.query', async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, url: t.url, active: t.active }));
  }));
  results.push(await attempt('scripting.executeScript', async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => (t.url || '').startsWith('http://127.0.0.1:17333/'));
    if (!tab) throw new Error('no probe tab in tabs.query');
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { document.documentElement.dataset.probeExecuteScript = '1'; return document.title; } });
    return r.map((x) => x.result);
  }));
  results.push(await attempt('alarms.create', async () => { await chrome.alarms.create('probe', { delayInMinutes: 1 }); return (await chrome.alarms.getAll()).length; }));
  results.push(await attempt('cookies.getAll', async () => (await chrome.cookies.getAll({ domain: 'localhost' })).length));
  results.push(await attempt('action.setTitle', async () => { await chrome.action.setTitle({ title: 'probe' }); return 'set'; }));
  results.push(await attempt('contextMenus.create', async () => new Promise((res, rej) => { chrome.contextMenus.create({ id: 'probe', title: 'probe' }, () => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res('created')); })));
  results.push(await attempt('declarativeNetRequest.getDynamicRules', async () => (await chrome.declarativeNetRequest.getDynamicRules()).length));
  results.push(await attempt('webNavigation.getAllFrames', async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => (t.url || '').startsWith('http://127.0.0.1:17333/'));
    if (!tab) throw new Error('no probe tab');
    return (await chrome.webNavigation.getAllFrames({ tabId: tab.id })).length;
  }));
  results.push(await attempt('webRequest.onBeforeRequest.addListener', async () => { chrome.webRequest.onBeforeRequest.addListener(() => {}, { urls: ['http://127.0.0.1/*'] }); return 'added'; }));
  results.push(await attempt('notifications.create', async () => new Promise((res, rej) => chrome.notifications.create('probe', { type: 'basic', title: 'p', message: 'p', iconUrl: 'x.png' }, (id) => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(id)))));
  results.push(await attempt('offscreen.createDocument', async () => { await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'probe' }); return 'created'; }));
  results.push(await attempt('sidePanel.setOptions', async () => { await chrome.sidePanel.setOptions({ path: 'panel.html' }); return 'set'; }));
  results.push(await attempt('runtime.getManifest', async () => chrome.runtime.getManifest().name));
  results.push(await attempt('runtime.getURL', async () => chrome.runtime.getURL('x')));
  results.push(await attempt('runtime.connectNative', async () => { chrome.runtime.connectNative('com.example.absent'); return 'connected?'; }));

  await fetch(REPORT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger, present, results }) }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'run-report') run('message-after-page');
  sendResponse({ echo: msg, fromTab: sender.tab ? sender.tab.id : null, swSawMessage: true });
  return false;
});

// cua #90 (from its S1 spike): an answerer for the popup's chrome.runtime.connect
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => port.postMessage({ pong: msg && msg.ping, from: 'service-worker', via: 'port' }));
});

chrome.runtime.onInstalled.addListener(() => run('onInstalled'));
run('startup');
