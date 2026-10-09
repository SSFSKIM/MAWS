// The probe popup (board #90 S1): prints what the extension's background answers to a ping and what
// chrome.tabs.query({ active: true, currentWindow: true }) answers here, and leaves both on window.__popupResult for the
// spike (or an e2e) to read. Callback forms throughout so the same page runs under MV2 and MV3.
const call = (fn, ...args) => new Promise((resolve) => {
  try {
    fn(...args, (value) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { error: error.message } : { value });
    });
  } catch (e) {
    resolve({ error: String(e && e.message ? e.message : e) });
  }
});
const within = (ms, p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ error: `no answer in ${ms} ms` }), ms))]);

function connectPing() {
  return new Promise((resolve) => {
    let port;
    try { port = chrome.runtime.connect({ name: 'probe-popup' }); } catch (e) { resolve({ error: String(e && e.message ? e.message : e) }); return; }
    const timer = setTimeout(() => resolve({ error: 'no message in 2000 ms' }), 2000);
    port.onMessage.addListener((value) => { clearTimeout(timer); resolve({ value }); port.disconnect(); });
    port.onDisconnect.addListener(() => { clearTimeout(timer); resolve({ error: `disconnected: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no listener'}` }); });
    port.postMessage({ ping: 1 });
  });
}

(async () => {
  const result = {
    api: {
      action: typeof chrome.action,
      browserAction: typeof chrome.browserAction,
      tabs: typeof chrome.tabs,
      windows: typeof chrome.windows,
      openOptionsPage: typeof (chrome.runtime && chrome.runtime.openOptionsPage),
    },
  };
  result.ping = await within(3000, call(chrome.runtime.sendMessage, { ping: 1 }));
  result.connect = await connectPing();
  result.tabsActive = chrome.tabs ? await within(3000, call(chrome.tabs.query, { active: true, currentWindow: true })) : { error: 'chrome.tabs undefined' };
  result.tabsAll = chrome.tabs ? await within(3000, call(chrome.tabs.query, {})) : { error: 'chrome.tabs undefined' };
  if (result.tabsAll.value) result.tabsAll.value = result.tabsAll.value.map((t) => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url }));
  if (result.tabsActive.value) result.tabsActive.value = result.tabsActive.value.map((t) => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url }));
  document.getElementById('out').textContent = `sendMessage: ${JSON.stringify(result.ping)}\ntabs.query(active, currentWindow): ${JSON.stringify(result.tabsActive)}`;
  window.__popupResult = result;
})();
