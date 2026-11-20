// Rendered contrast and hue for the Orange synthesis: every line of text and every icon against the pixels behind
// it, and the colour each surface of glass actually came out.
//
//   OUT=dist-orange node src/experiments/orange/measure.mjs 'orange/session' 'orange/session?scheme=dark' …
//
// Run from the lab folder, after `ONLY=orange OUT=dist-orange npx vite build`. For each route it takes one capture
// with the text and icons hidden (the glass, the fills and the ground as drawn), reads each visible line's box out
// of it, and composites the line's computed colour over every pixel of that box. A line's reading is the
// tenth-percentile pixel: the worst tenth of what is behind it. Floors: 4.5:1 for text, 3:1 for text of 24 px or
// more (18.66 px when bold) and icons. Lines inside a scroller's faded edge band are reported but not gated. Marks
// drawn in CSS (the state dots, the switch) are not read.
//
// Each surface's body is reported as its median pixel: hex, HSL hue, OKLCH hue, and encoded level. The hue is the
// number this synthesis is held to: the owner's orange is HSL 26.5 / OKLCH 49.4, terracotta is HSL 15 to 17.
// DO='click:text=…' runs steps before measuring (same verbs as tools/shot.mjs). JSON=1 prints every line.
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const routes = process.argv.slice(2);
if (routes.length === 0) {
  console.error("usage: node measure.mjs '<exp>/<scene>[?scheme=dark&…]' …");
  process.exit(2);
}
const page0 = 'file://' + resolve(process.env.OUT ?? 'dist-orange', 'index.html');
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
  const root = document.querySelector('[data-x-orange]');
  const out = [];
  const hosts = [...root.querySelectorAll('[data-o-surface]')];
  const where = (el) => {
    const host = el.closest('[data-o-surface]');
    let kind = '';
    for (let e = el; e && e !== root; e = e.parentElement) {
      const c = [...e.classList].map((n) => n.replace(/^_/, '').replace(/_[A-Za-z0-9-]+$/, '')).find((n) => n && !['fade', 'glass', 'num', 'mono'].includes(n));
      if (c) {
        kind = c;
        break;
      }
    }
    const pop = el.closest('[data-state]') && !host ? 'popover' : null;
    return `${host?.getAttribute('data-o-surface') ?? pop ?? 'ground'} / ${kind || el.tagName.toLowerCase()}`;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e && e !== root; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const edgeOf = (el, r) => {
    const s = el.closest('[data-o-scroll]');
    if (!s) return false;
    const b = s.getBoundingClientRect();
    return r.top < b.top + 20 || r.bottom > b.bottom - 20;
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
    out.push({ what: 'text', text: el.placeholder.slice(0, 48), group: where(el) + ' (placeholder)', color: ps.color, opacity: opacityOf(el), size, weight: Number(cs.fontWeight), edge: false, x, y, w: Math.min(r.width - 24, el.placeholder.length * size * 0.5), h: lh });
  }
  for (const el of root.querySelectorAll('svg')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const opacity = opacityOf(el);
    if (opacity < 0.05 || r.width < 6 || !visibleAt(el, r)) continue;
    if (!el.querySelector('[stroke="currentColor"], [fill="currentColor"]') && el.getAttribute('stroke') !== 'currentColor') continue;
    out.push({ what: 'icon', text: el.getAttribute('class')?.replace('lucide lucide-', '').split(' ')[0] ?? 'icon', group: where(el), color: cs.color, opacity, size: r.width, weight: 0, edge: edgeOf(el, r), x: r.left, y: r.top, w: r.width, h: r.height });
  }
  const bodies = hosts.map((h) => {
    const r = h.getBoundingClientRect();
    return { label: h.getAttribute('data-o-surface'), x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // The ground itself, read where nothing stands on it: the window's margin.
  bodies.push({ label: 'ground (left margin)', x: -2, y: innerHeight * 0.3, w: 12, h: innerHeight * 0.4 });
  bodies.push({ label: 'ground (top margin)', x: innerWidth * 0.3, y: -2, w: innerWidth * 0.4, h: 12 });
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
  const parse = (s) => {
    const n = (s.match(/-?[\d.]+(?:e-?\d+)?%?/g) ?? []).map((t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)));
    if (s.startsWith('color(')) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n[3] ?? 1 };
    return { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 };
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
  const hue = (r, gg, b) => {
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    const h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const okHue = (r, gg, b) => {
    const R = lin(r);
    const G = lin(gg);
    const B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s2 = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2;
    return { h: (Math.atan2(bb, a) * 180) / Math.PI, c: Math.hypot(a, bb), L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2 };
  };
  const bodies = data.bodies.map((b) => {
    const d = px(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
    const rs = [];
    const gs = [];
    const bs = [];
    const v = [];
    for (let i = 0; i < d.length; i += 4 * 7) {
      rs.push(d[i]);
      gs.push(d[i + 1]);
      bs.push(d[i + 2]);
      v.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
    }
    for (const a of [rs, gs, bs, v]) a.sort((m, n) => m - n);
    const R = q(rs, 0.5);
    const G = q(gs, 0.5);
    const B = q(bs, 0.5);
    const ok = okHue(R, G, B);
    return { ...b, hex: '#' + [R, G, B].map((n) => n.toString(16).padStart(2, '0')).join(''), hsl: hue(R, G, B), ok: ok.h, chroma: ok.c, p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9) };
  });
  return { lines, bodies };
}

const f2 = (n) => n.toFixed(2);
for (const route of routes) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text());
  });
  await page.emulateMedia({ colorScheme: /scheme=dark/.test(route) ? 'dark' : 'light' });
  await page.goto(`${page0}#/${route}${route.includes('?') ? '&' : '?'}bare=1`);
  await page.bringToFront();
  await page.waitForTimeout(Number(process.env.WAIT ?? 1800));
  for (const step of (process.env.DO ?? '').split(';;').filter(Boolean)) {
    const at = step.indexOf(':');
    const verb = step.slice(0, at);
    const rest = step.slice(at + 1);
    if (verb === 'hover') await page.locator(rest).first().hover();
    else if (verb === 'click') await page.locator(rest).first().click();
    else if (verb === 'wait') await page.waitForTimeout(Number(rest));
    else if (verb === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  }
  if (process.env.DO) await page.waitForTimeout(900);
  const data = await page.evaluate(collect);
  await page.addStyleTag({
    content:
      '[data-x-orange], [data-x-orange] * { -webkit-text-fill-color: transparent !important; caret-color: transparent !important; animation-play-state: paused !important; } [data-x-orange] ::placeholder { -webkit-text-fill-color: transparent !important; } [data-x-orange] [data-tip]::after { display: none !important; } [data-x-orange] svg { visibility: hidden !important; }',
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
  if (process.env.LOGS === '1') for (const l of [...new Set(logs)]) console.log('  log: ' + l);
  else if (logs.length) console.log(`  ${new Set(logs).size} console warnings (LOGS=1 prints them)`);
  for (const b of res.bodies) console.log(`  body ${String(b.label).padEnd(22)} ${String(Math.round(b.w)).padStart(4)}×${String(Math.round(b.h)).padEnd(4)} ${b.hex}  hue HSL ${b.hsl.toFixed(1).padStart(5)} · OKLCH ${b.ok.toFixed(1).padStart(5)} (C ${b.chroma.toFixed(3)})  level p10 ${f2(b.p10)} · p50 ${f2(b.p50)} · p90 ${f2(b.p90)}`);
  const gated = res.lines.filter((l) => !l.edge);
  const groups = new Map();
  for (const l of gated) {
    const g = groups.get(l.group) ?? { n: 0, min: Infinity, fail: 0, what: l.what };
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
