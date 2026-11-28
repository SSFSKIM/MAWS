// No chunk from a stranger (T28; §P "The page's lazy chunks are gated as its requests are"): the page's own code is in
// its load, and what the Markdown stack loads later, a code language's grammar, a theme, the diagram renderer, is asked
// for only while the tab's own proven connection is open. With the daemon stopped and a stand-in on its port that
// answers every path with a script that sets a marker, a sheet on screen that draws Markdown it never drew before (an
// option's preview, at a focus change) draws it plain and asks the stand-in for nothing; once the real daemon is back,
// the same blocks draw highlighted, and the diagram drawn.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { question, questionRecord } from './records';
import { impostor, until } from './rig';

const S = '5eed0000-0000-4000-8000-0000000000c5';
const card = (page: Page) => page.locator('[data-sheet-question="q1"]');
const option = (page: Page, label: string) => card(page).getByRole('radio', { name: label });
const preview = (page: Page, label: string) => card(page).locator(`[data-sheet-preview="${label}"]`);
const highlighted = (page: Page, label: string) => preview(page, label).locator('[data-streamdown="code-block-body"] span[style*="--shiki"]');
const diagram = (page: Page, label: string) => preview(page, label).locator('.transcript-mermaid[data-drawn] [data-streamdown="mermaid"] [role="img"] > svg');
const strangerRan = (page: Page) => page.evaluate(() => (globalThis as { __strangerRan?: number }).__strangerRan ?? 0);

test('no chunk from a stranger: a preview drawn first while the port is another’s is drawn plain and asks it for nothing, and draws highlighted once mawsd is back', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [
    question(1, {
      options: [
        { label: 'Way 1a', recommended: true, preview: 'Keep the module as it is.' },
        { label: 'Way 1b', preview: '```python\ndef route(part):\n    return part.way\n```' },
        { label: 'Way 1c', preview: '```mermaid\ngraph TD\n  Survey --> Route\n```' },
      ],
    }),
  ]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await expect(preview(page, 'Way 1a')).toContainText('Keep the module as it is.');

  await mawsd.stop();
  const stand = await impostor(mawsd.port, 'silent', undefined, { scripts: true });
  try {
    await until(() => stand.heard.requests.length >= 1, 20_000, 'the tab’s reconnection to the stand-in');
    await option(page, 'Way 1b').focus();
    await expect(preview(page, 'Way 1b').locator('[data-streamdown="code-block"]')).toContainText('return part.way');
    await page.waitForTimeout(1_000);
    await expect(highlighted(page, 'Way 1b')).toHaveCount(0); // plain, its grammar not asked for
    await option(page, 'Way 1c').focus();
    await expect(preview(page, 'Way 1c').locator('[data-streamdown="code-block"]')).toContainText('Survey --> Route'); // its source, as code
    await page.waitForTimeout(1_500);
    await expect(highlighted(page, 'Way 1c')).toHaveCount(0);
    await expect(diagram(page, 'Way 1c')).toHaveCount(0);
    expect(stand.heard.requests.map((request) => request.target).filter((target) => target !== '/live')).toEqual([]);
    expect(await strangerRan(page)).toBe(0);
  } finally {
    await stand.close();
  }

  await mawsd.restart();
  await expect(diagram(page, 'Way 1c')).toBeVisible({ timeout: 30_000 });
  await option(page, 'Way 1b').focus();
  await expect(highlighted(page, 'Way 1b').first()).toBeVisible({ timeout: 20_000 });
  expect(await strangerRan(page)).toBe(0);
});
