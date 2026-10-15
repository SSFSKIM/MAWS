// Renders the app icon's PNGs (public/icons/) from public/icons/icon.svg in a headless browser: iOS takes only a PNG for
// its home-screen icon (apple-touch-icon, 180 px), and the manifest names 192 and 512 px ones. Run by hand after
// changing the SVG (`node apps/desk-web/scripts/icons.mjs`); the PNGs are committed. On a Mac it drives the installed
// Chrome, as the browser suites do.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const icons = join(import.meta.dirname, '..', 'public', 'icons');
const svg = readFileSync(join(icons, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: process.platform === 'darwin' ? 'chrome' : undefined });
try {
  for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: join(icons, name), omitBackground: false });
    await page.close();
    console.log(`rendered ${name} (${size} px)`);
  }
} finally {
  await browser.close();
}
