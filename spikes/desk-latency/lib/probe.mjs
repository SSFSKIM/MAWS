// The in-page half of the harness: installed into the page under test with page.evaluate, or with addInitScript before
// a navigation, so every mark is taken in the page on its own clock (performance.now(), ms since the navigation began)
// whatever the delay of the CDP hop between the page and the script driving it. Nothing is drawn and nothing is sent.
//
// Two kinds of mark:
//   - the user's input: every pointerdown, mousedown, click, keydown, submit, wheel and visibilitychange the page sees, in the
//     capture phase before the app's own handlers, with the event's own timeStamp (when the browser took the input);
//   - a visible effect: a condition on the DOM (`arm(spec)`), checked on every mutation; `seen` is when the mutation that
//     met it was observed, `paint` the next animation frame after it — the frame that paints it, as the desk's own
//     instrument draws a sample (apps/desk-web/src/latency/latency.ts).
//
// A spec: { selector, within?, text?, textMatch?, attr?: [name, value], minText?, count? } met when at least `count`
// (default 1) elements match; with `gone: true`, when none does; with `fresh: true`, when one matches that did not when
// armed; with `changed: true`, when the matches' text differs from what it was when armed. A spec already met when
// armed is marked `already` (its mark means nothing); with `grows: true`, when the first match's scrollHeight is greater
// than when armed (a list that took rows in above or below). `{ all: [spec, …] }` is met when every one of its specs is,
// `{ any: [spec, …] }` when one is (each plain, `gone`, or another all/any): content and the controls that make it
// usable, say. A load that starts with a navigation hands its specs over
// sessionStorage['deskLat.cold'] (JSON array), which the init script arms before the page's own scripts run.
export function deskLatProbe() {
  if (window.top !== window) return 'frame'; // an init script runs in every frame; the marks are the top page's
  if (window.__deskLat) return 'present';
  const inputs = [];
  const waits = new Map();
  let seq = 0;
  const textOf = (el) => el.textContent || '';
  const matches = (spec) => {
    const root = spec.within ? document.querySelector(spec.within) : document;
    if (!root) return [];
    let els = [...root.querySelectorAll(spec.selector)];
    if (spec.text != null) els = els.filter((el) => textOf(el).includes(spec.text));
    if (spec.textMatch != null) {
      const re = new RegExp(spec.textMatch);
      els = els.filter((el) => re.test(textOf(el)));
    }
    if (spec.attr) els = els.filter((el) => el.getAttribute(spec.attr[0]) === spec.attr[1]);
    if (spec.minText != null) els = els.filter((el) => textOf(el).trim().length >= spec.minText);
    return els;
  };
  const textSum = (els) => els.map(textOf).join('\u0000');
  const holds = (s) => (s.all ? s.all.every(holds) : s.any ? s.any.some(holds) : s.gone ? matches(s).length === 0 : matches(s).length >= (s.count || 1));
  const met = (w) => {
    if (w.spec.all || w.spec.any) return holds(w.spec);
    const els = matches(w.spec);
    if (w.spec.gone) return els.length === 0;
    if (w.spec.fresh) return els.some((el) => !w.before.has(el));
    if (w.spec.changed) return textSum(els) !== w.text;
    if (w.spec.grows) return els.length > 0 && els[0].scrollHeight > w.height;
    return els.length >= (w.spec.count || 1);
  };
  const scan = () => {
    const t = performance.now();
    for (const w of waits.values()) {
      if (w.seen !== null) continue;
      let ok = false;
      try {
        ok = met(w);
      } catch (error) {
        w.error = String(error);
      }
      if (!ok) continue;
      w.seen = t;
      requestAnimationFrame(() => {
        w.paint = performance.now();
      });
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  // The page's WebSockets, kept so a reconnect can be caused: Chrome's offline emulation fails new connections but
  // leaves open sockets open, so a drop is the network taken away and every socket closed. Only those opened after the
  // probe is in are known: a load that drops them installs it before the page's own code (an init script).
  const sockets = new Set();
  const Native = window.WebSocket;
  if (Native && !Native.deskLat) {
    const Tracked = class extends Native {
      constructor(...args) {
        super(...args);
        sockets.add(this);
        this.addEventListener('close', () => sockets.delete(this));
      }
    };
    Tracked.deskLat = true;
    window.WebSocket = Tracked;
  }
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'submit', 'wheel']) {
    addEventListener(
      type,
      (e) => {
        inputs.push({ type, t: e.timeStamp, key: e.key ?? null, trusted: e.isTrusted, tag: e.target?.tagName ?? null });
        if (inputs.length > 200) inputs.shift();
      },
      { capture: true, passive: true },
    );
  }
  document.addEventListener('visibilitychange', (e) => inputs.push({ type: `visibility:${document.visibilityState}`, t: e.timeStamp, key: null, trusted: e.isTrusted, tag: null }), { capture: true });
  addEventListener('online', (e) => inputs.push({ type: 'online', t: e.timeStamp, key: null, trusted: e.isTrusted, tag: null }), { capture: true });
  addEventListener('offline', (e) => inputs.push({ type: 'offline', t: e.timeStamp, key: null, trusted: e.isTrusted, tag: null }), { capture: true });
  const api = {
    version: 1,
    origin: performance.timeOrigin,
    now: () => performance.now(),
    arm(spec) {
      const id = ++seq;
      const w = { id, spec, armed: performance.now(), seen: null, paint: null, already: false, before: new WeakSet(), text: '', height: 0, error: null };
      try {
        if (spec.fresh) for (const el of matches(spec)) w.before.add(el);
        else if (spec.changed) w.text = textSum(matches(spec));
        else if (spec.grows) w.height = matches(spec)[0]?.scrollHeight ?? 0;
        else if (met(w)) {
          w.already = true;
          w.seen = w.armed;
          w.paint = w.armed;
        }
      } catch (error) {
        w.error = String(error);
      }
      waits.set(id, w);
      return id;
    },
    read(ids) {
      return ids.map((id) => {
        const w = waits.get(id);
        return w ? { id, armed: w.armed, seen: w.seen, paint: w.paint, already: w.already, error: w.error } : null;
      });
    },
    drop(ids) {
      for (const id of ids) waits.delete(id);
    },
    inputs(since) {
      return inputs.filter((i) => i.t >= since);
    },
    /**
     * Whether a plain, `gone` or `all` spec is met now (`met`), and the elements it matches: how many, and the first's
     * (or with `last`, the last's) text and data attributes.
     */
    query(spec) {
      const now = spec.all || spec.any || spec.gone ? holds(spec) : null;
      const els = spec.all || spec.any ? [] : matches(spec);
      const el = spec.last ? els[els.length - 1] : els[0];
      const attrs = el ? Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'href' || a.name === 'aria-label').map((a) => [a.name, a.value.slice(0, 200)])) : null;
      return { met: now ?? els.length >= (spec.count || 1), n: els.length, text: el ? textOf(el).slice(0, 200) : null, attrs };
    },
    /**
     * Drops every WebSocket the page opened since the probe was in, as a lost network does: each is closed, and its
     * close is told to the app at once (an abnormal close, 1006) rather than after a closing handshake, which a lost
     * network never completes and Chrome waits out. How many it dropped.
     */
    dropSockets() {
      const open = [...sockets];
      for (const ws of open) {
        ws.close(4000, 'desk-latency: a drop');
        ws.dispatchEvent(new CloseEvent('close', { code: 1006, reason: 'desk-latency: a drop', wasClean: false }));
        sockets.delete(ws);
      }
      return open.length;
    },
    /**
     * Scrolls the first match of `spec` to its top, as a reader does to read back; the time it did, on the page's clock.
     * A list already at its top is nudged first, so the scroll an app pages on is seen.
     */
    scrollTop(spec) {
      const el = matches(spec)[0];
      if (!el) return null;
      if (el.scrollTop === 0) el.scrollTop = 1;
      const t = performance.now();
      el.scrollTop = 0;
      return t;
    },
  };
  window.__deskLat = api;
  try {
    const cold = sessionStorage.getItem('deskLat.cold');
    if (cold) {
      sessionStorage.removeItem('deskLat.cold');
      api.coldIds = JSON.parse(cold).map((spec) => api.arm(spec));
    }
  } catch {
    // no storage: the load reads no cold marks
  }
  return 'installed';
}
