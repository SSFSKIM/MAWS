// UX wave U5 P2: drives harness.tsx in Electron (the app's pinned Electron, the same Chromium) under a virtual display.
// Usage: HARNESS_DIR=<built dir> ELECTRON=<electron binary> node run.mjs [runs]   (prints one JSON line per case)
import { _electron as electron } from 'playwright';
import path from 'node:path';

const dir = process.env.HARNESS_DIR;
const runs = Number(process.argv[2] ?? 1);
const app = await electron.launch({ executablePath: process.env.ELECTRON, args: [path.join(dir, 'main.cjs')], env: { ...process.env, HARNESS_DIR: dir } });
const page = await app.firstWindow();
await page.waitForLoadState('load');
await page.waitForFunction(() => window.H);
const versions = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
console.log(JSON.stringify({ versions }));
const cdp = await page.context().newCDPSession(page);
const settle = () => page.waitForTimeout(150);

async function openAndType(side, line, text) {
  await page.evaluate(([s, l]) => window.H.open(s, l), [side, line]);
  await settle();
  await page.click('[data-card-input]');
  await page.keyboard.type(text);
  await page.keyboard.press('ArrowLeft'); // a caret inside the text, not at its end
}

for (let run = 1; run <= (process.env.PW_ONLY ? 0 : runs); run++) {
  for (const mode of ['unified', 'split']) {
    for (const variant of ['data', 'memo', 'reopen']) {
      for (const kind of ['rerender', 'identical', 'elsewhere', 'shifted']) {
        await page.evaluate((c) => window.H.mount(c), { mode, variant, multi: false });
        await page.waitForSelector('[data-extend]');
        await openAndType('new', 12, 'draft');
        const before = await page.evaluate(() => window.H.state());
        await page.evaluate((k) => window.H.refresh(k), kind);
        await settle();
        const after = await page.evaluate(() => window.H.state());
        console.log(JSON.stringify({ run, mode, variant, kind, before: { card: before.card, extend: before.extend }, after: { card: after.card, cards: after.cards, widget: after.widget, extend: after.extend } }));
      }
      // a composition held open (Chromium's IME path through CDP; a synthetic stand-in for an input method), then refreshes
      for (const kind of ['rerender', 'identical']) {
        await page.evaluate((c) => window.H.mount(c), { mode, variant, multi: false });
        await page.waitForSelector('[data-extend]');
        await openAndType('new', 12, 'ab');
        await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
        const mid = await page.evaluate(() => window.H.state());
        await page.evaluate((k) => window.H.refresh(k), kind);
        await settle();
        await cdp.send('Input.insertText', { text: '한' }).catch(() => {});
        const after = await page.evaluate(() => window.H.state());
        console.log(JSON.stringify({ run, mode, variant, ime: kind, mid: mid.card, after: after.card, log: after.log.filter((l) => l.startsWith('composition') || l.startsWith('card')) }));
      }
    }
  }
}
// one open widget per diff: opening a second closes the first
await page.evaluate((c) => window.H.mount(c), { mode: 'split', variant: 'data', multi: false });
await page.waitForSelector('[data-extend]');
await openAndType('new', 12, 'first');
await page.evaluate(() => window.H.open('old', 11));
await settle();
console.log(JSON.stringify({ oneWidget: await page.evaluate(() => window.H.state()).then((s) => ({ cards: s.cards, widget: s.widget, card: s.card })) }));
// the library's own add button, by pointer: hover a context line's row, click the + that appears, type into the card
for (const mode of ['unified', 'split']) {
  await page.evaluate((c) => window.H.mount(c), { mode, variant: 'data', multi: false });
  await page.waitForSelector('[data-extend]');
  const row = page.locator('tr.diff-line', { hasText: 'const line30 = 30;' }).last();
  await row.hover();
  const button = row.locator('.diff-add-widget').first();
  const visible = await button.isVisible();
  await button.click();
  await settle();
  await page.click('[data-card-input]');
  await page.keyboard.type('by pointer');
  const s1 = await page.evaluate(() => window.H.state());
  await page.evaluate(() => window.H.refresh('rerender'));
  await settle();
  const s2 = await page.evaluate(() => window.H.state());
  console.log(JSON.stringify({ pointer: mode, buttonVisibleOnHover: visible, afterClick: { cards: s1.cards, widget: s1.widget, card: s1.card }, afterRerender: { card: s2.card } }));
}
// the multi-line variant the package also exports
await page.evaluate((c) => window.H.mount(c), { mode: 'split', variant: 'data', multi: true });
await settle();
console.log(JSON.stringify({ multiSelectRenders: await page.evaluate(() => document.querySelectorAll('[data-component="git-diff-view"]').length), lib: await page.evaluate(() => document.querySelector('[data-component="git-diff-view"]')?.getAttribute('data-version') ?? null) }));
await app.close();
