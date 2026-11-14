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
// not read. Each glass body is also read against the field painted under it (its level, the hue the glass drew
// from the hue it was given, and how far it stands from its ground). Options by environment: W, H (default 1440x900), WAIT, JSON=1 (every line), LOGS=1 (console output),
// BRIEF=1 (a few lines per route),
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
    // A message that waits above the composer lengthens the faded band by its own height (`--xl-above`).
    // A page with no bar at its foot (the Overview) fades only over its last 28 px.
    const bt = scroller.dataset.foot === 'none' ? -6 : scroller.classList.contains('xl-scroll') ? (parseFloat(cs.getPropertyValue('--vitrea-bar-inset-bottom')) || 150) + (parseFloat(cs.getPropertyValue('--xl-above')) || 0) : -40;
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
  // The field as painted, under each body: what the glass had to work with. Read from the plane's own canvas.
  const plane = root.querySelector('.xl-plane');
  const pg = plane?.getContext('2d', { willReadFrequently: true });
  if (pg && plane.clientWidth) {
    const k = plane.width / plane.clientWidth;
    for (const b of bodies) {
      const X = Math.max(0, Math.round((b.x + 4) * k));
      const Y = Math.max(0, Math.round((b.y + 4) * k));
      const d = pg.getImageData(X, Y, Math.max(1, Math.min(plane.width - X, Math.round((b.w - 8) * k))), Math.max(1, Math.min(plane.height - Y, Math.round((b.h - 8) * k)))).data;
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < d.length; i += 4 * 7) {
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] / 255;
          sum[c] += v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        n++;
      }
      b.under = sum.map((v) => v / n);
    }
  }
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
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4 * 7) {
      v.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
      for (let c = 0; c < 3; c++) sum[c] += lin(d[i + c]);
    }
    v.sort((m, n) => m - n);
    // The body as drawn against the field under it, in OKLCH: how far the glass moved the hue, and how far the
    // body stands from its ground (the distance is what makes a tinted capsule findable).
    const oklab = ([r, gg, bb]) => {
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * bb);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * bb);
      const s2 = Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * bb);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2];
    };
    const lch = (lab) => ({ L: lab[0], C: Math.hypot(lab[1], lab[2]), H: (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360 });
    const drawnLab = oklab(sum.map((x) => x / v.length));
    const underLab = b.under ? oklab(b.under) : null;
    const lumOf = ([r, gg, bb]) => 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
    const drawnLum = lumOf(sum.map((x) => x / v.length));
    const underLum = b.under ? lumOf(b.under) : null;
    return {
      ...b, p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9), drawn: lch(drawnLab), field: underLab && lch(underLab),
      apart: underLab && Math.hypot(drawnLab[0] - underLab[0], drawnLab[1] - underLab[1], drawnLab[2] - underLab[2]),
      against: underLum === null ? null : (Math.max(drawnLum, underLum) + 0.05) / (Math.min(drawnLum, underLum) + 0.05),
    };
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
  if (process.env.BRIEF === '1') {
    // One short block per route, for a matrix of colourings: the lowest text line and icon, anything under its
    // floor, the range of the glass bodies' levels, the widest turn of hue through the glass, and the capsule.
    const gatedB = res.lines.filter((l) => !l.edge);
    const low = (what) => gatedB.filter((l) => (what === 'icon') === (l.floor === 3)).sort((a, b) => a.ratio - b.ratio)[0];
    const t = low('text');
    const ic = low('icon');
    const failsB = gatedB.filter((l) => l.ratio < l.floor).sort((a, b) => a.ratio - b.ratio);
    const plain = res.bodies.filter((b) => !/waiting/.test(b.label));
    const cap = res.bodies.find((b) => /waiting/.test(b.label));
    const turns = plain.filter((b) => b.field && b.field.C >= 0.03 && b.drawn.C >= 0.02).map((b) => ({ b, t: ((b.drawn.H - b.field.H + 540) % 360) - 180 })).sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
    console.log(`== ${route}`);
    console.log(`   text ${t ? `${f2(t.ratio)} (${t.group})` : '–'} · icon ${ic ? `${f2(ic.ratio)} (${ic.group})` : '–'} · ${failsB.length} under the floor of ${gatedB.length}`);
    if (plain.length) console.log(`   bodies ${f2(Math.min(...plain.map((b) => b.p10)))} to ${f2(Math.max(...plain.map((b) => b.p90)))} · least apart from the field ${Math.min(...plain.map((b) => b.apart ?? 9)).toFixed(3)} · widest turn ${turns[0] ? `${turns[0].t >= 0 ? '+' : ''}${Math.round(turns[0].t)}° (${turns[0].b.label.slice(0, 18)}, field H ${Math.round(turns[0].b.field.H)} C ${turns[0].b.field.C.toFixed(3)})` : 'none (no chroma)'}`);
    if (cap) console.log(`   capsule level ${f2(cap.p50)} · drawn L ${f2(cap.drawn.L)} C ${cap.drawn.C.toFixed(3)} H ${Math.round(cap.drawn.H)} over field L ${f2(cap.field.L)} C ${cap.field.C.toFixed(3)} · apart ${cap.apart.toFixed(3)}, ${f2(cap.against)}:1`);
    for (const l of failsB.slice(0, 8)) console.log(`     ${f2(l.ratio)} (floor ${l.floor}, behind ${f2(l.behind)}) ${l.what} ${Math.round(l.size)}px  ${l.group}  “${l.text}”`);
    continue;
  }
  console.log(`\n== ${route}`);
  if (process.env.LOGS === '1') for (const l of [...new Set(logs)]) console.log('  log: ' + l.slice(0, 400));
  else if (logs.length) console.log(`  ${new Set(logs).size} console warnings (LOGS=1 prints them)`);
  for (const b of res.bodies) {
    // Hue is only a reading where there is chroma to carry it.
    const hue = (c) => (c.C < 0.02 ? '  –' : String(Math.round(c.H)).padStart(3));
    const turn = b.field && b.field.C >= 0.02 && b.drawn.C >= 0.02 ? ((b.drawn.H - b.field.H + 540) % 360) - 180 : null;
    const colour = b.field ? ` · field L ${f2(b.field.L)} C ${b.field.C.toFixed(3)} H ${hue(b.field)} → drawn L ${f2(b.drawn.L)} C ${b.drawn.C.toFixed(3)} H ${hue(b.drawn)}${turn === null ? '' : ` (${turn >= 0 ? '+' : ''}${Math.round(turn)}°)`} · apart ${b.apart.toFixed(3)}, ${f2(b.against)}:1` : '';
    console.log(`  body ${b.label.slice(0, 34).padEnd(34)} ${String(Math.round(b.w)).padStart(4)}×${String(Math.round(b.h)).padEnd(4)} drawn level p10 ${f2(b.p10)} · p50 ${f2(b.p50)} · p90 ${f2(b.p90)}${colour}`);
  }
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
