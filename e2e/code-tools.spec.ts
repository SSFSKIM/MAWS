// C8c's code tools end to end (C8c execution document, acceptance items 3 and 5), run by `pnpm e2e:code` over the
// harness build. Two groups: the `#panel` harness (Review and its hand-offs over C6's receipt fixture and a scratch
// repository, through `window.__maws_harness.code`), and the product app in stub mode over the scratch repository
// `buildCodeScratch` makes (Files, the viewer, `files.*` and Review against real files and real git). The product has
// no harness API, so its cases read what they assert from the DOM and drive it with the clicks a reader makes; a line
// is reached through Review's `Open file ↗` on a hunk at that line (the product's own path to a line), and a diff tab
// is opened by writing it into layout.json and reloading (C5's restore path).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import type { PanelHarnessApi } from '../src/renderer/src/harness/panel/api';
import type { CodeHarnessApi } from '../src/renderer/src/harness/code/api';
import {
  addTool, documentEnd, expectLandedOn, invoke, menu, notice, numstat, openInViewer, openReview, otherThemeColours, recordNotices, restoreWithTab, reveal,
  selectReviewFile, shortWindow, treeRow, withProduct,
} from './support/code-product';
import { buildCodeScratch, GENERATED_LINES, generatedLine, MARKER_LINE, SVG_TEXT, type CodeScratch } from './support/code-scratch';
import { test, type MawsLaunch } from './support/launch';
import { latencyBudgets, MEASURED_WAIT_MS } from './support/latency';

const REFUSAL = "path outside the session's directories";
const DIR_A = '/tmp/maws-harness/a'; // session A's directory in the harness scenario
const HARNESS_ENV = { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json' };

// The themes' scan (`otherThemeColours`) and the stub-mode product helpers live in `support/code-product.ts` (E5 M4),
// shared with the editor spec.

// ---- the #panel harness ----------------------------------------------------------------------------------------------------

type HarnessWindow = { __maws_harness?: { page?: string; panel?: PanelHarnessApi; code?: CodeHarnessApi } };
type Fn<T> = { [M in keyof T]: T[M] extends (...args: never[]) => unknown ? M : never }[keyof T];

class Harness {
  constructor(readonly maws: MawsLaunch) {}
  get page(): Page {
    return this.maws.page;
  }
  get region(): Locator {
    return this.page.locator('[data-region="panel"]');
  }

  static async open(maws: MawsLaunch): Promise<Harness> {
    const h = new Harness(maws);
    await h.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness !== undefined, null, { timeout: 15_000 });
    await h.page.evaluate(() => (location.hash = '#panel'));
    await h.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness?.page === 'panel', null, { timeout: 15_000 });
    await h.panel('ready');
    await h.panel('hydrated');
    return h;
  }

  panel<M extends Fn<PanelHarnessApi>>(method: M, ...args: Parameters<PanelHarnessApi[M]>): Promise<Awaited<ReturnType<PanelHarnessApi[M]>>> {
    return this.page.evaluate(([m, a]) => ((window as unknown as HarnessWindow).__maws_harness!.panel![m] as (...x: unknown[]) => unknown)(...a), [method, args] as const) as never;
  }
  code<M extends Fn<CodeHarnessApi>>(method: M, ...args: Parameters<CodeHarnessApi[M]>): Promise<Awaited<ReturnType<CodeHarnessApi[M]>>> {
    return this.page.evaluate(([m, a]) => ((window as unknown as HarnessWindow).__maws_harness!.code![m] as (...x: unknown[]) => unknown)(...a), [method, args] as const) as never;
  }
  review = (surface?: 'panel' | 'tab') => this.code('review', surface);
  // The transcript's store view of fake session A, through `page.evaluate` of the code probes.
  transcript(id: 'A' | 'B') {
    return { expandAll: () => this.page.evaluate((id) => (window as unknown as HarnessWindow).__maws_harness!.panel!.transcript(id).expandAll(), id) };
  }
  expectQuietConsole(): void {
    expect(this.maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  }
}

// A scratch repository for the test's body, with fake session A's record pointed at it (git takes a directory, so
// Review and the summary read it; `files.*` still judges A against the harness scenario's directory).
async function withScratch(h: Harness, body: (scratch: CodeScratch) => Promise<void>): Promise<void> {
  const scratch = buildCodeScratch();
  try {
    await h.panel('setSession', 'A', { directory: scratch.dir });
    await body(scratch);
  } finally {
    scratch.cleanup();
  }
}

// Review on Uncommitted over the scratch repository, `src/app.ts` selected with its three hunks drawn.
async function reviewAppTs(h: Harness, opts: { pin?: boolean } = {}): Promise<string> {
  const tab = await h.panel('addTool', 'review', opts.pin ? { pin: true } : {});
  await expect.poll(async () => (await h.review('panel'))?.header).toBe('5 files changed · +4 −0 · Uncommitted');
  await h.code('selectFile', 'src/app.ts', 'panel');
  await expect.poll(async () => (await h.review('panel'))?.hunk).toEqual({ index: 1, count: 3 });
  return tab;
}

test.describe('the #panel harness: Review and its hand-offs', () => {
  test.use({ mawsEnv: HARNESS_ENV });
  test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

  test("Review changes from the receipt opens Last turn on the turn's files", async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('loadTranscript', 'A', 'transcript/edit-and-receipt');
    const receipt = h.page.locator('[data-code-harness-transcript] .transcript-receipt');
    await expect(receipt).toBeVisible();
    // The receipt's own counts, file by file (C6's row: the path as recorded in `data-path`, then `+A −R`).
    const receiptFiles = await receipt.locator('.transcript-receipt-file').evaluateAll((rows) =>
      rows.map((row) => {
        const counts = /\+(\d+) −(\d+)/.exec(row.querySelector('.transcript-counts')?.textContent ?? '');
        return { path: (row as HTMLElement).dataset.path!, added: Number(counts?.[1]), removed: Number(counts?.[2]) };
      }),
    );
    expect(receiptFiles).toHaveLength(3);

    await h.code('clickReceiptReview');
    await expect(h.region.locator('[data-chip="turn"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(h.region.locator('[data-chip="turn"]')).toHaveText('Last turn');
    await expect.poll(async () => (await h.review('panel'))?.files.length).toBe(3);
    const collapsed = (await h.review('panel'))!;
    expect(collapsed.scope).toBe('turn');
    expect(collapsed.files.map(({ path, added, removed }) => ({ path, added, removed }))).toEqual(receiptFiles);
    const sum = receiptFiles.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 });
    expect(collapsed.header).toBe(`3 files changed · +${sum.added} −${sum.removed} · Last turn`);
    expect(collapsed.hunks?.length, 'the selected file has hunks').toBeGreaterThan(0);

    // Every file's hunks, the turn collapsed (a closed turn's default), then expanded: identical.
    const everyFile = async () => {
      const out: Record<string, string[] | null> = {};
      for (const file of receiptFiles) {
        await h.code('selectFile', file.path, 'panel');
        await expect.poll(async () => (await h.review('panel'))?.selected).toBe(file.path);
        out[file.path] = (await h.review('panel'))!.hunks;
      }
      return out;
    };
    const before = await everyFile();
    for (const hunks of Object.values(before)) expect(hunks?.length).toBeGreaterThan(0);
    await h.transcript('A').expandAll();
    expect(await everyFile(), 'the same hunks with the turn expanded').toEqual(before);
    expect((await h.review('panel'))!.files).toEqual(collapsed.files);

    // The column's Transcript renders over the loaded HarnessSession's own keyed source (never an unkeyed `source:`),
    // and Review read the turn under 'A', where C8a's loadTranscript attached the same player.
    const key = await h.code('transcriptKey');
    expect(key).toMatch(/^harness:\d+$/);
    const keys = await h.code('storeKeys');
    expect(keys).toEqual(expect.arrayContaining(['A', key!]));
    expect(keys.filter((k) => k.startsWith('source:'))).toEqual([]);
    expect(await h.code('receiptTurns', 'A')).toContain(collapsed.turnId);
    expect(await h.code('receiptTurns', key!)).toEqual(await h.code('receiptTurns', 'A'));

    // A file row of the receipt opens Review with that file selected.
    await h.code('clickReceiptReview', receiptFiles[1].path);
    await expect.poll(async () => (await h.review('panel'))?.selected).toBe(receiptFiles[1].path);
    h.expectQuietConsole();
  });

  // W4 (B5): Review from the receipt opens a hidden right panel; a file row reads its path relative to the session's
  // directory, shows the turn's hunks for that file above it after 800 ms of hover (the turn folded),
  // and a click on the popover opens Review at that file; ⌘-click opens the file itself.
  test('the receipt opens a hidden panel, shows a file’s hunks on hover, and ⌘-click opens the file', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('loadTranscript', 'A', 'transcript/edit-and-receipt');
    const receipt = h.page.locator('[data-code-harness-transcript] .transcript-receipt');
    await expect(receipt).toBeVisible();
    const root = '/tmp/maws-synth-edit-and-receipt'; // the fixture's cwd
    expect(await receipt.locator('.transcript-receipt-path').allTextContents()).toEqual(['src/app.ts', 'src/store.ts', 'src/util/rows.ts']);
    const inert = () => h.region.evaluate((region) => region.hasAttribute('inert'));

    await h.panel('collapse', true);
    expect(await inert(), 'the panel is hidden').toBe(true);
    await h.code('clickReceiptReview');
    await expect.poll(inert, { message: 'Review changes opens the hidden panel' }).toBe(false);
    await expect.poll(async () => (await h.review('panel'))?.scope).toBe('turn');

    await h.panel('collapse', true);
    const row = receipt.locator(`.transcript-receipt-file[data-path="${root}/src/app.ts"]`);
    const hover = h.page.locator(`[data-receipt-hover="${root}/src/app.ts"]`);
    await row.hover();
    const hovered = Date.now();
    await expect(hover).toBeVisible();
    expect(Date.now() - hovered, 'not before 800 ms').toBeGreaterThanOrEqual(700);
    const [rowBox, hoverBox] = [(await row.boundingBox())!, (await hover.boundingBox())!];
    expect(hoverBox.y + hoverBox.height, 'above the row').toBeLessThanOrEqual(rowBox.y + 1);
    expect(hoverBox.height, 'at most 420 px tall').toBeLessThanOrEqual(420);
    expect(Math.round(hoverBox.width), 'the row’s width less 64 px').toBe(Math.round(rowBox.width) - 64);
    await expect(hover.locator('.transcript-receipt-hover-header')).toContainText('src/app.ts');
    await expect(hover.locator('.transcript-diff-line[data-diff="add"]').first()).toBeVisible(); // the turn's edit of app.ts (its Read adds none)
    await expect(hover.locator('.transcript-diff-line[data-diff="del"]').first()).toBeVisible();
    await hover.click();
    await expect.poll(inert).toBe(false);
    await expect.poll(async () => (await h.review('panel'))?.selected).toBe(`${root}/src/app.ts`);
    await h.page.mouse.move(0, 0);
    await expect(hover).toHaveCount(0);

    await row.click({ modifiers: ['Meta'] });
    await expect(h.page.locator(`[data-file-viewer][data-path="${root}/src/app.ts"]`)).toBeVisible();
    h.expectQuietConsole();
  });

  test('split and unified show the same hunks and Wrap toggles', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await h.panel('setWidth', 280);
      await reviewAppTs(h);
      const unified = (await h.review('panel'))!;
      expect(unified.mode).toBe('unified');
      await h.code('setMode', 'split', 'panel');
      await expect.poll(async () => (await h.review('panel'))?.mode).toBe('split');
      const split = (await h.review('panel'))!;
      expect(split.hunk).toEqual(unified.hunk);
      expect(split.header).toBe(unified.header);
      expect(split.hunks).toEqual(unified.hunks);
      await expect(h.region.locator('[data-review-body] tr[data-state="diff"]').first(), 'split draws the rows').toBeVisible();

      // Wrap: nothing in the diff body scrolls sideways.
      const overflow = () =>
        h.region.locator('[data-review-body]').evaluate((body) =>
          Math.max(0, ...Array.from(body.querySelectorAll<HTMLElement>('*')).map((el) => (getComputedStyle(el).overflowX === 'visible' ? 0 : el.scrollWidth - el.clientWidth))),
        );
      const unwrapped = await overflow();
      await h.code('toggleWrap', 'panel');
      await expect.poll(async () => (await h.review('panel'))?.wrap).toBe(true);
      await expect.poll(overflow, 'no horizontal overflow with Wrap').toBe(0);
      test.info().annotations.push({ type: 'split at 280 px: horizontal overflow without Wrap', description: `${unwrapped} px` });
      await h.code('toggleWrap', 'panel');
      await expect.poll(async () => (await h.review('panel'))?.wrap).toBe(false);
    });
    h.expectQuietConsole();
  });

  test('hunk navigation counts and moves', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await reviewAppTs(h);
      await expect(h.region.locator('[data-review-hunk]')).toHaveText('Showing hunk 1 of 3');
      const previous = h.region.getByRole('button', { name: 'Previous hunk' });
      const next = h.region.getByRole('button', { name: 'Next hunk' });
      await expect(previous).toBeDisabled();
      await h.code('nextHunk', 'panel');
      await expect(h.region.locator('[data-review-hunk]')).toHaveText('Showing hunk 2 of 3');
      await h.code('nextHunk', 'panel');
      await expect(h.region.locator('[data-review-hunk]')).toHaveText('Showing hunk 3 of 3');
      await expect(next).toBeDisabled();
      await h.code('prevHunk', 'panel');
      await expect(h.region.locator('[data-review-hunk]')).toHaveText('Showing hunk 2 of 3');
    });
    h.expectQuietConsole();
  });

  test('viewed markers and the mode survive a session switch under a pin', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await reviewAppTs(h, { pin: true });
      await h.code('markViewed', 'src/app.ts', 'panel');
      await h.code('setMode', 'split', 'panel');
      await expect.poll(async () => (await h.review('panel'))?.files.find((f) => f.path === 'src/app.ts')?.viewed).toBe(true);

      await h.panel('switchSession', 'B');
      await expect.poll(async () => (await h.review('panel'))?.files.some((f) => f.path === 'src/app.ts') ?? false, 'B shows its own directory').toBe(false);
      await h.panel('switchSession', 'A');
      await expect.poll(async () => (await h.review('panel'))?.files.find((f) => f.path === 'src/app.ts')?.viewed).toBe(true);
      await expect.poll(async () => (await h.review('panel'))?.mode).toBe('split');
    });
    h.expectQuietConsole();
  });

  test('the diff tab renders Review for a ref', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await reviewAppTs(h);
      const panel = (await h.review('panel'))!;
      await h.code('openTab', { kind: 'diff', ref: 'uncommitted @ src/app.ts', appSessionId: 'A' } as never);
      await expect(h.page.locator('[data-diff-tab="uncommitted @ src/app.ts"] [data-review]')).toBeVisible();
      await expect.poll(async () => (await h.review('tab'))?.selected).toBe('src/app.ts');
      const tab = (await h.review('tab'))!;
      expect(tab.scope).toBe('uncommitted');
      expect(tab.header).toBe(panel.header);
      expect(tab.files).toEqual(panel.files);
      expect(tab.hunks).toEqual(panel.hunks);
      expect(tab.hunk).toEqual({ index: 1, count: 3 });
      await expect(h.page.locator('[data-diff-tab] [data-chip]'), 'a ref fixes the scope: no chips').toHaveCount(0);
      // Their own view state: moving the tab's hunk leaves the panel's where it was.
      await h.code('nextHunk', 'tab');
      await expect.poll(async () => (await h.review('tab'))?.hunk?.index).toBe(2);
      expect((await h.review('panel'))?.hunk?.index).toBe(1);
    });
    h.expectQuietConsole();
  });

  test("the Environment row shows Review's diff stats", async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await h.panel('showSummary');
      const environment = h.region.getByRole('tabpanel', { name: 'Session overview' }).getByRole('region', { name: 'Environment' });
      await expect(environment.getByTestId('change-line')).toHaveText('+4 −0 across 5 files · 3 untracked · 1 staged');
      await environment.getByRole('button', { name: 'Review', exact: true }).click();
      await expect.poll(async () => (await h.review('panel'))?.scope).toBe('uncommitted');
      await expect(h.region.locator('[data-chip="uncommitted"]')).toHaveAttribute('aria-pressed', 'true');
    });
    h.expectQuietConsole();
  });

  test('both themes use tokens only', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async (scratch) => {
      await h.panel('loadTranscript', 'A', 'transcript/edit-and-receipt');
      const scan = async (theme: 'light' | 'dark') => {
        await h.panel('setTheme', theme);
        await expect(h.page.locator('html')).toHaveAttribute('data-theme', theme);
        const views: [string, () => Promise<void>][] = [
          [
            'Review split over a selected file, the chips',
            async () => {
              if ((await h.review('panel'))?.scope !== 'uncommitted') await reviewAppTs(h);
              await h.code('setMode', 'split', 'panel');
              await expect(h.region.locator('[data-review-body] tr[data-state="diff"]').first()).toBeVisible();
            },
          ],
          [
            "Last turn over the receipt's hunks",
            async () => {
              await h.code('clickReceiptReview');
              await expect.poll(async () => (await h.review('panel'))?.scope).toBe('turn');
              await expect(h.region.locator('[data-review-body] tr[data-state="diff"]').first()).toBeVisible();
            },
          ],
          [
            'a viewer tab (a refusal: A reads its harness directory) and the diff tab',
            async () => {
              await h.code('openTab', { kind: 'file', path: scratch.path('src/app.ts'), line: 5, appSessionId: 'A' } as never);
              await expect(h.page.locator('[data-file-viewer] [data-refusal]')).toBeVisible();
              await h.code('openTab', { kind: 'diff', ref: 'uncommitted @ src/app.ts', appSessionId: 'A' } as never);
              await expect(h.page.locator('[data-diff-tab] [data-review-body] tr[data-state="diff"]').first()).toBeVisible();
            },
          ],
          [
            'the Files tool',
            async () => {
              await h.panel('addTool', 'files');
              await expect(h.region.locator('[data-tool="files"] [role="treeitem"]').first()).toBeVisible();
            },
          ],
        ];
        for (const [view, show] of views) {
          await show();
          expect(await otherThemeColours(h.page), `${theme}: ${view}`).toEqual([]);
        }
        await h.panel('switchSession', 'A'); // back to the transcript for the next theme
      };
      await scan('dark');
      await scan('light');
    });
    h.expectQuietConsole();
  });
});

// ---- the product in stub mode over the scratch repository ------------------------------------------------------------------

test.describe('the product in stub mode over a scratch repository', () => {
  test('Files lists one node per root and opens the viewer', async () => {
    await withProduct(async (p) => {
      await addTool(p, 'Files');
      const roots = p.panel.locator('[data-tool="files"] [role="treeitem"][data-kind="root"]');
      await expect(roots).toHaveCount(1);
      await expect(roots).toHaveAttribute('data-path', p.scratch.dir);
      await expect(roots).toContainText('repo');
      await expect(roots).toContainText('directory');
      await roots.click();
      await expect(treeRow(p, p.scratch.path('.editorconfig')), 'dotfiles shown').toBeVisible();
      await expect(treeRow(p, p.scratch.path('.git')), '.git hidden').toHaveCount(0);
      await treeRow(p, p.scratch.path('src')).click();
      const children = p.panel.locator(`[data-tool="files"] [role="treeitem"][aria-level="3"]`);
      await expect(children).toHaveCount(3);
      expect(await children.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-path')))).toEqual(['app.ts', 'generated.ts', 'staged.ts'].map((name) => p.scratch.path(`src/${name}`)));
      await treeRow(p, p.scratch.path('src/app.ts')).click();
      await expect(p.page.locator(`[data-file-viewer][data-path="${p.scratch.path('src/app.ts')}"]`)).toBeVisible();
      await expect
        .poll(async () =>
          p.page.evaluate(async () => {
            const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
            // W12: every tab set's panes
            type Sets = { sets: Record<string, { panes: { activeTabId: string }[] }> };
            return result.ok ? Object.values((result.value.value as Sets).sets).flatMap((set) => set.panes.map((pane) => pane.activeTabId)) : [];
          }),
        )
        .toContain(`file:${p.scratch.path('src/app.ts')}`);
    });
  });

  test('a markdown file renders with a Source toggle', async () => {
    await withProduct(async (p) => {
      const viewer = await openInViewer(p, 'README.md');
      await expect(viewer.locator('[data-markdown-view] h1')).toHaveText('Scratch readme');
      await expect(viewer.locator('[data-markdown-view] li')).toHaveCount(2);
      await expect(viewer.locator('[data-streamdown="code-block"] pre span[style*="--shiki-dark"]').first(), 'the fence is highlighted').toBeVisible();
      await viewer.getByRole('button', { name: 'Source' }).click();
      await expect(viewer.locator('[data-code-view] .cm-content')).toContainText('# Scratch readme');
      await expect(viewer.locator('[data-code-view] .cm-content')).toContainText('```ts');
      await viewer.getByRole('button', { name: 'Rendered' }).click();
      await expect(viewer.locator('[data-markdown-view] h1')).toHaveText('Scratch readme');
    });
  });

  test('a TypeScript file highlights and jumps to the line', async () => {
    await withProduct(async (p) => {
      const review = await openReview(p);
      await selectReviewFile(review, 'src/app.ts');
      await review.getByRole('button', { name: 'Next hunk' }).click();
      await review.getByRole('button', { name: 'Next hunk' }).click();
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 3 of 3');
      await review.locator('[data-open-file]').click(); // openFile(A, src/app.ts, 25)
      const viewer = p.page.locator(`[data-file-viewer][data-path="${p.scratch.path('src/app.ts')}"]`);
      await expect(viewer.locator('[data-code-view]')).toHaveAttribute('data-language', 'TypeScript');
      await expectLandedOn(p.page, '// added at line 25');
      // A keyword token painted with --code-keyword (the grammar loads after the first paint).
      await expect
        .poll(() =>
          viewer.evaluate((root) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--code-keyword)';
            root.append(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            const keyword = Array.from(root.querySelectorAll<HTMLElement>('.cm-content span')).find((span) => span.textContent === 'export');
            return keyword ? getComputedStyle(keyword).color === want : false;
          }),
        )
        .toBe(true);
    });
  });

  test('an image renders inline', async () => {
    await withProduct(async (p) => {
      const viewer = await openInViewer(p, 'img/dot.png');
      const img = viewer.locator('[data-image-view] img');
      await expect(img).toHaveCount(1);
      expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    });
  });

  test('an SVG with non-ASCII text renders inline and keeps its Source', async () => {
    await withProduct(async (p) => {
      const path = p.scratch.path('img/label.svg');
      const read = await invoke(p.page, 'files.read', { appSessionId: p.scratch.appSessionId, path });
      expect(read.ok && read.value.encoding).toBe('utf8');
      const viewer = await openInViewer(p, 'img/label.svg');
      const img = viewer.locator('[data-image-view] img');
      await expect(img).toHaveCount(1);
      const src = (await img.getAttribute('src'))!;
      expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64').equals(readFileSync(path)), 'the payload is the file’s exact bytes').toBe(true);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      await viewer.getByRole('button', { name: 'Source' }).click();
      await expect(viewer.locator('[data-code-view] .cm-content')).toContainText(SVG_TEXT);
      await viewer.getByRole('button', { name: 'Rendered' }).click();
      await expect(viewer.locator('[data-image-view] img')).toHaveCount(1);
    });
  });

  // Scale review D scalpel-4#1: the lead keeps a basename's width (up to 40 characters) and the bar is one line high, so
  // in a narrow pane an image's zoom group and an SVG's Source ran past the bar's end, where the pane clips them.
  test('in a narrow pane an image’s zoom controls and Source stay inside the bar, the basename whole', async () => {
    const NAME = 'img/architecture-overview-diagram-v2.svg';
    await withProduct(
      async (p) => {
        const viewer = await openInViewer(p, NAME);
        await expect(viewer.locator('[data-image-view] img')).toHaveCount(1);
        await viewer.evaluate((el: HTMLElement) => (el.style.width = '420px')); // a split pane's width
        const frame = (await viewer.boundingBox())!;
        expect(Math.round(frame.width)).toBe(420);
        for (const name of ['Zoom out', 'Zoom in', 'Actual size', 'Fit', 'Source']) {
          const box = (await viewer.getByRole('button', { name, exact: true }).boundingBox())!;
          expect(box.x + box.width, `${name} inside the pane`).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
        }
        const name = viewer.locator('[data-path-name]');
        const shown = await name.evaluate((el) => ({ width: el.getBoundingClientRect().width, needed: el.scrollWidth }));
        expect(shown.width, 'the basename drawn whole').toBeGreaterThanOrEqual(shown.needed - 0.5);
        // narrower than the zoom group itself (review round 1): the group wraps among its own buttons
        const group = viewer.getByRole('group', { name: 'Zoom' });
        const intrinsic = await group.evaluate((el: HTMLElement) => {
          const probe = el.cloneNode(true) as HTMLElement;
          probe.style.cssText = 'position:absolute;visibility:hidden;width:max-content;flex-wrap:nowrap';
          document.body.append(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          return width;
        });
        const narrow = Math.floor(intrinsic * 0.7);
        await viewer.evaluate((el: HTMLElement, width) => (el.style.width = `${width}px`), narrow);
        const tight = (await viewer.boundingBox())!;
        expect(Math.round(tight.width)).toBe(narrow);
        for (const name of ['Zoom out', 'Zoom in', 'Actual size', 'Fit', 'Source']) {
          const box = (await viewer.getByRole('button', { name, exact: true }).boundingBox())!;
          expect(box.x, `${name} starts inside the pane at ${narrow} px`).toBeGreaterThanOrEqual(tight.x - 0.5);
          expect(box.x + box.width, `${name} inside the pane at ${narrow} px`).toBeLessThanOrEqual(tight.x + tight.width + 0.5);
        }
        await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
        await expect(viewer.locator('[data-zoom-stage]')).not.toHaveAttribute('data-zoom', 'fit');
        await viewer.getByRole('button', { name: 'Fit', exact: true }).click();
        await expect(viewer.locator('[data-zoom-stage]')).toHaveAttribute('data-zoom', 'fit');
        await viewer.getByRole('button', { name: 'Source', exact: true }).click();
        await expect(viewer.locator('[data-code-view] .cm-content')).toContainText(SVG_TEXT);
      },
      (scratch) => writeFileSync(scratch.path(NAME), readFileSync(scratch.path('img/label.svg'))),
    );
  });

  test('a PDF is an Open externally row', async () => {
    await withProduct(async (p) => {
      const viewer = await openInViewer(p, 'doc.pdf');
      await expect(viewer.locator('[data-external-row]')).toContainText('PDF files open outside MAWS');
      await viewer.getByRole('button', { name: 'Open externally' }).click();
      await expect.poll(() => (readFileSync(p.scratch.openLog, { encoding: 'utf8', flag: 'a+' }))).toBe(`${p.scratch.path('doc.pdf')}\n`);
      await expect(p.page.locator('iframe, embed, object')).toHaveCount(0);
    });
  });

  test('a binary is an Open externally row', async () => {
    await withProduct(async (p) => {
      const viewer = await openInViewer(p, 'data.bin');
      await expect(viewer.locator('[data-external-row]')).toContainText('Binary file · 12 B');
      await expect(viewer.getByRole('button', { name: 'Open externally' }), 'MAWS hands the OS no unknown binary').toHaveCount(0);
    });
  });

  test('a 20 MB file opens as a bounded head', async () => {
    const within = latencyBudgets();
    await withProduct(async (p) => {
      const row = await reveal(p, 'big.log');
      const started = Date.now();
      await row.click();
      const viewer = p.page.locator(`[data-file-viewer][data-path="${p.scratch.path('big.log')}"]`);
      await expect(notice(viewer)).toHaveText('Showing the first 1.0 MB of 20.0 MB', { timeout: MEASURED_WAIT_MS });
      await expect(viewer.locator('[data-code-view] .cm-line').first()).toBeVisible({ timeout: MEASURED_WAIT_MS });
      within('big.log head shown after', Date.now() - started, 2_000, 'the read completed within two seconds');
      await expect(viewer.getByRole('button', { name: 'Load more' })).toBeVisible();
      await expect(viewer.getByRole('button', { name: 'Open externally' })).toBeVisible();
    });
  });

  test('a 2 MB text file loads whole and jumps past the first chunk', async () => {
    // Line 30,000 edited in place (same length), so Review's hunk opens the viewer there.
    const marker = generatedLine(MARKER_LINE).replace("'target'", "'TARGET'");
    const within = latencyBudgets();
    await withProduct(
      async (p) => {
        const review = await openReview(p);
        await selectReviewFile(review, 'src/generated.ts');
        const notices = await recordNotices(p.page);
        const started = Date.now();
        await review.locator('[data-open-file]').click(); // openFile(A, src/generated.ts, 30000)
        const viewer = p.page.locator(`[data-file-viewer][data-path="${p.scratch.path('src/generated.ts')}"]`);
        await expectLandedOn(p.page, marker, MEASURED_WAIT_MS);
        await expect(notice(viewer)).toHaveCount(0, { timeout: MEASURED_WAIT_MS });
        within('generated.ts complete after', Date.now() - started, 2_000, 'the file loaded whole and landed within two seconds');
        const seen = await notices();
        expect(seen.some((text) => /^Loading .+ of 2\.1 MB$/.test(text)), `a Loading notice was shown: ${JSON.stringify(seen)}`).toBe(true);
        expect(seen.filter((text) => text.startsWith('Showing the first'))).toEqual([]);
        await expect.poll(async () => (await documentEnd(viewer)).number).toBe(GENERATED_LINES + 1); // the empty line after the last newline
        const end = await documentEnd(viewer);
        expect(end.last).toBe('');
        expect(end.beforeLast, "the document's last line is the file's").toBe(generatedLine(GENERATED_LINES));
      },
      (scratch) => {
        const path = scratch.path('src/generated.ts');
        const lines = readFileSync(path, 'utf8').split('\n');
        lines[MARKER_LINE - 1] = marker;
        writeFileSync(path, lines.join('\n'));
      },
    );
  });

  test('a symlink out of the root is refused with the path', async () => {
    await withProduct(async (p) => {
      const row = await reveal(p, 'link-out');
      await expect(row).toContainText(`Symbolic link → ${p.scratch.outsideFile}`);
      for (const path of [p.scratch.path('link-out'), `${p.scratch.dir}/../`, p.scratch.siblingFile]) {
        const result = await invoke(p.page, 'files.read', { appSessionId: p.scratch.appSessionId, path });
        expect(result, path).toEqual({ ok: false, error: { code: 'internal', message: REFUSAL } });
      }
      // The row opens nothing.
      await row.click();
      await expect(p.page.locator('[data-file-viewer]')).toHaveCount(0);
    });
  });

  test('Review Uncommitted matches numstat and lists the untracked files', async () => {
    await withProduct(async (p) => {
      const review = await openReview(p);
      const sum = numstat(p.scratch);
      expect(sum).toEqual({ files: 2, added: 4, removed: 0 });
      await expect(review.locator('[data-review-header]')).toHaveText(`5 files changed · +${sum.added} −${sum.removed} · Uncommitted`);
      const rows = await review.locator('[role="option"] button[data-path]').evaluateAll((buttons) =>
        buttons.map((b) => ({ path: b.getAttribute('data-path'), kind: b.getAttribute('data-kind'), counts: /\+\d+ −\d+/.exec(b.textContent ?? '')?.[0] ?? null })),
      );
      expect(rows).toEqual([
        { path: 'src/app.ts', kind: 'modified', counts: '+3 −0' },
        { path: 'src/staged.ts', kind: 'added', counts: '+1 −0' },
        ...['big.log', 'link-out', 'scratch.txt'].map((path) => ({ path, kind: 'untracked', counts: null })),
      ]);
      await selectReviewFile(review, 'src/app.ts');
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 1 of 3');
      await selectReviewFile(review, 'src/staged.ts');
      await expect(review.locator('[data-review-file-header]')).toHaveText('src/staged.ts · Added');
      for (const path of ['big.log', 'link-out', 'scratch.txt']) {
        await selectReviewFile(review, path);
        await expect(review.locator('[data-review-note]')).toHaveText('Untracked file · not in the diff');
        await expect(review.locator('[data-review-body]')).toHaveCount(0);
      }
      await expect(review.locator('[data-review-footer]')).toHaveText('main · Working tree against HEAD');
    });
  });

  test('Staged appears only when the index differs', async () => {
    const within = latencyBudgets();
    await withProduct(async (p) => {
      const review = await openReview(p);
      const staged = review.locator('[data-chip="staged"]');
      await expect(staged).toBeVisible();
      p.scratch.git('reset', '--quiet');
      const reset = Date.now();
      await expect.poll(() => staged.count(), { timeout: MEASURED_WAIT_MS, intervals: [25] }).toBe(0);
      within('Staged gone after git reset', Date.now() - reset, 1_000, 'Staged gone within a second of the reset');
      await expect(review.locator('[data-review-header]')).toHaveText('5 files changed · +3 −0 · Uncommitted');
      await expect(review.locator('[role="option"] button[data-path="src/staged.ts"]')).toHaveAttribute('data-kind', 'untracked');
    });
  });

  test('Open file lands at the first changed line and a second Open moves the line', async () => {
    await withProduct(async (p) => {
      const review = await openReview(p);
      await selectReviewFile(review, 'src/app.ts');
      await review.locator('[data-open-file]').click();
      await expectLandedOn(p.page, '// added at line 5');
      // The main area's focused pane changed tab; the panel follows the file tab's session, still A's Review.
      await review.getByRole('button', { name: 'Next hunk' }).click();
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 2 of 3');
      await review.locator('[data-open-file]').click();
      await expectLandedOn(p.page, '// added at line 14');
      await expect(p.page.locator('[data-file-viewer]')).toHaveCount(1);
      const fileTabs = await p.page.evaluate(async () => {
        const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
        type Sets = { sets: Record<string, { panes: { tabs: { id: string; kind: string; line?: number }[] }[] }> }; // W12: every tab set
        return result.ok ? Object.values((result.value.value as Sets).sets).flatMap((set) => set.panes.flatMap((pane) => pane.tabs.filter((t) => t.kind === 'file'))) : [];
      });
      expect(fileTabs.map((t) => t.id), 'one file tab').toEqual([`file:${p.scratch.path('src/app.ts')}`]);
    });
  });

  test('git.changed refreshes the list without losing the selection', async () => {
    await withProduct(async (p) => {
      await shortWindow(p); // so the diff body scrolls
      const review = await openReview(p);
      await selectReviewFile(review, 'src/app.ts');
      const body = review.locator('[data-review-body]');
      await expect(body.locator('tr[data-state="diff"]').first()).toBeVisible();
      const offset = await body.evaluate((el) => {
        el.scrollTop = Math.min(80, el.scrollHeight - el.clientHeight);
        return el.scrollTop;
      });
      test.info().annotations.push({ type: 'diff body offset before the change', description: `${offset} px` });
      expect(offset, 'the diff body scrolled, so keeping the offset means something').toBeGreaterThan(0);
      writeFileSync(p.scratch.path('README.md'), `${readFileSync(p.scratch.path('README.md'), 'utf8')}One more line.\n`);
      await expect(review.locator('[role="option"] button[data-path="README.md"]')).toBeVisible({ timeout: 5_000 });
      await expect(review.locator('[role="option"][aria-selected="true"] button[data-path="src/app.ts"]')).toBeVisible();
      await expect(review.locator('[data-review-header]')).toHaveText('6 files changed · +5 −0 · Uncommitted');
      expect(await body.evaluate((el) => el.scrollTop), 'the scroll offset is kept').toBe(offset);
    });
  });

  test('the viewer follows an edit to its file', async () => {
    const within = latencyBudgets();
    await withProduct(async (p) => {
      await shortWindow(p); // so the code view scrolls
      const viewer = await openInViewer(p, 'src/app.ts');
      const firstLine = () => viewer.locator('.cm-content .cm-line').first().textContent();
      await expect.poll(firstLine).toBe('export function f1(): number {');
      const scroller = viewer.locator('.cm-scroller');
      const offset = await scroller.evaluate((el) => {
        el.scrollTop = Math.min(40, el.scrollHeight - el.clientHeight);
        return el.scrollTop;
      });
      expect(offset, 'the code view scrolled, so keeping the offset means something').toBeGreaterThan(0);
      const path = p.scratch.path('src/app.ts');
      const started = Date.now();
      writeFileSync(path, `// a new first line\n${readFileSync(path, 'utf8')}`);
      await expect.poll(async () => viewer.locator('.cm-content').textContent(), { timeout: MEASURED_WAIT_MS, intervals: [25] }).toContain('// a new first line');
      within('viewer updated after', Date.now() - started, 1_000, 'the viewer updated within a second of the write');
      expect(await scroller.evaluate((el) => el.scrollTop), 'the scroll is kept').toBe(offset);
    });
  });

  test('Review with a path outside the roots is refused', async () => {
    await withProduct(async (p) => {
      const id = p.scratch.appSessionId;
      await expect
        .poll(async () =>
          p.page.evaluate(async () => {
            const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
            return result.ok ? JSON.stringify(result.value.value) : '';
          }),
        )
        .toContain(`session:${id}`);
      await restoreWithTab(p, [
        { id: `diff:${id}:uncommitted @ src/app.ts`, kind: 'diff', appSessionId: id, ref: 'uncommitted @ src/app.ts', pinned: false },
        { id: `diff:${id}:uncommitted @ /etc/hosts`, kind: 'diff', appSessionId: id, ref: 'uncommitted @ /etc/hosts', pinned: false },
      ]);
      const tabs = p.page.getByRole('tablist', { name: 'Open tabs' });
      await expect(tabs.getByRole('tab', { name: /^Diff · uncommitted @ \/etc\/hosts/ })).toBeVisible({ timeout: 15_000 });
      const outside = p.page.locator('[data-diff-tab="uncommitted @ /etc/hosts"]');
      await expect(outside.locator('[data-review-refused]')).toContainText(`Refused: ${REFUSAL}`);
      await expect(outside.locator('[data-review-refused]')).toContainText('/etc/hosts');
      await expect(outside.locator('[data-open-file]')).toHaveCount(0);
      // The other ref renders the same Review with its file selected, under C5's title.
      await tabs.getByRole('tab', { name: /^Diff · uncommitted @ src\/app\.ts/ }).click();
      const inside = p.page.locator('[data-diff-tab="uncommitted @ src/app.ts"]');
      await expect(inside.locator('[role="option"][aria-selected="true"] button[data-path="src/app.ts"]')).toBeVisible();
      await expect(inside.locator('[data-review-hunk]')).toHaveText('Showing hunk 1 of 3');
    });
  });

  test('the Files tree and the viewer use tokens only in both themes', async () => {
    await withProduct(
      async (p) => {
        // A refused row: an in-root directory the service cannot open is answered with the refusal.
        const locked = await reveal(p, 'locked');
        await locked.click();
        await expect(p.panel.locator('[data-tool="files"] [data-notice="refused"]')).toContainText(`Refused: ${REFUSAL}`);
        for (const theme of ['dark', 'light'] as const) {
          await menu(p.maws, `theme.${theme}`);
          await expect(p.page.locator('html')).toHaveAttribute('data-theme', theme);
          for (const [file, ready] of [
            ['src/app.ts', '[data-code-view] .cm-line'],
            ['README.md', '[data-markdown-view] h1'],
            ['img/dot.png', '[data-image-view] img'],
            ['doc.pdf', '[data-external-row]'],
          ] as const) {
            const viewer = await openInViewer(p, file);
            await expect(viewer.locator(ready).first()).toBeVisible();
            expect(await otherThemeColours(p.page), `${theme}: the tree with a refused row and ${file}`).toEqual([]);
          }
        }
      },
      (scratch) => mkdirSync(scratch.path('locked'), { mode: 0o000 }),
    );
  });
});
