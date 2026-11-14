// The spike's test hook: script running inside the viewer page, the worst case (script of ours gone wrong). Each test
// tries something and reports what it saw; the harness in main decides pass or fail.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => (e && (e.name ? `${e.name}: ${e.message}` : String(e))) || String(e);
const ran = (globalThis.__ran = globalThis.__ran ?? {});
// The add module of build.mjs, inline, for the refused compile under the Word policy (no fetch needed).
const ADD_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);

// What happened while `fn` ran: its outcome, the CSP violations reported in the meantime.
async function attempt(ctx, fn, settle = 400, limit = 3000) {
  const before = ctx.state.violations.length;
  let outcome;
  try {
    outcome = { value: await Promise.race([fn(), sleep(limit).then(() => `pending after ${limit} ms`)]) };
  } catch (e) {
    outcome = { error: errText(e) };
  }
  await sleep(settle);
  outcome.violations = ctx.state.violations.slice(before).map((v) => `${v.directive} ${v.blocked}`);
  return outcome;
}

function element(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild;
}

const tests = {
  'dynamic-import': async () => {
    const m = await import(['.', 'chunk.js'].join('/'));
    return { answer: m.answer, url: new URL('chunk.js', import.meta.url).href };
  },

  wasm: async (args, ctx) => {
    const url = new URL('engine.wasm', import.meta.url).href;
    const out = {};
    out.instantiateStreaming = await attempt(ctx, async () => {
      const { instance } = await WebAssembly.instantiateStreaming(fetch(url));
      return instance.exports.add(2, 3);
    });
    out.compileFetched = await attempt(ctx, async () => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const module = await WebAssembly.compile(bytes);
      return (await WebAssembly.instantiate(module)).exports.add(4, 5);
    });
    out.compileInline = await attempt(ctx, async () => {
      const module = await WebAssembly.compile(ADD_WASM);
      return (await WebAssembly.instantiate(module)).exports.add(6, 7);
    });
    out.fetchOnly = await attempt(ctx, async () => (await fetch(url)).status);
    out.syncModule = await attempt(ctx, async () => new WebAssembly.Instance(new WebAssembly.Module(ADD_WASM)).exports.add(1, 1));
    return out;
  },

  // Condition 4: each way script could enter, tried; `ran[name]` is set only if that script runs.
  'script-boundary': async (args, ctx) => {
    const out = {};
    const mark = (name) => `globalThis.__ran[${JSON.stringify(name)}]=1`;
    const tries = {
      'inline-script': () => { const s = document.createElement('script'); s.textContent = mark('inline-script'); document.body.append(s); },
      'inline-module-script': () => { const s = document.createElement('script'); s.type = 'module'; s.textContent = mark('inline-module-script'); document.body.append(s); },
      'on-attribute': () => { const d = document.createElement('div'); d.setAttribute('onclick', mark('on-attribute')); document.body.append(d); d.click(); },
      'img-onerror-attribute': () => { const i = document.createElement('img'); i.setAttribute('onerror', mark('img-onerror-attribute')); i.src = 'missing.png'; document.body.append(i); },
      'javascript-url-anchor': () => { const a = document.createElement('a'); a.href = `javascript:${mark('javascript-url-anchor')}`; document.body.append(a); a.click(); },
      'javascript-url-location': () => { location.href = `javascript:${mark('javascript-url-location')}`; },
      eval: () => (0, eval)(mark('eval')),
      'new-Function': () => new Function(mark('new-Function'))(),
      'setTimeout-string': () => setTimeout(mark('setTimeout-string'), 0),
      'data-script': () => { const s = document.createElement('script'); s.src = `data:text/javascript,${encodeURIComponent(mark('data-script'))}`; document.body.append(s); },
      'blob-script': () => { const s = document.createElement('script'); s.src = URL.createObjectURL(new Blob([mark('blob-script')], { type: 'text/javascript' })); document.body.append(s); },
      'data-import': () => import(`data:text/javascript,${encodeURIComponent(mark('data-import'))}`),
      'blob-import': () => import(URL.createObjectURL(new Blob([mark('blob-import')], { type: 'text/javascript' }))),
      'innerHTML-script': () => { const d = document.createElement('div'); d.innerHTML = `<script>${mark('innerHTML-script')}</script>`; document.body.append(d); },
      'innerHTML-img-onerror': () => { const d = document.createElement('div'); d.innerHTML = `<img src="missing.png" onerror="${mark('innerHTML-img-onerror')}">`; document.body.append(d); },
      'DOMParser-script': () => { const doc = new DOMParser().parseFromString(`<body><script>${mark('DOMParser-script')}</script></body>`, 'text/html'); document.body.append(...doc.body.childNodes); },
      'DOMParser-img-onerror': () => { const doc = new DOMParser().parseFromString(`<body><img src="missing.png" onerror="${mark('DOMParser-img-onerror')}"></body>`, 'text/html'); document.body.append(...doc.body.childNodes); },
      'createContextualFragment-script': () => { document.body.append(document.createRange().createContextualFragment(`<script>${mark('createContextualFragment-script')}</script>`)); },
      'setHTMLUnsafe-script': () => { const d = document.createElement('div'); if (!d.setHTMLUnsafe) return 'no setHTMLUnsafe'; d.setHTMLUnsafe(`<script>${mark('setHTMLUnsafe-script')}</script><img src="missing.png" onerror="${mark('setHTMLUnsafe-script')}">`); document.body.append(d); },
      'svg-onload': () => { const d = document.createElement('div'); d.innerHTML = `<svg onload="${mark('svg-onload')}"></svg>`; document.body.append(d); },
    };
    for (const [name, fn] of Object.entries(tries)) {
      const r = await attempt(ctx, async () => { const v = fn(); if (v && typeof v.then === 'function') await v; return v ?? null; }, 350);
      out[name] = { ran: ran[name] === 1, error: r.error ?? null, violations: r.violations };
    }
    return out;
  },

  // document.write: after load it opens the document anew (the Window and this module stay), so it runs last, alone.
  'document-write': async (args, ctx) => {
    const r = await attempt(ctx, () => {
      document.write(`<script>globalThis.__ran['document-write-script']=1</script><img src="missing.png" onerror="globalThis.__ran['document-write-img-onerror']=1">`);
      document.close();
    }, 600);
    return { script: ran['document-write-script'] === 1, imgOnerror: ran['document-write-img-onerror'] === 1, error: r.error ?? null, violations: r.violations };
  },

  loop: async () => { setTimeout(() => { for (;;) {} }, 50); return { looping: 'in 50 ms' }; },
  'hang-after-ping': async (args, ctx) => { ctx.state.pingBudget = 1; ctx.state.hangAfterBudget = true; return { armed: true }; },
  busy: async (args) => { const end = performance.now() + (args.ms ?? 1500); let n = 0; while (performance.now() < end) n++; return { spins: n }; },
  'alloc-hold': async (args) => {
    const mb = args.mb ?? 400;
    globalThis.__held = globalThis.__held ?? [];
    for (let i = 0; i < mb; i++) { const a = new Uint8Array(1 << 20); for (let j = 0; j < a.length; j += 4096) a[j] = 1; globalThis.__held.push(a); }
    return { heldMiB: globalThis.__held.length };
  },
  'allocate-until-death': async () => {
    globalThis.__hoard = [];
    const step = () => { for (let i = 0; i < 2000; i++) globalThis.__hoard.push({ i, s: 'x'.repeat(64) + i, a: [i, i + 1, i + 2] }); setTimeout(step, 0); };
    setTimeout(step, 0);
    return { started: true };
  },

  // Condition 10, everything but WebRTC and the navigations that would take the page away.
  egress: async (args, ctx) => {
    const out = {};
    const { token, targets, artifactUrl, fileUrl } = args;
    const settle = 300;
    for (const t of targets) {
      const http = (label) => `http://${t.address}:${t.http}/${token}/${t.tag}/${label}`;
      const tries = {
        'fetch-cors': () => fetch(http('fetch-cors')).then((r) => r.status),
        'fetch-no-cors': () => fetch(http('fetch-no-cors'), { mode: 'no-cors' }).then((r) => r.type),
        'fetch-keepalive': () => fetch(http('fetch-keepalive'), { method: 'POST', body: 'x', keepalive: true, mode: 'no-cors' }).then((r) => r.type),
        xhr: () => new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open('GET', http('xhr')); x.onload = () => resolve(x.status); x.onerror = () => reject(new Error('xhr error')); x.send(); }),
        sendBeacon: () => navigator.sendBeacon(http('sendBeacon'), 'x'),
        WebSocket: () => new Promise((resolve, reject) => { const w = new WebSocket(`ws://${t.address}:${t.ws}/${token}/${t.tag}/ws`); w.onopen = () => resolve('open'); w.onerror = () => reject(new Error('ws error')); setTimeout(() => reject(new Error('ws timeout')), 2500); }),
        EventSource: () => new Promise((resolve, reject) => { const s = new EventSource(http('eventsource')); s.onopen = () => resolve('open'); s.onerror = () => { s.close(); reject(new Error('eventsource error')); }; setTimeout(() => reject(new Error('es timeout')), 2500); }),
        WebTransport: async () => { if (typeof WebTransport === 'undefined') return 'no WebTransport'; const w = new WebTransport(`https://${t.address}:${t.udp}/${token}/${t.tag}/wt`); await Promise.race([w.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('wt timeout')), 2500))]); return 'ready'; },
        img: () => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve('load'); i.onerror = () => reject(new Error('img error')); i.src = http('img'); document.body.append(i); }),
        'link-stylesheet': () => new Promise((resolve, reject) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = http('stylesheet'); l.onload = () => resolve('load'); l.onerror = () => reject(new Error('link error')); document.head.append(l); }),
        'css-url-image': () => { document.body.append(element(`<div style="width:10px;height:10px;background-image:url('${http('css-image-inline')}')"></div>`)); const s = document.createElement('style'); s.textContent = `.bg-${t.tag}{width:10px;height:10px;background:url('${http('css-image-sheet')}')}`; document.head.append(s); document.body.append(element(`<div class="bg-${t.tag}"></div>`)); },
        'css-url-font': async () => { const s = document.createElement('style'); s.textContent = `@font-face{font-family:f${t.tag};src:url('${http('css-font')}')}`; document.head.append(s); document.body.append(element(`<span style="font-family:f${t.tag}">font</span>`)); await document.fonts.load(`12px f${t.tag}`); const ff = new FontFace(`g${t.tag}`, `url('${http('fontface-api')}')`); return ff.load().then(() => 'loaded'); },
        'css-import': () => { const s = document.createElement('style'); s.textContent = `@import url('${http('css-import')}');`; document.head.append(s); },
        'link-preconnect': () => { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = `http://${t.address}:${t.preconnect}`; document.head.append(l); },
        'link-dns-prefetch': () => { const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = `//${token.replace(/[^a-z0-9]+/gi, '-')}-${t.tag}-dnsprefetch.example.com`; document.head.append(l); },
        'link-prefetch': () => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = http('prefetch'); document.head.append(l); },
        'link-modulepreload': () => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = http('modulepreload'); document.head.append(l); },
        'script-src': () => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = http('script'); s.onload = () => resolve('load'); s.onerror = () => reject(new Error('script error')); document.body.append(s); }),
        'import-remote': () => import(http('import')),
        'window-open': () => { const w = window.open(http('window-open')); return w === null ? 'null' : 'a window'; },
        'a-ping': () => { const a = document.createElement('a'); a.href = '#ping'; a.ping = http('ping'); document.body.append(a); a.click(); },
        iframe: () => { const f = document.createElement('iframe'); f.src = http('iframe'); document.body.append(f); },
        'object-embed': () => { document.body.append(element(`<object data="${http('object')}"></object>`)); document.body.append(element(`<embed src="${http('embed')}">`)); },
        'media-src': () => { const v = document.createElement('video'); v.src = http('video'); document.body.append(v); v.load(); },
        'svg-image': () => { const d = document.createElement('div'); d.innerHTML = `<svg width="5" height="5"><image href="${http('svg-image')}" width="5" height="5"/></svg>`; document.body.append(d); },
        'Worker-remote': () => new Worker(http('worker')),
        'Worker-own-host': () => new Promise((resolve, reject) => { const w = new Worker(new URL('chunk.js', import.meta.url), { type: 'module' }); w.onerror = (e) => reject(new Error(`worker error ${e.message ?? ''}`)); setTimeout(() => resolve('no error in 1 s'), 1000); }),
        SharedWorker: () => (typeof SharedWorker === 'undefined' ? 'no SharedWorker' : new SharedWorker(http('sharedworker')) && 'constructed'),
        'serviceWorker-register': () => (navigator.serviceWorker ? navigator.serviceWorker.register(new URL('chunk.js', import.meta.url)).then(() => 'registered') : 'no navigator.serviceWorker'),
      };
      for (const [name, fn] of Object.entries(tries)) {
        ctx.say({ type: 'progress', name: `${t.tag}:${name}` });
        out[`${t.tag}:${name}`] = await attempt(ctx, async () => { const v = await fn(); return v === undefined ? null : typeof v === 'object' ? String(v) : v; }, settle);
      }
    }
    // Hostnames that exist only in this run, so the DNS capture shows whether an attempt resolved its host.
    const name = (label) => `${token.replace(/[^a-z0-9]+/gi, '-')}-${label}.example.com`;
    const named = {
      'named:dns-prefetch-reenable': () => { const m = document.createElement('meta'); m.httpEquiv = 'x-dns-prefetch-control'; m.content = 'on'; document.head.append(m); const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = `//${name('reenable')}`; document.head.append(l); },
      'named:fetch': () => fetch(`http://${name('fetch')}/`, { mode: 'no-cors' }).then((r) => r.type),
      'named:img': () => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve('load'); i.onerror = () => reject(new Error('img error')); i.src = `http://${name('img')}/x.png`; }),
      'named:WebSocket': () => new Promise((resolve, reject) => { const w = new WebSocket(`ws://${name('ws')}/`); w.onopen = () => resolve('open'); w.onerror = () => reject(new Error('ws error')); }),
      'named:anchor-hover': () => { const a = document.createElement('a'); a.href = `http://${name('anchor')}/`; a.textContent = 'x'; document.body.append(a); a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); },
      'named:turn-tcp': async () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: `turn:${name('turn')}:3478?transport=tcp`, username: 'spike', credential: 'spike' }], iceTransportPolicy: 'relay' }); pc.createDataChannel('x'); await pc.setLocalDescription(await pc.createOffer()); await sleep(2500); pc.close(); return 'gathered'; },
    };
    for (const [n, fn] of Object.entries(named)) { ctx.say({ type: 'progress', name: n }); out[n] = await attempt(ctx, async () => { const v = await fn(); return v === undefined ? null : v; }, 300); }
    out['fetch-file'] = await attempt(ctx, () => fetch(fileUrl).then((r) => r.status));
    out['fetch-maws-artifact'] = await attempt(ctx, () => fetch(artifactUrl).then((r) => r.status));
    out['img-maws-artifact'] = await attempt(ctx, () => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve('load'); i.onerror = () => reject(new Error('img error')); i.src = `${artifactUrl}-img`; document.body.append(i); }));
    return out;
  },

  // Navigations that take the page away if they succeed: one per frame, the harness reads the outcome from main.
  navigate: async (args) => {
    const { how, url } = args;
    setTimeout(() => {
      try {
        if (how === 'self') location.href = url;
        else if (how === 'top') top.location.href = url;
        else if (how === 'form') { const f = element(`<form action="${url}" method="post"><input name="a" value="b"></form>`); document.body.append(f); f.submit(); }
        else if (how === 'form-target-top') { const f = element(`<form action="${url}" method="get" target="_top"><input name="a" value="b"></form>`); document.body.append(f); f.submit(); }
        else if (how === 'meta-refresh') { const d = document.createElement('div'); d.innerHTML = `<meta http-equiv="refresh" content="0;url=${url}">`; document.head.append(d.firstChild); }
        else if (how === 'anchor-top') { const a = element(`<a href="${url}" target="_top">x</a>`); document.body.append(a); a.click(); }
        else if (how === 'a-download') { const a = document.createElement('a'); a.href = url; a.download = 'x.bin'; document.body.append(a); a.click(); }
        else if (how === 'anchor-blank') { const a = element(`<a href="${url}" target="_blank">x</a>`); document.body.append(a); a.click(); }
      } catch (e) { globalThis.__navError = errText(e); }
    }, 30);
    return { scheduled: how };
  },

  webrtc: async (args, ctx) => {
    const out = { typeofRTCPeerConnection: { value: typeof RTCPeerConnection, violations: [] } };
    for (const [label, config] of Object.entries(args.configs)) {
      out[label] = await attempt(ctx, async () => {
        const pc = new RTCPeerConnection(config);
        const candidates = [];
        pc.onicecandidate = (e) => { if (e.candidate) candidates.push(`${e.candidate.type ?? '?'} ${e.candidate.protocol ?? ''} ${e.candidate.address ?? ''}`.trim()); };
        pc.createDataChannel('x');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const end = performance.now() + (args.waitMs ?? 4000);
        while (pc.iceGatheringState !== 'complete' && performance.now() < end) await sleep(100);
        await sleep(500);
        const result = { constructed: true, gathering: pc.iceGatheringState, candidates };
        pc.close();
        return result;
      }, 300);
    }
    return out;
  },

  // Condition 11: what of the app a frame can reach.
  reach: async () => {
    const out = {};
    const probe = async (name, fn) => { try { out[name] = { value: await fn() }; } catch (e) { out[name] = { error: errText(e) }; } };
    await probe('parent.document', () => (parent === window ? 'top-level (no parent)' : typeof parent.document));
    await probe('typeof maws', () => typeof globalThis.maws);
    await probe('typeof top.maws', () => (top === window ? 'top-level' : typeof top.maws));
    await probe('typeof require', () => typeof globalThis.require);
    await probe('typeof process', () => typeof globalThis.process);
    await probe('localStorage', () => { localStorage.setItem('k', 'v'); return localStorage.getItem('k'); });
    await probe('sessionStorage', () => { sessionStorage.setItem('k', 'v'); return sessionStorage.getItem('k'); });
    await probe('document.cookie', () => { document.cookie = 'k=v'; return document.cookie; });
    await probe('indexedDB', () => new Promise((resolve, reject) => { const r = indexedDB.open('x'); r.onsuccess = () => resolve('opened'); r.onerror = () => reject(r.error); }));
    await probe('caches', () => (self.caches ? caches.open('x').then(() => 'opened') : 'no caches'));
    await probe('clipboard.readText', () => Promise.race([navigator.clipboard.readText().then((t) => `read ${t.length} chars`), sleep(3000).then(() => 'pending after 3 s')]));
    await probe('clipboard.writeText', () => Promise.race([navigator.clipboard.writeText('spike').then(() => 'written'), sleep(3000).then(() => 'pending after 3 s')]));
    await probe('getUserMedia', () => Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted'), sleep(3000).then(() => 'pending after 3 s')]));
    await probe('Notification.requestPermission', () => (typeof Notification === 'undefined' ? 'no Notification' : Promise.race([Notification.requestPermission(), sleep(3000).then(() => 'pending after 3 s')])));
    await probe('geolocation', () => new Promise((resolve, reject) => { navigator.geolocation.getCurrentPosition(() => resolve('position'), (e) => reject(new Error(`code ${e.code} ${e.message}`)), { timeout: 3000 }); }));
    await probe('opener', () => String(window.opener));
    await probe('origin', () => self.origin);
    return out;
  },

  'arm-big': async () => {
    addEventListener('message', function onBig(e) {
      if (!e.data || e.data.type !== 'big') return;
      const t1 = performance.timeOrigin + performance.now();
      const view = new Uint8Array(e.data.buffer);
      let sum = 0;
      for (let i = 0; i < view.length; i += 65536) sum = (sum + view[i]) | 0;
      globalThis.__big = { bytes: view.length, t1, first: view[0], last: view[view.length - 1], sum };
      removeEventListener('message', onBig);
    });
    return { armed: true };
  },
  'read-big': async () => globalThis.__big ?? null,

  inflate: async () => {
    if (typeof DecompressionStream === 'undefined') return { exists: false };
    const total = 16 << 20;
    const plain = new Uint8Array(total);
    for (let i = 0; i < total; i++) plain[i] = 97 + (i % 23);
    const compressed = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    let counted = 0;
    let chunks = 0;
    const stopAt = 4 << 20;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      counted += value.byteLength;
      chunks += 1;
      if (counted >= stopAt) { await reader.cancel('enough'); break; }
    }
    let afterCancel;
    try { afterCancel = await reader.read(); } catch (e) { afterCancel = { error: errText(e) }; }
    return { exists: true, compressedBytes: compressed.length, inflatedBytes: total, counted, chunks, abortedMidway: counted < total, afterCancelDone: afterCancel?.done ?? null };
  },

  'fetch-own-file': async () => {
    const url = new URL('file', location.href);
    const t = performance.now();
    const r = await fetch(url);
    const bytes = (await r.arrayBuffer()).byteLength;
    const first = { status: r.status, bytes, ms: Math.round(performance.now() - t) };
    const second = await fetch(url).then((x) => ({ status: x.status }), (e) => ({ status: errText(e) }));
    return { first, second };
  },

  'keys-arm': async () => {
    const first = !globalThis.__keys;
    globalThis.__keys = [];
    if (first) addEventListener('keydown', (e) => globalThis.__keys.push(`${e.ctrlKey ? 'Ctrl+' : ''}${e.metaKey ? 'Meta+' : ''}${e.key}`), true);
    return { armed: true, hasFocus: document.hasFocus() };
  },
  'keys-read': async () => ({ keys: globalThis.__keys ?? [], hasFocus: document.hasFocus() }),
  'focus-state': async () => ({ hasFocus: document.hasFocus() }),
};

export async function run(name, args, ctx) {
  const test = tests[name];
  if (!test) return { error: `no test ${name}` };
  return test(args, ctx);
}
