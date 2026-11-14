// Capture lab pages with the installed Chrome, headless, from the single-file build.
//   node tools/shot.mjs <out-dir> <route> [<route> …]      route = "<exp>/<scene>[?scheme=dark&knob=value]"
// Options by environment: W, H (CSS px, default 1440x900), DPR (default 2), WAIT (ms after load, default 1500).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [outDir, ...routes] = process.argv.slice(2);
if (!outDir || routes.length === 0) {
  console.error('usage: node tools/shot.mjs <out-dir> <route> [<route> …]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const page0 = 'file://' + resolve('dist/index.html');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) },
  deviceScaleFactor: Number(process.env.DPR ?? 2),
});
for (const route of routes) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  const scheme = /scheme=dark/.test(route) ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme: scheme });
  const sep = route.includes('?') ? '&' : '?';
  await page.goto(`${page0}#/${route}${sep}bare=1`);
  await page.bringToFront();
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  const name = route.replace(/[/?&=]+/g, '-').replace(/-$/, '');
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}.png${logs.length ? `\n  ${[...new Set(logs)].slice(0, 12).join('\n  ')}` : ''}`);
  await page.close();
}
await browser.close();
