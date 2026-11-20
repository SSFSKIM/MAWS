// The window page: main mounts and reads elements through executeJavaScript (no inline script runs under the policy).
// An <iframe> with no sandbox for a PDF (PdfFrame), one with sandbox="allow-scripts" for a page (HtmlFrame), and the
// media elements as Media draws them (controls, preload="metadata").
const slots = document.getElementById('slots');
const mounted = new Map();

window.spike = {
  mount({ id, kind, url, width = 400, height = 300 }) {
    let el;
    const state = { loads: 0, events: [], error: null };
    if (kind === 'pdf' || kind === 'html') {
      el = document.createElement('iframe');
      if (kind === 'html') el.setAttribute('sandbox', 'allow-scripts');
      el.referrerPolicy = 'no-referrer';
      el.title = id;
      el.addEventListener('load', () => state.loads++);
    } else {
      el = document.createElement(kind);
      el.controls = true;
      el.preload = 'metadata';
      for (const type of ['loadedmetadata', 'canplay', 'playing', 'seeked', 'ended', 'stalled']) el.addEventListener(type, () => state.events.push(type));
      el.addEventListener('error', () => {
        state.error = el.error ? { code: el.error.code, message: el.error.message } : { code: null };
        state.events.push('error');
      });
    }
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.className = 'slot';
    el.dataset.id = id;
    el.src = url;
    slots.appendChild(el);
    mounted.set(id, { el, state, kind });
    return true;
  },
  unmount(id) {
    const m = mounted.get(id);
    if (!m) return false;
    if (m.kind === 'video' || m.kind === 'audio') {
      m.el.pause();
      m.el.removeAttribute('src');
      m.el.load();
    }
    m.el.remove();
    mounted.delete(id);
    return true;
  },
  clear() {
    for (const id of [...mounted.keys()]) this.unmount(id);
    return true;
  },
  state(id) {
    const m = mounted.get(id);
    if (!m) return null;
    const r = m.el.getBoundingClientRect();
    const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    if (m.kind === 'pdf' || m.kind === 'html') return { rect, loads: m.state.loads };
    const e = m.el;
    return { rect, events: m.state.events, error: m.state.error, readyState: e.readyState, networkState: e.networkState, duration: Number.isFinite(e.duration) ? e.duration : String(e.duration), currentTime: e.currentTime, paused: e.paused };
  },
  canPlayType(kind, type) {
    return document.createElement(kind).canPlayType(type);
  },
  async seek(id, at) {
    const e = mounted.get(id)?.el;
    if (!e) return false;
    e.currentTime = at;
    return true;
  },
  async play(id, ms = 4000) {
    const e = mounted.get(id)?.el;
    if (!e) return { played: false, why: 'not mounted' };
    const s = mounted.get(id).state;
    const before = s.events.length;
    try {
      await Promise.race([e.play(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
    } catch (error) {
      return { played: false, why: String(error), error: s.error };
    }
    await new Promise((r) => setTimeout(r, 600));
    return { played: !e.paused && e.currentTime > 0, currentTime: e.currentTime, events: s.events.slice(before), error: s.error };
  },
  frames(n) {
    return new Promise((resolve) => {
      let left = n;
      const tick = () => (--left <= 0 ? resolve(n) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  },
  language: () => ({ language: navigator.language, languages: [...navigator.languages] }),
};
