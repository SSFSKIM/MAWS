// Capture lab pages with the installed Chrome, headless, from the single-file build.
//
//   node tools/shot.mjs <out-dir> <route> [<route> …] [--do=<step> …] [--name=<suffix>]
//
//   route   "<exp>/<scene>[?scheme=dark&knob=value]"
//   --do    a step run on every route after it loads, in the order given:
//             hover:<selector>   click:<selector>   press:<key>   type:<text>
//             scroll:<selector>:<pixels>   blur (the window loses focus)   wait:<ms>
//           <selector> is a Playwright selector: "text=Fix flaky upload test", "role=button[name=Approve]", ".x-id-row".
//   --name  appended to each capture's file name, so states of one route do not overwrite each other.
//
// Options by environment: OUT (the build folder, default dist), W, H (CSS px, default 1440x900), DPR (default 2),
// WAIT (ms after load and after the last step, default 1500), MOTION=reduce, CONTRAST=more, FORCED=1.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const steps = argv.filter((a) => a.startsWith('--do=')).map((a) => a.slice(5));
const suffix = argv.find((a) => a.startsWith('--name='))?.slice(7);
const [outDir, ...routes] = argv.filter((a) => !a.startsWith('--'));
if (!outDir || routes.length === 0) {
  console.error('usage: node tools/shot.mjs <out-dir> <route> [<route> …] [--do=<step> …] [--name=<suffix>]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const page0 = 'file://' + resolve(process.env.OUT ?? 'dist', 'index.html');
const settle = Number(process.env.WAIT ?? 1500);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) },
  deviceScaleFactor: Number(process.env.DPR ?? 2),
});

async function run(page, step) {
  const at = step.indexOf(':');
  const verb = at < 0 ? step : step.slice(0, at);
  const rest = at < 0 ? '' : step.slice(at + 1);
  if (verb === 'hover') await page.locator(rest).first().hover();
  else if (verb === 'click') await page.locator(rest).first().click();
  else if (verb === 'press') await page.keyboard.press(rest);
  else if (verb === 'type') await page.keyboard.type(rest);
  else if (verb === 'wait') await page.waitForTimeout(Number(rest));
  else if (verb === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  else if (verb === 'scroll') {
    const cut = rest.lastIndexOf(':');
    await page.locator(rest.slice(0, cut)).first().evaluate((el, dy) => el.scrollBy(0, dy), Number(rest.slice(cut + 1)));
  } else throw new Error(`unknown step "${step}"`);
}

let failed = false;
for (const route of routes) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.emulateMedia({
    colorScheme: /scheme=dark/.test(route) ? 'dark' : 'light',
    reducedMotion: process.env.MOTION === 'reduce' ? 'reduce' : 'no-preference',
    contrast: process.env.CONTRAST === 'more' ? 'more' : 'no-preference',
    forcedColors: process.env.FORCED === '1' ? 'active' : 'none',
  });
  const sep = route.includes('?') ? '&' : '?';
  await page.goto(`${page0}#/${route}${sep}bare=1`);
  await page.bringToFront();
  await page.waitForTimeout(settle);
  try {
    for (const step of steps) await run(page, step);
    if (steps.length) await page.waitForTimeout(settle);
  } catch (e) {
    failed = true;
    logs.push(`step failed: ${String(e).split('\n')[0].slice(0, 300)}`);
  }
  const name = route.replace(/[/?&=]+/g, '-').replace(/-$/, '') + (suffix ? `-${suffix}` : '');
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}.png${logs.length ? `\n  ${[...new Set(logs)].slice(0, 12).join('\n  ')}` : ''}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
