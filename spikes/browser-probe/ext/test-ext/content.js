// Content script: marks the document, round-trips a message to the service worker, reports what the content-script
// world sees of chrome.*.
(async () => {
  document.documentElement.dataset.probeContentScript = '1';
  const report = { trigger: 'content-script', url: location.href, present: {}, results: [] };
  for (const ns of ['runtime', 'storage', 'i18n', 'tabs', 'scripting']) report.present[ns] = typeof chrome[ns];
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'hello', from: 'content-script' });
    report.results.push({ name: 'runtime.sendMessage -> sw', ok: true, value: reply });
  } catch (e) {
    report.results.push({ name: 'runtime.sendMessage -> sw', ok: false, error: String(e && e.message ? e.message : e) });
  }
  chrome.runtime.sendMessage({ type: 'run-report' }).catch(() => {});
  try {
    await chrome.storage.local.set({ fromContent: 1 });
    report.results.push({ name: 'storage.local.set (content)', ok: true, value: (await chrome.storage.local.get('fromContent')).fromContent });
  } catch (e) {
    report.results.push({ name: 'storage.local.set (content)', ok: false, error: String(e && e.message ? e.message : e) });
  }
  await fetch('http://127.0.0.1:17333/ext-report?from=cs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
})();
