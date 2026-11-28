// Text and bytes an agent wrote, on the page (M4; §8.2's rules 3 and 4; T22; Acceptance 11): a context holding every
// kind of thing rule 3 names is drawn with its tags as characters and no image; a link the sheet's policy refuses is
// drawn with no address, so no click, middle click or context menu has anything to follow; an `https` link opens a new
// tab with no opener; a referenced HTML file and an SVG file open as characters; and over the whole of it every request
// the browser made is the page's own, or a `data:` or `blob:` address, and it raised no content-policy violation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from '@playwright/test';
import { expect, test, violationsOf } from './fixtures';
import { question, questionRecord } from './records';

const S = '5eed0000-0000-4000-8000-0000000000f1';
const CONTEXT = [
  'Before anything else: <script>window.__marker = 1</script> and <img src="x" onerror="window.__marker = 2">.',
  '',
  '![a remote picture](https://example.com/remote.png)',
  '',
  'Links: [run it](javascript:window.__marker=3), [write to us](mailto:someone@example.com), [a stray path](src/not-a-reference.ts) and [the site](https://example.com/page).',
  '',
  '```ts',
  'const sailing = 1;',
  '```',
  '',
  '$$E = mc^2$$',
].join('\n');
const HTML = '<!doctype html><html><body><script>window.__marker = 4</script><h1>captured page</h1></body></html>\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__marker = 5"><text>captured logo</text></svg>\n';

function reference(home: string, text: string, path: string) {
  const sha256 = createHash('sha256').update(text).digest('hex');
  writeFileSync(join(home, 'sheet', S, 'refs', sha256), text);
  return { abs: `/Users/me/work/proj/${path}`, bytes: text.length, kind: 'text', mtimeMs: 1763888400000, numLines: 1, path, sha256, size: text.length, startLine: 1, totalLines: 1 };
}

test('an agent’s text is drawn as text, a refused link has no address, and nothing comes from outside the page', async ({ page, context, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1, { context: CONTEXT }), question(2)]);
  const html = reference(mawsd.home, HTML, 'site/index.html');
  const svg = reference(mawsd.home, SVG, 'site/logo.svg');
  const state = JSON.parse(readFileSync(join(mawsd.home, 'sheet', S, 'state.json'), 'utf8')) as { questions: { references: unknown[] }[] };
  state.questions[1]!.references = [html, svg];
  writeFileSync(join(mawsd.home, 'sheet', S, 'state.json'), JSON.stringify(state));

  const violations = await violationsOf(context);
  const requests: string[] = [];
  page.on('request', (request) => void requests.push(request.url()));
  const bodies: Response[] = [];
  page.on('response', (response) => void (new URL(response.url()).pathname === `/api/sheets/${S}/body` && bodies.push(response)));
  await context.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'elsewhere' }));
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  const q1 = page.locator('[data-sheet-question="q1"]');
  await expect(q1).toBeVisible({ timeout: 20_000 });

  // the tags are characters, and no image is drawn
  await expect(q1).toContainText('<script>window.__marker = 1</script>');
  await expect(q1).toContainText('<img src="x" onerror="window.__marker = 2">');
  await expect(q1.locator('img')).toHaveCount(0);
  await expect(q1.locator('script')).toHaveCount(0);
  await expect(q1.locator('pre')).toContainText('const sailing = 1;');
  await expect(q1.locator('.katex')).not.toHaveCount(0);

  // the refused links (the remote picture is one, drawn by its words): no href, and nothing a gesture can follow; the
  // `javascript:` one is not even a link, its words plain text
  const refused = q1.locator('[data-link-refused]');
  await expect(refused).toHaveText(['a remote picture', 'write to us', 'a stray path']);
  for (const link of await refused.all()) expect(await link.getAttribute('href')).toBeNull();
  await expect(q1.getByText('run it')).toBeVisible();
  expect(await q1.locator('[href]').evaluateAll((all) => all.map((element) => element.getAttribute('href')))).toEqual(['https://example.com/page']);
  const pages = context.pages().length;
  await refused.nth(1).click({ button: 'middle' });
  await refused.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await refused.nth(0).click();
  await q1.getByText('run it').click();
  await refused.nth(2).click({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(context.pages()).toHaveLength(pages);
  await expect(page).toHaveURL(`${mawsd.url}/s/${S}`);

  // the https link opens a new tab, which has no opener
  const opened = context.waitForEvent('page');
  await q1.getByText('the site').click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe('https://example.com/page');
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();

  // the captured HTML and SVG files open as characters
  const q2 = page.locator('[data-sheet-question="q2"]');
  await q2.getByRole('button', { name: /site\/index\.html/ }).click();
  await q2.getByRole('button', { name: /site\/logo\.svg/ }).click();
  await expect(q2).toContainText('<script>window.__marker = 4</script>');
  await expect(q2).toContainText('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__marker = 5">');
  await expect(q2.locator('svg text')).toHaveCount(0);
  // and on the wire (rule 4): each answered as plain text the browser may not sniff, byte for byte the capture
  expect(bodies).toHaveLength(2);
  const answered = await Promise.all(
    bodies.map(async (response) => ({ status: response.status(), type: response.headers()['content-type'], sniff: response.headers()['x-content-type-options'], bytes: (await response.body()).toString('base64') })),
  );
  const plain = { status: 200, type: 'text/plain; charset=utf-8', sniff: 'nosniff' };
  expect(answered).toEqual(
    expect.arrayContaining([
      { ...plain, bytes: Buffer.from(HTML).toString('base64') },
      { ...plain, bytes: Buffer.from(SVG).toString('base64') },
    ]),
  );

  expect(await page.evaluate(() => (window as { __marker?: number }).__marker)).toBeUndefined();
  expect(requests.filter((url) => !url.startsWith(`${mawsd.url}/`) && !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
  expect(requests.some((url) => url.includes('remote.png'))).toBe(false);
  expect(await violations()).toEqual([]);
});
