// E5's editor end to end (E5 execution document, Interfaces *Scratch additions and the e2e cases*, Acceptance 2 and 3),
// run by `pnpm e2e:code` beside the code tools spec over the harness build: the product in stub mode over the scratch
// repository, each case in its own launch. Typing goes through CodeMirror's content element, the disk is read with
// `readFileSync` after each save, an external change is a `writeFileSync` on the scratch file, and its notice is
// awaited with the measured wait. The last case scans both themes for other-theme colours and writes the six
// screenshots of the editor, the merge view and the conflict view into the evidence directory.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { menu, openInViewer, otherThemeColours, withProduct, type Product } from './support/code-product';
import { CONFLICT_BLOCK, MERGE_LINES } from './support/code-scratch';
import { REPO_ROOT, test } from './support/launch';
import { MEASURED_WAIT_MS } from './support/latency';

const APP = 'src/app.ts';
const MERGE = 'conflicts/merge.ts';
const TYPED = '// typed by the owner';
const SHOTS = join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e5/shots');

const read = (p: Product, relative: string) => readFileSync(p.scratch.path(relative), 'utf8');
const write = (p: Product, relative: string, content: string) => writeFileSync(p.scratch.path(relative), content);
// `text` with its line `n` (1-based) replaced.
const withLine = (text: string, n: number, line: string) => text.split('\n').map((l, i) => (i === n - 1 ? line : l)).join('\n');

const fileTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const controls = (viewer: Locator) => viewer.locator('[data-editor-controls]');
const barButton = (viewer: Locator, name: string) => controls(viewer).getByRole('button', { name, exact: true });
const lineTexts = (viewer: Locator) => viewer.locator('.cm-content .cm-line').allTextContents();

async function openEditor(p: Product, relative: string): Promise<Locator> {
  const viewer = await openInViewer(p, relative);
  await expect(viewer).toHaveAttribute('data-editable', 'true');
  await expect(viewer.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  return viewer;
}

// The owner types a line above the document's first, through the editor's content element.
async function typeAtTop(p: Product, viewer: Locator, text: string): Promise<void> {
  await viewer.locator('.cm-content .cm-line').first().click({ position: { x: 3, y: 4 } }); // in the line's left padding: its start
  await p.page.keyboard.type(text);
  await p.page.keyboard.press('Enter');
  await expect(viewer).toHaveAttribute('data-dirty', 'true');
}

async function expectDirtyTab(page: Page, name: string, dirty: boolean): Promise<void> {
  const tab = fileTab(page, name);
  if (dirty) {
    await expect(tab).toHaveAttribute('data-dirty', 'true');
    await expect(tab.getByRole('img', { name: 'Unsaved changes' })).toHaveText('•');
  } else {
    await expect(tab).not.toHaveAttribute('data-dirty');
    await expect(tab.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0);
  }
}

async function awaitNotice(viewer: Locator): Promise<void> {
  await expect(viewer.locator('[data-theirs-notice="notice"]')).toHaveText('Changed on disk', { timeout: MEASURED_WAIT_MS });
  await expect(viewer).toHaveAttribute('data-theirs', 'notice');
}

// Every `Updated` notice the viewer draws, from now on.
async function recordUpdated(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __updated: number };
    w.__updated = 0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of Array.from(record.addedNodes))
          if (node instanceof Element && (node.matches('[data-file-viewer] [data-updated]') || node.querySelector('[data-file-viewer] [data-updated]'))) w.__updated++;
    }).observe(document.body, { subtree: true, childList: true });
  });
  return () => page.evaluate(() => (window as unknown as { __updated: number }).__updated);
}

// How many loads of the viewer's entry have completed, landing anything or not (`data-loads`).
const loads = async (viewer: Locator) => Number(await viewer.getAttribute('data-loads'));

// Every load since `before` (the count read before the act) is over, whatever it did: the count of completed loads
// moved past it and none is in flight (`data-pending`), since one write can raise two events and so two overlapping
// loads, and the older one's completion alone leaves the newer in flight.
const loadsSettledPast = (viewer: Locator, before: number, message: string) =>
  expect
    .poll(async () => ({ completed: (await loads(viewer)) > before, pending: await viewer.getAttribute('data-pending') }), { timeout: MEASURED_WAIT_MS, message })
    .toEqual({ completed: true, pending: '0' });
const ownReloadDone = (viewer: Locator, before: number) => loadsSettledPast(viewer, before, 'the own save’s re-reads completed');

const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test.describe('the editor in stub mode over a scratch repository', () => {
  test('edits and saves through File › Save file and the bar, with no Updated for its own save', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expectDirtyTab(p.page, 'app.ts', false);
      const updated = await recordUpdated(p.page);

      await typeAtTop(p, viewer, TYPED);
      await expectDirtyTab(p.page, 'app.ts', true);
      await expect(barButton(viewer, 'Save')).toBeVisible();
      const beforeMenuSave = await loads(viewer);
      await menu(p.maws, 'file.save');
      await expect.poll(() => read(p, APP)).toBe(`${TYPED}\n${original}`);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expectDirtyTab(p.page, 'app.ts', false);
      await expect(controls(viewer)).toHaveCount(0);
      // Each save's re-read is waited out before the next save, so no later count can be an earlier save's.
      await ownReloadDone(viewer, beforeMenuSave);
      expect(await updated(), 'no Updated notice for the menu’s save').toBe(0);

      await typeAtTop(p, viewer, `${TYPED}, again`);
      await expectDirtyTab(p.page, 'app.ts', true);
      const beforeBarSave = await loads(viewer);
      await barButton(viewer, 'Save').click();
      await expect.poll(() => read(p, APP)).toBe(`${TYPED}, again\n${TYPED}\n${original}`);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expectDirtyTab(p.page, 'app.ts', false);

      // The own save's re-read has completed (the count of completed loads moved), so whatever it drew is drawn: its
      // hash matched the saved one, so nothing was.
      await ownReloadDone(viewer, beforeBarSave);
      expect(await updated(), 'no Updated notice for the own saves').toBe(0);
      await expect(viewer.locator('[data-updated]')).toHaveCount(0);
      expect((await lineTexts(viewer)).slice(0, 2)).toEqual([`${TYPED}, again`, TYPED]);

      // The recorder's control: another writer's change to the clean tab is followed, with exactly one Updated, by a
      // load the count shows, so a zero above cannot come from a recorder or a counter that sees nothing.
      const beforeExternal = await loads(viewer);
      write(p, APP, `// changed on disk\n${read(p, APP)}`);
      await expect.poll(updated, { timeout: MEASURED_WAIT_MS, message: 'an external change draws Updated' }).toBe(1);
      await loadsSettledPast(viewer, beforeExternal, 'the external change’s loads are counted and none is in flight');
      expect(await updated(), 'exactly one Updated for the external change').toBe(1);
      await expect.poll(async () => (await lineTexts(viewer))[0]).toBe('// changed on disk');
      await expect(viewer.locator('[data-updated]')).toHaveCount(1);
    });
  });

  test('asks before closing a dirty tab: Cancel keeps it, Don’t save closes it and leaves the disk alone', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);
      await typeAtTop(p, viewer, TYPED);
      const tab = fileTab(p.page, 'app.ts');

      await tab.click({ button: 'middle' });
      const sheet = p.page.getByRole('dialog', { name: 'Save changes to app.ts?' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Your changes will be lost if you don’t save them.');
      await expect(sheet.getByRole('button')).toHaveText(['Don’t save', 'Cancel', 'Save']);
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toHaveCount(0);
      await expectDirtyTab(p.page, 'app.ts', true);
      await expect(viewer).toHaveAttribute('data-dirty', 'true');

      await tab.click({ button: 'middle' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Don’t save' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(tab).toHaveCount(0);
      await expect(p.page.locator('[data-file-viewer]')).toHaveCount(0);
      expect(read(p, APP), 'the disk is unchanged').toBe(original);
    });
  });

  test('Changed on disk: Reload takes the disk’s version, Keep mine lets the next save win', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);

      // Reload
      await typeAtTop(p, viewer, TYPED);
      const first = `// changed on disk, once\n${original}`;
      write(p, APP, first);
      await awaitNotice(viewer);
      for (const name of ['Reload', 'Keep mine', 'Compare', 'Save']) await expect(barButton(viewer, name)).toBeVisible();
      await barButton(viewer, 'Reload').click();
      await expect(viewer).toHaveAttribute('data-theirs', '');
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expectDirtyTab(p.page, 'app.ts', false);
      await expect.poll(async () => (await lineTexts(viewer))[0]).toBe('// changed on disk, once');
      await expect(viewer.locator('.cm-content')).not.toContainText(TYPED);
      expect(read(p, APP)).toBe(first);

      // Keep mine
      await typeAtTop(p, viewer, `${TYPED}, kept`);
      const second = `// changed on disk, twice\n${original}`;
      write(p, APP, second);
      await awaitNotice(viewer);
      await barButton(viewer, 'Keep mine').click();
      await expect(viewer).toHaveAttribute('data-theirs', '');
      await expect(viewer).toHaveAttribute('data-dirty', 'true');
      expect((await lineTexts(viewer)).slice(0, 2)).toEqual([`${TYPED}, kept`, '// changed on disk, once']);
      await barButton(viewer, 'Save').click();
      await expect.poll(() => read(p, APP), { message: 'the save wrote over the external change' }).toBe(`${TYPED}, kept\n${first}`);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expect(viewer, 'no conflict: the merge view never opened').toHaveAttribute('data-theirs', '');
      await expectDirtyTab(p.page, 'app.ts', false);
    });
  });

  test('a save over a changed file opens the merge view, and Save writes the resolution', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);
      await typeAtTop(p, viewer, TYPED);
      const theirs = withLine(original, 20, '// changed on disk at line 20');
      write(p, APP, theirs);
      await awaitNotice(viewer);

      // Saved from the notice, the stale baseline's hash answers conflict: the merge view, mine against the disk's.
      await barButton(viewer, 'Save').click();
      await expect(viewer).toHaveAttribute('data-theirs', 'merge');
      await expect(viewer.locator('[data-theirs-notice="merge"]')).toHaveText('Changed on disk since you opened it');
      const changes = viewer.locator('[data-merge-changes]');
      await expect(changes).toHaveText('2 changes from disk');
      const chunks = viewer.locator('.cm-deletedChunk');
      await expect(chunks).toHaveCount(2);
      await expect(chunks.first().getByRole('button', { name: 'Take theirs' })).toBeVisible();
      expect(read(p, APP), 'nothing written by the conflicting save').toBe(theirs);

      // The first chunk is the typed line, which the disk lacks: Take theirs drops it; the rest stays mine.
      await chunks.first().getByRole('button', { name: 'Take theirs' }).click();
      await expect(changes).toHaveText('1 change from disk');
      await expect(viewer.locator('.cm-content')).not.toContainText(TYPED);
      await chunks.first().getByRole('button', { name: 'Keep mine' }).click();
      await expect(changes).toHaveText('0 changes from disk');

      await barButton(viewer, 'Save').click();
      await expect.poll(() => read(p, APP), { message: 'the resolution: the disk’s first lines, mine at line 20' }).toBe(original);
      await expect(viewer).toHaveAttribute('data-theirs', '');
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      await expect(chunks).toHaveCount(0);
      await expect(viewer.locator('.cm-editor.cm-merge-b')).toHaveCount(0);
    });
  });

  test('a file with conflict markers shows the block with its actions, and Accept theirs resolves it', async () => {
    await withProduct(async (p) => {
      const viewer = await openEditor(p, MERGE);
      const conflicts = viewer.locator('[data-conflicts]');
      await expect(conflicts).toHaveText('1 conflict');
      await expect(viewer.locator('.cm-conflict-marker')).toHaveText(['<<<<<<< HEAD', '||||||| base', '=======', '>>>>>>> feature']);
      await expect(viewer.locator('.cm-conflict-mine')).toHaveText([CONFLICT_BLOCK.mine]);
      await expect(viewer.locator('.cm-conflict-base')).toHaveText([CONFLICT_BLOCK.base]);
      await expect(viewer.locator('.cm-conflict-theirs')).toHaveText([CONFLICT_BLOCK.theirs]);
      const actions = viewer.locator('.cm-conflict-actions');
      await expect(actions).toHaveCount(1);
      await expect(actions.getByRole('button')).toHaveText(['Accept mine', 'Accept theirs', 'Accept both']);
      await expect(actions.locator('.cm-conflict-label')).toHaveText(['mine (HEAD)', 'base', 'theirs (feature)']);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');

      await actions.getByRole('button', { name: 'Accept theirs' }).click();
      await expect(conflicts).toHaveCount(0);
      await expect(actions).toHaveCount(0);
      await expect(viewer.locator('.cm-conflict-marker')).toHaveCount(0);
      const resolved = [MERGE_LINES[0], CONFLICT_BLOCK.theirs, ...MERGE_LINES.slice(8)];
      await expect.poll(() => lineTexts(viewer)).toEqual([...resolved, '']);
      await expect(viewer).toHaveAttribute('data-dirty', 'true');

      await barButton(viewer, 'Save').click();
      await expect.poll(() => read(p, MERGE)).toBe(`${resolved.join('\n')}\n`);
      expect(read(p, MERGE).split('\n').filter((line) => /^(<{7}|\|{7}|={7}|>{7})( |$)/.test(line)), 'no marker line on disk').toEqual([]);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
    });
  });

  // E3 (M3): the seam now opens E3's comment composer, the placeholder's successor, with the same file-line anchor
  test('a line’s comment mark opens the comment composer with the file-line anchor', async () => {
    await withProduct(async (p) => {
      const viewer = await openEditor(p, APP);
      await p.page.mouse.move(0, 0);
      const mark = viewer.locator('.cm-comment-mark[aria-label="Comment on line 3"]');
      await expect(mark).toBeAttached();
      await expect(mark, 'hidden until its line’s gutter is hovered').toBeHidden();
      await mark.locator('xpath=..').hover();
      await expect(mark).toBeVisible();
      await mark.click();

      const path = p.scratch.path(APP);
      const sheet = p.page.getByRole('dialog', { name: 'Comment on app.ts:3' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute('data-comment-composer', '');
      await expect(sheet).toHaveAttribute('data-anchor-kind', 'file-line');
      await expect(sheet).toHaveAttribute('data-anchor-locator', `${path}#L3`);
      await expect(sheet.getByText(`${path}#L3`)).toBeVisible();
      await expect(sheet.getByRole('radio', { name: /Side thread/ })).toBeChecked();
      await expect(sheet.getByRole('button', { name: 'Send' })).toBeDisabled();
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
    });
  });

  test('read-only kinds stay read-only: a head, and markdown until Source', async () => {
    await withProduct(async (p) => {
      const log = await openInViewer(p, 'big.log');
      await expect(log).toHaveAttribute('data-kind', 'head');
      await expect(log.locator('[data-code-view] .cm-line').first()).toBeVisible({ timeout: MEASURED_WAIT_MS });
      await expect(log).toHaveAttribute('data-editable', 'false');
      await expect(log.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
      await expect(log.locator('.cm-content')).toHaveAttribute('title', 'Read-only: the file is larger than the editor’s cap');

      const readme = await openInViewer(p, 'README.md');
      await expect(readme.locator('[data-markdown-view] h1')).toHaveText('Scratch readme');
      await expect(readme).toHaveAttribute('data-editable', 'false');
      await expect(readme.locator('.cm-editor')).toHaveCount(0);
      await readme.getByRole('button', { name: 'Source' }).click();
      await expect(readme.locator('[data-code-view] .cm-content')).toContainText('# Scratch readme');
      await expect(readme).toHaveAttribute('data-editable', 'true');
      await expect(readme.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
      await readme.getByRole('button', { name: 'Rendered' }).click();
      await expect(readme.locator('[data-markdown-view] h1')).toHaveText('Scratch readme');
      await expect(readme).toHaveAttribute('data-editable', 'false');
    });
  });

  test('the editor, the notice, the merge view and the conflict view use tokens only in both themes', async () => {
    mkdirSync(SHOTS, { recursive: true });
    await withProduct(async (p) => {
      await p.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
      await expect.poll(() => p.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1280, expect.any(Number)]);
      const original = read(p, APP);
      const shoot = async (viewer: Locator, view: string, theme: string) => {
        await p.page.mouse.move(0, 0);
        await frames(p.page);
        const box = (await viewer.boundingBox())!;
        await p.page.screenshot({ path: join(SHOTS, `e5-${view}-${theme}.png`), clip: box });
      };
      const scan = async (theme: string, view: string) => expect(await otherThemeColours(p.page), `${theme}: ${view}`).toEqual([]);

      for (const theme of ['light', 'dark'] as const) {
        await menu(p.maws, `theme.${theme}`);
        await expect(p.page.locator('html')).toHaveAttribute('data-theme', theme);

        const viewer = await openEditor(p, APP);
        await expect(viewer).toHaveAttribute('data-theirs', '');
        await typeAtTop(p, viewer, `${TYPED} (${theme})`);
        // the grammar's colours are in (the language loads after the first paint)
        await expect(viewer.locator('.cm-content span', { hasText: /^export$/ }).first()).toBeVisible();
        await scan(theme, 'a dirty editor');
        await shoot(viewer, 'editor', theme);

        write(p, APP, withLine(original, 12, `// changed on disk (${theme})`));
        await awaitNotice(viewer);
        await scan(theme, 'the Changed on disk notice');

        await barButton(viewer, 'Compare').click();
        await expect(viewer).toHaveAttribute('data-theirs', 'merge');
        await expect(viewer.locator('[data-merge-changes]')).toHaveText('2 changes from disk');
        await expect(viewer.locator('.cm-deletedChunk')).toHaveCount(2);
        await scan(theme, 'the merge view');
        await shoot(viewer, 'merge', theme);
        await barButton(viewer, 'Reload').click(); // back to a clean tab for the next theme
        await expect(viewer).toHaveAttribute('data-dirty', 'false');

        const merge = await openEditor(p, MERGE);
        await expect(merge.locator('[data-conflicts]')).toHaveText('1 conflict');
        await expect(merge.locator('.cm-conflict-actions')).toBeVisible();
        await scan(theme, 'the conflict view');
        await shoot(merge, 'conflict', theme);
      }
    });
  });

  // M5 (the owner's ruling of 2026-10-06): the quit question names the unsaved files and offers Save all, Quit anyway
  // and Cancel, answered here through MAWS_E2E_QUIT_ANSWER (no native dialog), the quit made as C12's e2e makes it.
  test('quitting with a dirty tab under MAWS_E2E_QUIT_ANSWER=cancel keeps the app and the dirty tab', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);
      await typeAtTop(p, viewer, TYPED);
      const lines = guardLines(p.maws);
      await answerQuitWith(p.maws, 'cancel');
      try {
        await quit(p.maws);
        await expect.poll(lines, { message: 'the question named the unsaved file and was cancelled' }).toContainEqual(expect.stringMatching(/^quit-guard: 1 unsaved file(, .+)?, auto-answered cancel$/));
        expect(p.maws.app.process().exitCode, 'the app is still running').toBeNull();
        await expectDirtyTab(p.page, 'app.ts', true);
        await expect(viewer).toHaveAttribute('data-dirty', 'true');
        expect(read(p, APP), 'nothing was saved').toBe(original);
      } finally {
        await answerQuitWith(p.maws, null); // the teardown's quit answers as by default (Quit anyway)
      }
    });
  });

  test('quitting with a dirty tab under MAWS_E2E_QUIT_ANSWER=save_all saves the file to disk and the app exits', async () => {
    await withProduct(async (p) => {
      const original = read(p, APP);
      const viewer = await openEditor(p, APP);
      await typeAtTop(p, viewer, TYPED);
      const lines = guardLines(p.maws);
      await answerQuitWith(p.maws, 'save_all');
      const child = p.maws.app.process();
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      await quit(p.maws);
      await exitWithin(exited, 20_000, lines);
      expect(lines()).toContainEqual(expect.stringMatching(/^quit-guard: 1 unsaved file(, .+)?, auto-answered save_all$/));
      expect(read(p, APP), 'Save all wrote the document').toBe(`${TYPED}\n${original}`);
    });
  });
});

// ---- M5: the quit, as e2e/c12-quit.spec.ts drives it -----------------------------------------------------------------------

// The guard's stderr lines from now on (`quit-guard: …`, `quit-report: …`).
function guardLines(maws: Product['maws']): () => string[] {
  let text = '';
  maws.app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
  return () => text.split('\n').filter((line) => line.startsWith('quit-guard:') || line.startsWith('quit-report:'));
}

const quit = (maws: Product['maws']) => maws.app.evaluate(({ app }) => app.quit());

// The answer the guard gives under MAWS_E2E; null restores the default (Quit, Quit anyway).
const answerQuitWith = (maws: Product['maws'], answer: 'cancel' | 'save_all' | null) =>
  maws.app.evaluate((_electron, a) => {
    if (a === null) delete process.env.MAWS_E2E_QUIT_ANSWER;
    else process.env.MAWS_E2E_QUIT_ANSWER = a;
  }, answer);

// The app's exit, bounded so a quit that never comes fails here with the guard's own lines instead of the test timeout.
async function exitWithin(exited: Promise<void>, ms: number, lines: () => string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`MAWS did not quit within ${ms} ms; the guard said: ${JSON.stringify(lines())}`)), ms)));
  try {
    await Promise.race([exited, late]);
  } finally {
    clearTimeout(timer);
  }
}
