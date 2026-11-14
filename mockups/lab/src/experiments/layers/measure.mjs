// Rendered contrast for the Layers synthesis: every line of text and every icon, against the pixels behind it.
// Adapted from the Windows experiment's script.
//
//   OUT=dist-layers node src/experiments/layers/measure.mjs 'layers/session' 'layers/session?scheme=dark&field=vivid' …
//
// Run from the lab folder, after `ONLY=layers OUT=dist-layers npx vite build`. For each route it takes one capture
// with the text and icons hidden (the glass, the fills and the field as drawn), reads each visible line's box out
// of it, and composites the line's computed colour over every pixel of that box. A line's reading is the
// tenth-percentile pixel: the worst tenth of what is behind it, so a calm average cannot carry a line that crosses
// structure. Floors: 4.5:1 for text, 3:1 for text of 24 px or more (18.66 px when bold) and for icons. Lines inside
// the transcript's faded edge bands are reported but not gated. Marks drawn in CSS (the state dots, the switch) are
// not read. Options by environment: W, H (default 1440x900), WAIT, JSON=1 (every line), LOGS=1 (console output),
// PERF=1 (instead of contrast: frame intervals while the transcript scrolls end to end).
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const routes = process.argv.slice(2);
if (routes.length === 0) {
  console.error("usage: node measure.mjs '<exp>/<scene>[?scheme=dark&…]' …");
  process.exit(2);
}
const page0 = 'file://' + resolve(process.env.OUT ?? 'dist-layers', 'index.html');
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const DPR = 2;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const lab = await context.newPage(); // a blank page that decodes captures and does the arithmetic
await lab.goto('about:blank');

function collect() {
  const root = document.querySelector('.x-layers');
  const out = [];
  const surfaces = [...root.querySelectorAll('[data-glass-role], .xl-block, .xl-module, .xl-pop')];
  const nameOf = (s) =>
    s.classList.contains('xl-block') ? `block ${[...s.classList].find((n) => n !== 'xl-block')?.replace('xl-', '') ?? ''}`
    : s.classList.contains('xl-module') ? `module ${s.getAttribute('aria-label')}`
    : s.classList.contains('xl-pop') ? `platter ${s.getAttribute('aria-label') ?? ''}`
    : `${s.getAttribute('data-glass-role')} ${s.getAttribute('aria-label') ?? ''}`;
  const where = (el) => {
    const s = el.closest('[data-glass-role], .xl-block, .xl-module, .xl-pop');
    let kind = '';
    for (let e = el; e && e !== root && e !== s; e = e.parentElement) {
      const c = [...e.classList].find((n) => n.startsWith('xl-') && !['xl-fade', 'xl-mono', 'xl-num', 'xl-host'].includes(n));
      if (c) {
        kind = c.replace('xl-', '');
        break;
      }
    }
    return `${s ? nameOf(s).trim() : 'field'} / ${kind || el.tagName.toLowerCase()}`;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e && e !== root; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const scroller = root.querySelector('.xl-scroll, .xl-page');
  const edgeOf = (el, r) => {
    if (!scroller || !scroller.contains(el)) return false;
    const b = scroller.getBoundingClientRect();
    const cs = getComputedStyle(scroller);
    const t = parseFloat(cs.getPropertyValue('--vitrea-bar-inset-top')) || 46;
    const bt = scroller.classList.contains('xl-scroll') ? parseFloat(cs.getPropertyValue('--vitrea-bar-inset-bottom')) || 150 : -40;
    return r.top < b.top + t + 38 || r.bottom > b.bottom - bt - 38;
  };
  // A line counts only where it can be seen: its centre and both ends must be the topmost thing there, so a
  // line partly under an open platter is not read against the platter.
  const visibleAt = (el, r) => {
    const cy = r.top + r.height / 2;
    for (const cx of [r.left + 2, r.left + r.width / 2, r.right - 2]) {
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) return false;
    }
    return true;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue.trim();
    if (!text) continue;
    const el = node.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const opacity = opacityOf(el);
    if (opacity < 0.05) continue; // text that waits for hover is not on screen
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 3 || r.height < 3 || !visibleAt(el, r)) continue;
      out.push({ what: 'text', text: text.slice(0, 48), group: where(el), color: cs.color, opacity, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), edge: edgeOf(el, r), x: r.left, y: r.top, w: r.width, h: r.height });
    }
  }
  for (const el of root.querySelectorAll('textarea, input')) {
    if (el.value || !el.placeholder) continue;
    const cs = getComputedStyle(el);
    const ps = getComputedStyle(el, '::placeholder');
    const r = el.getBoundingClientRect();
    const size = parseFloat(cs.fontSize);
    const x = r.left + parseFloat(cs.paddingLeft);
    const lh = parseFloat(cs.lineHeight) || size * 1.4;
    const y = el.tagName === 'TEXTAREA' ? r.top + parseFloat(cs.paddingTop) : r.top + (r.height - lh) / 2;
    out.push({ what: 'text', text: el.placeholder.slice(0, 48), group: where(el) + ' (placeholder)', color: ps.color, opacity: opacityOf(el), size, weight: Number(cs.fontWeight), edge: edgeOf(el, r), x, y, w: Math.min(r.width - 24, el.placeholder.length * size * 0.5), h: lh });
  }
  for (const el of root.querySelectorAll('svg')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const opacity = opacityOf(el);
    if (opacity < 0.05 || r.width < 6 || !visibleAt(el, r)) continue;
    if (!el.querySelector('[stroke="currentColor"], [fill="currentColor"]') && el.getAttribute('stroke') !== 'currentColor') continue;
    out.push({ what: 'icon', text: el.getAttribute('class')?.replace('lucide lucide-', '').split(' ')[0] ?? 'icon', group: where(el), color: cs.color, opacity, size: r.width, weight: 0, edge: edgeOf(el, r), x: r.left, y: r.top, w: r.width, h: r.height });
  }
  // A surface is read only where it shows: a card folded shut, or scrolled out of the reading band, is skipped.
  const bodies = surfaces
    .map((s) => {
      const r = s.getBoundingClientRect();
      return { s, r };
    })
    .filter(({ s, r }) => {
      if (r.width < 12 || r.height < 12) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (s.contains(hit) || hit.contains(s)) && !edgeOf(s, { top: r.top + r.height / 2, bottom: r.top + r.height / 2 });
    })
    .map(({ s, r }) => ({ label: nameOf(s).trim(), x: r.left, y: r.top, w: r.width, h: r.height }));
  return { lines: out, bodies };
}

async function analyse(png, data, dpr) {
  const img = new Image();
  img.src = 'data:image/png;base64,' + png;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  // Any CSS colour, resolved by the engine to sRGB bytes.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = (s) => {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    const [r, gg, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const al = a / 255;
    return al === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r, g: gg, b, a: al };
  };
  const px = (x, y, w, h) => {
    const X = Math.max(0, Math.round(x * dpr));
    const Y = Math.max(0, Math.round(y * dpr));
    const Wd = Math.max(1, Math.min(c.width - X, Math.round(w * dpr)));
    const Hd = Math.max(1, Math.min(c.height - Y, Math.round(h * dpr)));
    return g.getImageData(X, Y, Wd, Hd).data;
  };
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
  const lines = data.lines.map((ln) => {
    const ink = parse(ln.color);
    const a = ink.a * ln.opacity;
    const d = px(ln.x, ln.y, ln.w, ln.h);
    const ratios = [];
    let enc = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gg = d[i + 1];
      const b = d[i + 2];
      const Lb = L(r, gg, b);
      const Li = L(ink.r * a + r * (1 - a), ink.g * a + gg * (1 - a), ink.b * a + b * (1 - a));
      ratios.push((Math.max(Lb, Li) + 0.05) / (Math.min(Lb, Li) + 0.05));
      enc += (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
    }
    ratios.sort((m, n) => m - n);
    const large = ln.what === 'icon' || ln.size >= 24 || (ln.size >= 18.66 && ln.weight >= 700);
    return { ...ln, ratio: q(ratios, 0.1), median: q(ratios, 0.5), behind: enc / (d.length / 4), floor: large ? 3 : 4.5 };
  });
  const bodies = data.bodies.map((b) => {
    const d = px(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
    const v = [];
    for (let i = 0; i < d.length; i += 4 * 7) v.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
    v.sort((m, n) => m - n);
    return { ...b, p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9) };
  });
  return { lines, bodies };
}

/** Scroll the transcript end to end and back at a steady rate and report the intervals between frames. */
async function perf() {
  const el = document.querySelector('.x-layers .xl-scroll');
  if (!el) return null;
  const max = el.scrollHeight - el.clientHeight;
  const frames = [];
  let last = performance.now();
  const started = last;
  const span = 4000;
  await new Promise((done) => {
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      const t = (now - started) / span;
      el.scrollTop = max * (0.5 - 0.5 * Math.cos(Math.min(1, t) * Math.PI * 2));
      if (t < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  frames.sort((a, b) => a - b);
  const at = (p) => frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
  return { frames: frames.length, travel: max * 2, median: at(0.5), p95: at(0.95), worst: frames[frames.length - 1], over20: frames.filter((f) => f > 20).length };
}

const f2 = (n) => n.toFixed(2);
for (const route of routes) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text());
  });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e)));
  await page.emulateMedia({ colorScheme: /scheme=dark/.test(route) ? 'dark' : 'light' });
  await page.goto(`${page0}#/${route}${route.includes('?') ? '&' : '?'}bare=1`);
  await page.bringToFront();
  await page.waitForTimeout(Number(process.env.WAIT ?? 1800));
  if (process.env.PERF === '1') {
    const r = await page.evaluate(`(${perf.toString()})()`);
    console.log(`== ${route}\n  ${r ? `${r.frames} frames over ${Math.round(r.travel)} px of scroll: median ${f2(r.median)} ms, p95 ${f2(r.p95)} ms, worst ${f2(r.worst)} ms, ${r.over20} over 20 ms` : 'no transcript on this route'}`);
    await page.close();
    continue;
  }
  const data = await page.evaluate(collect);
  await page.addStyleTag({
    content:
      '.x-layers, .x-layers * { -webkit-text-fill-color: transparent !important; caret-color: transparent !important; animation-play-state: paused !important; } .x-layers ::placeholder { -webkit-text-fill-color: transparent !important; } .x-layers svg { visibility: hidden !important; } .x-layers [data-tip]::after { display: none !important; }',
  });
  await page.waitForTimeout(400);
  const png = (await page.screenshot()).toString('base64');
  const res = await lab.evaluate(`(${analyse.toString()})(${JSON.stringify(png)}, ${JSON.stringify(data)}, ${DPR})`);
  await page.close();
  if (process.env.JSON === '1') {
    console.log(JSON.stringify({ route, ...res }));
    continue;
  }
  console.log(`\n== ${route}`);
  if (process.env.LOGS === '1') for (const l of [...new Set(logs)]) console.log('  log: ' + l.slice(0, 400));
  else if (logs.length) console.log(`  ${new Set(logs).size} console warnings (LOGS=1 prints them)`);
  for (const b of res.bodies) console.log(`  body ${b.label.padEnd(34)} ${String(Math.round(b.w)).padStart(4)}×${String(Math.round(b.h)).padEnd(4)} drawn level p10 ${f2(b.p10)} · p50 ${f2(b.p50)} · p90 ${f2(b.p90)}`);
  const gated = res.lines.filter((l) => !l.edge);
  const groups = new Map();
  for (const l of gated) {
    const g = groups.get(l.group) ?? { n: 0, min: Infinity, fail: 0 };
    g.n++;
    g.min = Math.min(g.min, l.ratio);
    if (l.ratio < l.floor) g.fail++;
    groups.set(l.group, g);
  }
  for (const [name, g] of [...groups].sort((a, b) => a[1].min - b[1].min)) console.log(`  ${g.fail ? 'FAIL' : ' ok '} ${f2(g.min).padStart(6)}  ${String(g.n).padStart(3)} ${name}`);
  const fails = gated.filter((l) => l.ratio < l.floor).sort((a, b) => a.ratio - b.ratio);
  console.log(`  ${gated.length} gated readings, ${fails.length} under the floor; ${res.lines.length - gated.length} in a faded edge band, not gated`);
  for (const l of fails) console.log(`    ${f2(l.ratio)} (floor ${l.floor}, behind ${f2(l.behind)}) ${l.what} ${Math.round(l.size)}px  ${l.group}  “${l.text}”`);
}
await browser.close();
