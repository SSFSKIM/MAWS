// The window page: hosts the viewer frames (architecture A) or the slot a view follows (B). Main drives it through
// executeJavaScript on `harness`; it reaches main only through the preload's one name.
'use strict';
const frames = new Map(); // id -> { el, host, messages: [], waiters: [] }
const pointer = [];
let reqSeq = 0;

const ticks = [];
setInterval(() => { ticks.push(performance.now()); if (ticks.length > 4000) ticks.splice(0, 2000); }, 100);

window.addEventListener('message', (event) => {
  for (const [id, f] of frames) {
    if (event.source !== f.el.contentWindow) continue;
    const m = event.data;
    f.messages.push({ at: performance.now(), m });
    for (const w of f.waiters.slice()) if (w.match(m)) { f.waiters.splice(f.waiters.indexOf(w), 1); w.resolve(m); }
    return;
  }
});

function waitMessage(id, match, timeoutMs) {
  const f = frames.get(id);
  const seen = f.messages.find((x) => match(x.m));
  if (seen) return Promise.resolve(seen.m);
  return new Promise((resolve, reject) => {
    const w = { match, resolve };
    f.waiters.push(w);
    setTimeout(() => { const i = f.waiters.indexOf(w); if (i >= 0) { f.waiters.splice(i, 1); reject(new Error(`no message within ${timeoutMs} ms`)); } }, timeoutMs);
  });
}

const harness = {
  addFrame(id, { host, format = 'docx', page = 'viewer.html', sandbox = 'allow-scripts', width, height, src, referrerPolicy }) {
    const el = document.createElement('iframe');
    if (sandbox !== null) el.setAttribute('sandbox', sandbox);
    if (width) el.style.width = `${width}px`;
    if (height) el.style.height = `${height}px`;
    if (referrerPolicy) el.referrerPolicy = referrerPolicy;
    el.src = src ?? `maws-viewer://${host}/${page}?format=${format}`;
    el.addEventListener('mouseenter', () => pointer.push({ id, type: 'mouseenter', at: performance.now() }));
    el.addEventListener('mouseleave', () => pointer.push({ id, type: 'mouseleave', at: performance.now() }));
    frames.set(id, { el, host, messages: [], waiters: [] });
    document.getElementById('frames').append(el);
    return waitMessage(id, (m) => m.type === 'ready', 15000);
  },
  removeFrame(id) { const f = frames.get(id); if (f) { f.el.remove(); frames.delete(id); } return true; },
  post(id, message, transfer) { frames.get(id).el.contentWindow.postMessage(message, '*', transfer ?? []); return true; },
  wait(id, type, timeoutMs = 15000) { return waitMessage(id, (m) => m.type === type, timeoutMs); },
  messages(id) { return frames.get(id)?.messages.map((x) => x.m.type) ?? []; },
  lastProgress(id) { return frames.get(id)?.messages.filter((x) => x.m.type === 'progress').map((x) => x.m.name).slice(-3) ?? []; },
  async test(id, name, args = {}, timeoutMs = 60000) {
    const reqId = ++reqSeq;
    harness.post(id, { type: 'test', name, args, reqId });
    const reply = await waitMessage(id, (m) => m.type === 'reply' && m.reqId === reqId, timeoutMs);
    return reply.result;
  },
  // The hand-over: main says whether the frame has a process of its own; bytes go only if it has.
  async handOver(id, bytes) {
    const f = frames.get(id);
    const check = await window.maws.checkFrame(f.host);
    if (!check || check.shared !== false) return { handed: false, check };
    f.el.contentWindow.postMessage({ type: 'file', bytes }, '*');
    return { handed: true, check };
  },
  // Ticks of the window's 100 ms timer since `since`: count and the longest gap.
  tickStats(since) {
    const t = ticks.filter((x) => x >= since);
    let gap = 0;
    for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
    if (t.length) gap = Math.max(gap, performance.now() - t[t.length - 1]);
    return { count: t.length, maxGapMs: Math.round(gap) };
  },
  now() { return performance.now(); },
  async pingLoop(id, { everyMs = 500, boundMs = 3000, forMs = 8000 }) {
    // The window's watchdog: a ping every `everyMs`; tripped when no answer arrives within `boundMs` of a ping.
    const f = frames.get(id);
    const start = performance.now();
    let n = 0, answered = 0, trippedAt = null;
    while (performance.now() - start < forMs && trippedAt === null) {
      const sent = ++n;
      const at = performance.now();
      f.el.contentWindow.postMessage({ type: 'ping', n: sent }, '*');
      try { await waitMessage(id, (m) => m.type === 'pong' && m.n === sent, boundMs); answered++; }
      catch { trippedAt = Math.round(performance.now() - start); break; }
      await new Promise((r) => setTimeout(r, Math.max(0, everyMs - (performance.now() - at))));
    }
    return { pings: n, answered, trippedAtMs: trippedAt, boundMs };
  },
  // Condition 13: a 25 MiB buffer, transferred.
  sendBig(id, mib = 25) {
    const buffer = new ArrayBuffer(mib << 20);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i += 65536) view[i] = (i >> 16) & 0xff;
    view[0] = 1; view[view.length - 1] = 2;
    let sum = 0;
    for (let i = 0; i < view.length; i += 65536) sum = (sum + view[i]) | 0;
    const t0 = performance.timeOrigin + performance.now();
    frames.get(id).el.contentWindow.postMessage({ type: 'big', buffer }, '*', [buffer]);
    const t0end = performance.timeOrigin + performance.now();
    return { t0, postMs: t0end - t0, detached: buffer.byteLength === 0, bytes: mib << 20, sum };
  },
  frameRect(id) { const r = frames.get(id).el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
  activeIsFrame(id) { return document.activeElement === frames.get(id)?.el; },
  activeElement() { const a = document.activeElement; return a ? `${a.tagName}${a.id ? '#' + a.id : ''}` : null; },
  pointerEvents() { return pointer.slice(); },
  clearPointer() { pointer.length = 0; return true; },
  field() { return document.getElementById('field').value; },
  focusField() { const f = document.getElementById('field'); f.value = ''; f.focus(); return document.activeElement === f; },
  windowKeys: [],
  // B: the slot a view follows.
  slotRect() { const r = document.getElementById('slot').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
  showSlot(on) { document.body.classList.toggle('view', on); harness.reportSlot(); return harness.slotRect(); },
  reportSlot() { const r = harness.slotRect(); window.maws.reportSlot(r); return r; },
  setSide(px) { document.documentElement.style.setProperty('--side', `${px}px`); return harness.reportSlot(); },
  menu(open) { document.body.classList.toggle('menu', open); window.maws.menu(open); return open; },
  cspCheck() {
    // Is the window's own policy in force? An inline script must not run.
    return new Promise((resolve) => {
      let violated = null;
      document.addEventListener('securitypolicyviolation', (e) => { violated = e.effectiveDirective; }, { once: true });
      const s = document.createElement('script');
      s.textContent = 'window.__windowInline = 1';
      document.body.append(s);
      setTimeout(() => resolve({ inlineRan: window.__windowInline === 1, violated }), 200);
    });
  },
};
window.harness = harness;
window.addEventListener('keydown', (e) => harness.windowKeys.push(`${e.ctrlKey ? 'Ctrl+' : ''}${e.metaKey ? 'Meta+' : ''}${e.key}`), true);
// The side column's edge, dragged with the pointer.
{
  const edge = document.getElementById('edge');
  let dragging = false;
  edge.addEventListener('pointerdown', (e) => { dragging = true; edge.setPointerCapture(e.pointerId); });
  edge.addEventListener('pointermove', (e) => { if (dragging) harness.setSide(Math.max(80, Math.round(e.clientX))); });
  edge.addEventListener('pointerup', () => { dragging = false; });
}
new ResizeObserver(() => { if (document.body.classList.contains('view')) harness.reportSlot(); }).observe(document.getElementById('slot'));
