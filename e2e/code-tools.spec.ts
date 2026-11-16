// C8c's code tools end to end (C8c execution document, acceptance items 3 and 5), run by `pnpm e2e:code` over the
// harness build. Two groups: the `#panel` harness (Review and its hand-offs over C6's receipt fixture and a scratch
// repository, through `window.__maws_harness.code`), and the product app in stub mode over the scratch repository
// `buildCodeScratch` makes (Files, the viewer, `files.*` and Review against real files and real git). The product has
// no harness API, so its cases read what they assert from the DOM and drive it with the clicks a reader makes; a line
// is reached through Review's `Open file ↗` on a hunk at that line (the product's own path to a line), and a diff tab
// is opened by writing it into layout.json and reloading (C5's restore path). UX wave U6b-1
// (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces §G): a file a session opens is a tab of
// its side column, beside the chat, with Files' tree at its left; the main strip gains a file tab only on ⌘-click.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import { slugOf } from '../src/engine-host/fs/paths';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import type { AppSessionId } from '../src/shared/graph/ids';
import type { PanelHarnessApi } from '../src/renderer/src/harness/panel/api';
import type { CodeHarnessApi } from '../src/renderer/src/harness/code/api';
import {
  addTool, documentEnd, expectLandedOn, invoke, menu, notice, numstat, openInViewer, openReview, otherThemeColours, recordNotices, restoreWithTab, reveal,
  selectReviewFile, shortWindow, sideFileTab, treeRow, withProduct, type Product,
} from './support/code-product';
import { buildCodeScratch, GENERATED_LINES, generatedLine, MARKER_LINE, SVG_TEXT, type CodeScratch } from './support/code-scratch';
import { INVENTED_RED, markPixels, minimalPdf, recordedWebm, silentWav, type Rgb } from './support/media-fixtures'; // UX wave U6b-2
import { created } from './support/nothing-created'; // UX wave U6b-2
import { addressed, localRef } from './support/address';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { latencyBudgets, MEASURED_WAIT_MS } from './support/latency';
import { activeMainTab, hideSurfaces, mainTabById, mainTabs, mountedTabs, openSurface, pinSurfaceForSessions, sessionCard, sideColumn, sideTab, surface, unfoldSessionCard } from './support/shell';
import { sidebarRow } from './support/sidebar';

const REFUSAL = "path outside the session's directories";
const DIR_A = '/tmp/maws-harness/a'; // session A's directory in the harness scenario
const HARNESS_ENV = { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json' };

// UX wave U6b-1: what layout.json holds of the files open beside a chat (each Files tab's `file` in `panelTools.params`,
// sorted) and of the main strip's file tabs (their ids, in every tab set).
// The main strip's tab ids, in strip order (an inventory: hidden tabs included).
const stripIds = (page: Page) => mountedTabs(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));

async function storedFiles(page: Page): Promise<{ beside: string[]; main: string[] }> {
  return page.evaluate(async () => {
    const params = await window.maws.invoke('layout.get', { key: 'panelTools.params' });
    const tabs = await window.maws.invoke('layout.get', { key: 'main.tabs' });
    type Params = { params?: Record<string, { file?: unknown } | null> };
    type Sets = { sets: Record<string, { panes: { tabs: { id: string; kind: string }[] }[] }> };
    const beside = params.ok ? Object.values((params.value.value as Params | null)?.params ?? {}).flatMap((held) => (typeof held?.file === 'string' ? [held.file] : [])) : [];
    const main = tabs.ok ? Object.values((tabs.value.value as Sets | null)?.sets ?? {}).flatMap((set) => set.panes.flatMap((pane) => pane.tabs.filter((tab) => tab.kind === 'file').map((tab) => tab.id))) : [];
    return { beside: beside.sort(), main };
  });
}

// ---- UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6): a session's file in its frame --

const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'; // Chromium's PDF viewer, beneath a PDF's frame
const UNLABELLED_WORDS = 'Café, naïve, Ελληνικά, 東京'; // an invented line of non-ASCII text, in a page that declares no charset

// What Chromium's PDF viewer draws under the frame of `url` (a token's URL, no fragment): per viewer frame beneath it, its
// toolbar's height (0 when hidden: the viewer always builds the element) and its document's title, read in the viewer's
// own page; or `NOT_READY` for a viewer frame whose `pdf-viewer` or toolbar is not built yet, a value no matcher of the
// scenes accepts, so a poll asks again (a throw would end the poll at once). A failure to run or parse the read still throws.
const NOT_READY = 'not ready' as const;
type ViewerRead = { toolbar: number; title: string } | typeof NOT_READY;
async function pdfViewerOf(maws: MawsLaunch, url: string): Promise<ViewerRead[]> {
  const reads = await maws.app.evaluate(
    async ({ BrowserWindow }, { url, viewer }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
      const script = `(() => {
        const element = document.querySelector('pdf-viewer');
        const toolbar = element && element.shadowRoot && element.shadowRoot.querySelector('viewer-toolbar');
        return JSON.stringify(toolbar ? { toolbar: toolbar.getBoundingClientRect().height, title: document.title } : null);
      })()`;
      const shown: ({ toolbar: number; title: string } | null)[] = [];
      for (const frame of win.webContents.mainFrame.framesInSubtree.filter((f) => f.url.startsWith(viewer) && (f.parent?.url ?? '').startsWith(url))) shown.push(JSON.parse(String(await frame.executeJavaScript(script, true))) as { toolbar: number; title: string } | null);
      return shown;
    },
    { url, viewer: PDF_VIEWER },
  );
  return reads.map((read) => read ?? NOT_READY);
}

// How many pixels of a PDF frame are its page's square of `mark` (`minimalPdf`): drawn, not just framed.
const drawnMark = (p: Product, frame: Locator, mark?: Rgb) => markPixels(p.maws.app, p.page, frame, mark);
const DRAWN = 2_000; // pixels of the square, on a page fitted to a tab's width: tens of thousands; none on an error or blank page

// The page drawn in a file viewer's HTML frame, as Playwright reaches it (its own document, another origin).
async function frameOfViewer(page: Page, viewer: Locator): Promise<Frame> {
  const src = (await viewer.locator('[data-artifact-frame="html"]').getAttribute('src'))!;
  let found: Frame | undefined;
  await expect.poll(() => (found = page.frames().find((frame) => frame.url() === src)) !== undefined, { message: `a frame at ${src}` }).toBe(true);
  return found!;
}

// What the open seam received, less the file frames' own lines (`frame-decision`, `frame-entry`), which share its log.
const openedFiles = (p: Product) => readFileSync(p.scratch.openLog, { encoding: 'utf8', flag: 'a+' }).split('\n').filter((line) => line !== '' && !line.startsWith('frame-'));

// What the case compares before and after, to show the file's frame created nothing (B8; support/nothing-created.ts).
const snapshot = (p: Product) => created(p.page, p.maws.userData, p.scratch.appSessionId);

// The responder's entries for `url` (the e2e seam's `frame-entry <method> <range|-> <url>` lines): each request's range.
const entryRanges = (p: Product, url: string) =>
  readFileSync(p.scratch.openLog, { encoding: 'utf8', flag: 'a+' })
    .split('\n')
    .filter((line) => line.startsWith('frame-entry ') && line.endsWith(` ${url}`))
    .map((line) => line.split(' ')[2]!);

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
async function reviewAppTs(h: Harness, opts: { pin?: boolean } = {}): Promise<void> {
  await openSurface(h.page, 'Review');
  if (opts.pin) await pinSurfaceForSessions(h.page, 'Review');
  // Opening an existing surface preserves its scope, including Last turn from the previous theme scan.
  const uncommitted = h.region.locator('[data-chip="uncommitted"]');
  await uncommitted.click();
  await expect(uncommitted).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await h.review('panel'))?.header).toBe('5 files changed · +4 −0 · Uncommitted');
  await h.code('selectFile', 'src/app.ts', 'panel');
  await expect.poll(async () => (await h.review('panel'))?.hunk).toEqual({ index: 1, count: 3 });
}

test.describe('the #panel harness: Review and its hand-offs', () => {
  test.use({ mawsEnv: HARNESS_ENV });
  test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

  test("Review Last turn shows the turn's files without a receipt card", async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('loadTranscript', 'A', 'transcript/edit-and-receipt');
    await expect(h.page.locator('[data-code-harness-transcript] .transcript-receipt')).toHaveCount(0);
    const root = '/tmp/maws-synth-edit-and-receipt/src';
    const turnFiles = [
      { path: `${root}/app.ts`, added: 1, removed: 1 },
      { path: `${root}/store.ts`, added: 3, removed: 3 },
      { path: `${root}/util/rows.ts`, added: 3, removed: 0 },
    ];
    await h.page.locator('[data-code-harness-transcript]').getByRole('button', { name: 'Turn summary' }).click();
    await h.page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await expect(h.region.locator('[data-chip="turn"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(h.region.locator('[data-chip="turn"]')).toHaveText('Last turn');
    await expect.poll(async () => (await h.review('panel'))?.files.length).toBe(3);
    const collapsed = (await h.review('panel'))!;
    expect(collapsed.scope).toBe('turn');
    expect(collapsed.files.map(({ path, added, removed }) => ({ path, added, removed }))).toEqual(turnFiles);
    const sum = turnFiles.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 });
    expect(collapsed.header).toBe(`3 files changed · +${sum.added} −${sum.removed} · Last turn`);
    expect(collapsed.hunks?.length, 'the selected file has hunks').toBeGreaterThan(0);

    // Every file's hunks, the turn collapsed (a closed turn's default), then expanded: identical.
    const everyFile = async () => {
      const out: Record<string, string[] | null> = {};
      for (const file of turnFiles) {
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
    expect(key).toMatch(/^[^/]+\/harness:\d+$/); // P5 O6 M2: an address of the local machine
    const keys = await h.code('storeKeys');
    const a = await addressed(h.page, 'A'); // the page keys A's transcript by its address
    expect(keys).toEqual(expect.arrayContaining([a, key!]));
    expect(keys.filter((k) => k.startsWith('source:'))).toEqual([]);
    expect(await h.code('changedTurns', a)).toContain(collapsed.turnId);
    expect(await h.code('changedTurns', key!)).toEqual(await h.code('changedTurns', a));

    await h.code('selectFile', turnFiles[1].path, 'panel');
    await expect.poll(async () => (await h.review('panel'))?.selected).toBe(turnFiles[1].path);
    h.expectQuietConsole();
  });

  test('an inline edit discloses its diff and opens the changed file', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('loadTranscript', 'A', 'transcript/edit-and-receipt');
    const transcript = h.page.locator('[data-code-harness-transcript]');
    // The visible transcript has its own harness:<n> disclosure state, distinct from Review's source A.
    const divider = transcript.locator('[data-kind="divider"] button[aria-expanded]').first();
    if (await divider.getAttribute('aria-expanded') === 'false') await divider.click();
    // UX wave U2 (O-29): the edit's run is folded until it is opened onto its calls' rows
    const folded = transcript.locator('.transcript-run-line[aria-expanded="false"]');
    for (let guard = 0; guard < 20 && (await folded.count()) > 0; guard += 1) await folded.first().click();
    await expect(folded).toHaveCount(0);
    await expect(transcript.locator('.transcript-receipt')).toHaveCount(0);
    const cell = transcript.locator('.transcript-cell').filter({ has: h.page.getByRole('button', { name: /^Edited.*app.ts.*\+1.*−1/ }) });
    await cell.locator('.transcript-cell-line').click();
    await expect(cell.locator('.transcript-diff-line[data-diff="add"]').first()).toBeVisible();
    await expect(cell.locator('.transcript-diff-line[data-diff="del"]').first()).toBeVisible();
    const file = cell.getByRole('button', { name: '/tmp/maws-synth-edit-and-receipt/src/app.ts', exact: true });
    await expect(file).toHaveAttribute('title', '/tmp/maws-synth-edit-and-receipt/src/app.ts');
    await file.click();
    // UX wave U6b-1 (A1): beside the chat, a tab of the side column; the transcript keeps its place in the main area
    await expect(h.region.locator('[data-file-viewer][data-path="/tmp/maws-synth-edit-and-receipt/src/app.ts"]'), 'the file beside the chat').toBeVisible();
    await expect(h.region.locator('[data-files-tab][data-file="/tmp/maws-synth-edit-and-receipt/src/app.ts"]')).toBeVisible();
    await expect(cell, 'the transcript keeps its place').toBeVisible();
    h.expectQuietConsole();
  });

  test('split and unified show the same hunks and Wrap toggles', async ({ maws }) => {
    const h = await Harness.open(maws);
    await withScratch(h, async () => {
      await reviewAppTs(h);
      // UX wave U8b (M1): the width set is the width of the class in view, so it is set with Review (a wide tool) in view.
      await h.panel('setWidth', 280);
      await expect.poll(async () => Math.round((await h.region.boundingBox())?.width ?? 0), 'Review at 280 px').toBe(280);
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
      await h.code('openTab', { kind: 'diff', ref: 'uncommitted @ src/app.ts', appSessionId: await addressed(h.page, 'A') } as never);
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
      await hideSurfaces(h.page);
      const environment = await unfoldSessionCard(h.page, 'Environment');
      await expect(environment.getByTestId('change-line')).toHaveText('+4 −0 across 5 files · 3 untracked · 1 staged');
      // UX wave U8b (M4 decision 4, A8): the change line is the card's control into Review, named Open changes with its
      // counts as its description; the branch row's Review button is gone.
      const changes = environment.getByRole('button', { name: 'Open changes', exact: true });
      await expect(changes).toHaveAccessibleDescription('+4 −0 across 5 files · 3 untracked · 1 staged');
      await expect(environment.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
      await changes.click();
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
            "Last turn over the tool rows’ hunks",
            async () => {
              await h.page.locator('[data-code-harness-transcript]').getByRole('button', { name: 'Turn summary' }).click();
              await h.page.getByRole('button', { name: 'Review changes', exact: true }).click();
              await expect(h.region.locator('[data-chip="turn"]')).toHaveAttribute('aria-pressed', 'true');
              await expect.poll(async () => (await h.review('panel'))?.scope).toBe('turn');
              await expect(h.region.locator('[data-review-body] tr[data-state="diff"]').first()).toBeVisible();
            },
          ],
          [
            'a viewer tab (a refusal: A reads its harness directory) and the diff tab',
            async () => {
              await h.code('openTab', { kind: 'file', path: scratch.path('src/app.ts'), line: 5, appSessionId: await addressed(h.page, 'A'), machine: await localRef(h.page) } as never);
              await expect(h.page.locator('[data-file-viewer] [data-refusal]')).toBeVisible();
              await h.code('openTab', { kind: 'diff', ref: 'uncommitted @ src/app.ts', appSessionId: await addressed(h.page, 'A') } as never);
              await expect(h.page.locator('[data-diff-tab] [data-review-body] tr[data-state="diff"]').first()).toBeVisible();
            },
          ],
          [
            'the Files tool',
            async () => {
              await openSurface(h.page, 'Files');
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
      await expect(roots).toHaveAttribute('aria-expanded', 'true');
      const dotfile = treeRow(p, p.scratch.path('.editorconfig'));
      await expect(dotfile, 'dotfiles shown without an opening click').toBeVisible();
      await expect(treeRow(p, p.scratch.path('.git')), '.git hidden').toHaveCount(0);
      await roots.click();
      await expect(roots).toHaveAttribute('aria-expanded', 'false');
      await expect(dotfile).not.toBeVisible();
      await roots.click();
      await expect(roots).toHaveAttribute('aria-expanded', 'true');
      await expect(dotfile).toBeVisible();
      await treeRow(p, p.scratch.path('src')).click();
      const children = p.panel.locator(`[data-tool="files"] [role="treeitem"][aria-level="3"]`);
      await expect(children).toHaveCount(3);
      expect(await children.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-path')))).toEqual(['app.ts', 'generated.ts', 'staged.ts'].map((name) => p.scratch.path(`src/${name}`)));
      const sessionTab = await activeMainTab(p.page).getAttribute('data-tab-id');
      const strip = await stripIds(p.page);
      await treeRow(p, p.scratch.path('src/app.ts')).click();
      // UX wave U6b-1 (A1): the file opens beside the chat, in the tab the tree was drawn in (its preview, the title in
      // italics), the tree at its left; the main strip holds the session's tab alone, still in front
      const app = p.scratch.path('src/app.ts');
      await expect(sideColumn(p.page).locator(`[data-files-tab][data-file="${app}"] [data-file-viewer][data-path="${app}"]`)).toBeVisible();
      await expect(sideColumn(p.page).locator(`[data-files-tab][data-file="${app}"] [data-files-tree][data-place="beside"]`), 'the tree at the file’s left').toBeVisible();
      await expect(sideFileTab(p.page, 'app.ts')).toHaveAttribute('data-preview', 'true');
      await expect(sideFileTab(p.page, 'app.ts').getByRole('tab').getByText('app.ts', { exact: true }), 'the preview’s title in italics').toHaveCSS('font-style', 'italic');
      expect(await stripIds(p.page), 'the main strip gains nothing').toEqual(strip);
      await expect(activeMainTab(p.page)).toHaveAttribute('data-tab-id', sessionTab!);
      await expect.poll(() => storedFiles(p.page), { message: 'layout.json holds the file beside the chat, and no main file tab' }).toEqual({ beside: [app], main: [] });
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

  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6; B1, B8): a PDF a session's path
  // names is drawn in its own tab by Chromium's viewer, from a token whose URL ends in the file's name; its toolbar is
  // hidden beside the chat and kept in the main area (card 4); Open externally is the bar's; no artifact is made.
  test("a PDF is drawn in its tab: Chromium's viewer in the frame with no toolbar beside the chat, its URL ending in the file's name; Open externally in the bar; nothing new in the Library; moved to the main area its frame is a new one with the main area's fragment", async () => {
    await withProduct(
      async (p) => {
        const path = p.scratch.path('doc.pdf');
        const before = await snapshot(p);
        const viewer = await openInViewer(p, 'doc.pdf');
        await expect(viewer).toHaveAttribute('data-kind', 'frame');
        await expect(viewer).toHaveAttribute('data-frame', 'pdf');
        await expect(viewer.locator('[data-external-row]')).toHaveCount(0);
        await expect(viewer.getByText('PDF files open outside MAWS')).toHaveCount(0);
        const frame = viewer.locator('[data-artifact-frame="pdf"]');
        await expect(frame, 'a token and the file’s name, with the side tab’s fragment').toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/doc\.pdf#toolbar=0&navpanes=0$/);
        const side = (await frame.getAttribute('src'))!;
        const url = side.slice(0, side.indexOf('#'));
        await expect.poll(async () => (await pdfViewerOf(p.maws, url)).map((shown) => (shown === NOT_READY ? shown : shown.toolbar)), { message: 'Chromium’s viewer in the frame, drawing no toolbar beside the chat' }).toEqual([0]);
        await expect.poll(() => drawnMark(p, frame), { timeout: 15_000, message: 'the page drawn: its black square' }).toBeGreaterThan(DRAWN);

        // Open externally in the bar, above the frame, handing the file itself to the system
        const open = viewer.getByRole('button', { name: 'Open externally', exact: true });
        const [button, drawn] = [(await open.boundingBox())!, (await frame.boundingBox())!];
        expect(button.y + button.height, 'the button above the frame, in the bar').toBeLessThanOrEqual(drawn.y + 0.5);
        await open.click();
        await expect.poll(() => openedFiles(p)).toEqual([path]);

        // moved to the main area: a new frame element, from the same token, with the main area's fragment, the viewer's
        // toolbar shown and titled with the file's name
        await frame.evaluate((element) => void ((element as unknown as { u6b2Side?: boolean }).u6b2Side = true));
        await sideColumn(p.page).locator(`[data-files-tab][data-file="${path}"] [data-move-to-main]`).click();
        const moved = p.page.locator(`[data-region="main"] [data-file-viewer][data-path="${path}"] [data-artifact-frame="pdf"]`);
        await expect(moved, 'the same token, the main area’s fragment').toHaveAttribute('src', `${url}#navpanes=0`, { timeout: 20_000 });
        expect(await moved.evaluate((element) => (element as unknown as { u6b2Side?: boolean }).u6b2Side === true), 'a new frame element').toBe(false);
        await expect.poll(async () => (await pdfViewerOf(p.maws, url)).map((shown) => (shown === NOT_READY ? shown : [shown.toolbar > 0, shown.title])), { message: 'the viewer’s toolbar, titled with the file’s name' }).toEqual([[true, 'doc.pdf']]);
        await expect.poll(() => drawnMark(p, moved), { timeout: 15_000, message: 'the page drawn in the main area' }).toBeGreaterThan(DRAWN);

        // nothing created: the Library, the session's artifacts and every artifact as they were, and nothing written
        // under the profile's artifacts folder
        expect(await snapshot(p), 'nothing created').toEqual(before);
      },
      (scratch) => writeFileSync(scratch.path('doc.pdf'), minimalPdf()),
    );
  });

  // UX wave U6b-2 (M6; B3): an HTML file by a path is drawn in the artifact store's sandboxed frame, alone: its inline
  // script runs, the stylesheet and the script beside it are not loaded and one line under the bar says so (card 2); a
  // self-contained page has no line; an unlabelled UTF-8 page is served as UTF-8 and a labelled one decoded by its label.
  test('an HTML file by a path runs its own script and is drawn without the stylesheet beside it, with the line that says so; a self-contained page has no line; a UTF-8 page with no declared charset reads right', async () => {
    await withProduct(
      async (p) => {
        const besideFiles = (viewer: Locator) => viewer.locator('[data-beside-files]');
        const before = await snapshot(p);
        const page = await openInViewer(p, 'web/page.html');
        await expect(page).toHaveAttribute('data-frame', 'html');
        const pageFrame = await frameOfViewer(p.page, page);
        await expect(pageFrame.locator('#marker'), 'its inline script ran').toHaveText('SCRIPT_RAN');
        await expect(besideFiles(page), 'the line under the bar').toHaveText('Shown without the files beside it');
        expect(await pageFrame.evaluate(() => getComputedStyle(document.getElementById('marker')!).color), 'the stylesheet beside it is not loaded').not.toBe('rgb(255, 0, 0)');
        expect(await pageFrame.evaluate(() => document.documentElement.dataset.external ?? 'none'), 'nor the script beside it').toBe('none');
        await page.getByRole('button', { name: 'Open externally', exact: true }).click();
        await expect.poll(() => openedFiles(p), { message: 'the page handed to the system whole' }).toEqual([p.scratch.path('web/page.html')]);

        const alone = await openInViewer(p, 'web/alone.html');
        await expect(alone).toHaveAttribute('data-frame', 'html');
        await expect((await frameOfViewer(p.page, alone)).locator('#marker')).toHaveText('SCRIPT_RAN');
        await expect(besideFiles(alone), 'a self-contained page has no line').toHaveCount(0);

        const unlabelled = await openInViewer(p, 'web/unlabelled.html');
        await expect((await frameOfViewer(p.page, unlabelled)).locator('#words'), 'an unlabelled UTF-8 page reads right').toHaveText(UNLABELLED_WORDS);
        await expect(besideFiles(unlabelled)).toHaveCount(0);
        const labelled = await openInViewer(p, 'web/labelled.html');
        await expect((await frameOfViewer(p.page, labelled)).locator('#words'), 'a labelled page decoded by its own label').toHaveText('Café naïve');
        expect(await snapshot(p), 'nothing created').toEqual(before);
      },
      (scratch) => {
        mkdirSync(scratch.path('web'));
        writeFileSync(scratch.path('web/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Styled page</title><link rel="stylesheet" href="style.css"><script src="app.js"></script></head><body><p id="marker">waiting</p><script>document.getElementById("marker").textContent = "SCRIPT_RAN";</script></body></html>');
        writeFileSync(scratch.path('web/style.css'), '#marker { color: rgb(255, 0, 0); }\n');
        writeFileSync(scratch.path('web/app.js'), 'document.documentElement.dataset.external = "ran";\n');
        writeFileSync(scratch.path('web/alone.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Alone</title><style>#marker { font-weight: 600; }</style></head><body><p id="marker">waiting</p><script>document.getElementById("marker").textContent = "SCRIPT_RAN";</script></body></html>');
        writeFileSync(scratch.path('web/unlabelled.html'), `<!doctype html><html><head><title>Unlabelled</title></head><body><p id="words">${UNLABELLED_WORDS}</p></body></html>`);
        writeFileSync(scratch.path('web/labelled.html'), Buffer.from('<!doctype html><html><head><meta charset="windows-1252"><title>Labelled</title></head><body><p id="words">Café naïve</p></body></html>', 'latin1'));
      },
      // the page's own console: the stylesheet and the script beside it, each refused by the frame's CSP; nothing else
      { frames: [/^maws-artifact:\/\/[0-9a-f]{32}\/page\.html Refused to load the stylesheet '[^']*\/style\.css' because it violates the following Content Security Policy directive: "style-src /, /^maws-artifact:\/\/[0-9a-f]{32}\/page\.html Refused to load the script '[^']*\/app\.js' because it violates the following Content Security Policy directive: "script-src /] },
    );
  });

  // UX wave U6b-2 (M6; B2): a video by a path plays and seeks in the artifact store's player and starts by itself never;
  // its position is the tab's, so moved to the main area the new element is at the time it left, paused. A sound plays,
  // and seeks to a time it has not loaded: two minutes of WAV at 44.1 kHz (10.6 MB, as the scene of record's), of which
  // the player, preloading metadata, holds the start; the seek near its end is answered by a ranged request for it.
  test('a video by a path plays and seeks, and a sound plays and seeks to a time not yet loaded by a ranged request; moved to the main area the video is at the time it left', async () => {
    await withProduct(async (p) => {
      writeFileSync(p.scratch.path('clip.webm'), await recordedWebm(p.page));
      writeFileSync(p.scratch.path('long.wav'), silentWav(120, 44_100));
      const before = await snapshot(p);
      const path = p.scratch.path('clip.webm');
      const viewer = await openInViewer(p, 'clip.webm');
      await expect(viewer).toHaveAttribute('data-frame', 'video');
      const video = viewer.locator('video[data-artifact-media="video"]');
      await expect(video).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/clip\.webm$/);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
      expect(await video.evaluate((v: HTMLVideoElement) => [v.paused, v.currentTime]), 'it does not start by itself').toEqual([true, 0]);
      await video.evaluate(async (v: HTMLVideoElement) => {
        v.muted = true;
        await v.play();
      });
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { message: 'it plays' }).toBeGreaterThan(1.2);
      const seeked = await video.evaluate(
        (v: HTMLVideoElement) =>
          new Promise<number>((resolve) => {
            v.pause();
            v.addEventListener('seeked', () => resolve(v.currentTime), { once: true });
            v.currentTime = 1;
          }),
      );
      expect(seeked).toBeCloseTo(1, 1);

      await sideColumn(p.page).locator(`[data-files-tab][data-file="${path}"] [data-move-to-main]`).click();
      const moved = p.page.locator(`[data-region="main"] [data-file-viewer][data-path="${path}"] video[data-artifact-media="video"]`);
      await expect.poll(() => moved.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
      await expect.poll(() => moved.evaluate((v: HTMLVideoElement) => v.currentTime), { message: 'at the time it left' }).toBeCloseTo(1, 1);
      expect(await moved.evaluate((v: HTMLVideoElement) => v.paused), 'paused').toBe(true);

      const sound = await openInViewer(p, 'long.wav');
      await expect(sound).toHaveAttribute('data-frame', 'audio');
      const audio = sound.locator('audio[data-artifact-media="audio"]');
      const src = (await audio.getAttribute('src'))!;
      expect(src).toMatch(/^maws-artifact:\/\/[0-9a-f]{32}\/long\.wav$/);
      await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(120, 0);
      expect(await audio.evaluate((a: HTMLAudioElement) => a.paused), 'it does not start by itself').toBe(true);
      await audio.evaluate(async (a: HTMLAudioElement) => {
        a.muted = true;
        await a.play();
      });
      await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { message: 'it plays' }).toBeGreaterThan(0);

      // staged: paused, and the target outside every range the element holds
      const target = 108;
      const held = await audio.evaluate((a: HTMLAudioElement, target) => {
        a.pause();
        const ranges: [number, number][] = [];
        for (let k = 0; k < a.buffered.length; k++) ranges.push([a.buffered.start(k), a.buffered.end(k)]);
        return { ranges, holds: ranges.some(([start, end]) => start <= target && target <= end) };
      }, target);
      expect(held.holds, `the target, ${target} s, is not loaded yet: ${JSON.stringify(held.ranges)}`).toBe(false);
      const entriesBefore = entryRanges(p, src).length; // a request made before the seek (a metadata tail read) does not count
      const landed = await audio.evaluate(
        (a: HTMLAudioElement, target) =>
          new Promise<number>((resolve) => {
            a.addEventListener('seeked', () => resolve(a.currentTime), { once: true });
            a.currentTime = target;
          }),
        target,
      );
      expect(landed, 'the seek succeeded').toBeCloseTo(target, 0);
      // a ranged request, made after the seek, from at least 90 s into the file's bytes (44-byte header, 88,200 bytes a second)
      const from = 44 + 90 * 88_200;
      await expect
        .poll(() => entryRanges(p, src).slice(entriesBefore).some((range) => Number(/^bytes=(\d+)-/.exec(range)?.[1] ?? -1) >= from), { message: `a ranged request from byte ${from} or later reached the responder` })
        .toBe(true);
      expect(await snapshot(p), 'nothing created').toEqual(before);
    });
  });

  // UX wave U6b-2 (M6; B16): a clip the player cannot play is no disabled player: its row says so and keeps Open
  // externally (decision 16; card 3).
  test('a clip the player cannot play shows its sentence and Open externally', async () => {
    await withProduct(
      async (p) => {
        const before = await snapshot(p);
        const viewer = await openInViewer(p, 'broken.mp4');
        await expect(viewer).toHaveAttribute('data-kind', 'frame');
        await expect(viewer, 'the row in the player’s place').toHaveAttribute('data-frame', 'row', { timeout: 20_000 });
        const row = viewer.locator('[data-external-row]');
        await expect(row.getByText('This video can’t be played here.', { exact: true })).toBeVisible();
        await expect(viewer.locator('video, [data-artifact-media]')).toHaveCount(0);
        await row.getByRole('button', { name: 'Open externally', exact: true }).click();
        await expect.poll(() => openedFiles(p)).toEqual([p.scratch.path('broken.mp4')]);
        expect(await snapshot(p), 'nothing created').toEqual(before);
      },
      (scratch) => writeFileSync(scratch.path('broken.mp4'), Buffer.from('These invented bytes are no video at all.\n'.repeat(64))),
    );
  });

  // UX wave U6b-2 (M6; B7): a PDF replaced on disk is read again on its folder's event, which asks for a new token: the
  // frame is made again from it, the bar flashes Updated, and the new version is what is drawn (its square red, the first's
  // black).
  test('a PDF replaced on disk is drawn again', async () => {
    await withProduct(
      async (p) => {
        const before = await snapshot(p);
        const viewer = await openInViewer(p, 'doc.pdf');
        await expect(viewer).toHaveAttribute('data-frame', 'pdf');
        const frame = viewer.locator('[data-artifact-frame="pdf"]');
        await expect.poll(() => drawnMark(p, frame), { timeout: 15_000, message: 'the first version drawn: its black square' }).toBeGreaterThan(DRAWN);
        const first = (await frame.getAttribute('src'))!;
        await expect(viewer.locator('[data-updated]')).toHaveCount(0);
        writeFileSync(p.scratch.path('doc.pdf'), minimalPdf(undefined, INVENTED_RED));
        await expect.poll(() => frame.getAttribute('src'), { timeout: 20_000, message: 'the frame drawn from a new token' }).not.toBe(first);
        await expect(frame).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/doc\.pdf#toolbar=0&navpanes=0$/);
        await expect(viewer.locator('[data-updated]')).toHaveText('Updated');
        await expect(viewer).toHaveAttribute('data-frame', 'pdf');
        const after = (await frame.getAttribute('src'))!;
        await expect.poll(async () => (await pdfViewerOf(p.maws, after.slice(0, after.indexOf('#')))).filter((shown) => shown !== NOT_READY).length, { message: 'Chromium’s viewer, built, in the new frame' }).toBe(1);
        await expect.poll(() => drawnMark(p, frame, INVENTED_RED), { timeout: 15_000, message: 'the new version drawn: its red square' }).toBeGreaterThan(DRAWN);
        expect(await drawnMark(p, frame), 'the first version’s black square gone').toBeLessThan(DRAWN / 10);
        expect(await snapshot(p), 'nothing created').toEqual(before);
      },
      (scratch) => writeFileSync(scratch.path('doc.pdf'), minimalPdf()),
    );
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
      // P5 O7 M8: an untracked file is read as Source control reads it (`git.diff`'s untracked scope, what `git add` would
      // stage), so it shows as added: its one hunk drawn, no note
      await selectReviewFile(review, 'scratch.txt');
      await expect(review.locator('[data-review-file-header]')).toHaveText('scratch.txt · Untracked');
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 1 of 1');
      await expect(review.locator('[data-review-body]')).toContainText('scratch');
      await expect(review.locator('[data-review-note]')).toHaveCount(0);
      // a symlink diffs as git shows one (mode 120000): its one added line is the target's path, never the target's content
      await selectReviewFile(review, 'link-out');
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 1 of 1');
      await expect(review.locator('[data-review-body]')).toContainText(p.scratch.outsideFile);
      await expect(review.locator('[data-review-body]')).not.toContainText('outside the repository');
      // big.log (20 MiB, one hunk of 327,680 added lines) is past Review's file cap: it says so and offers the file
      await selectReviewFile(review, 'big.log');
      await expect(review.locator('[data-review-too-large]')).toHaveText('Diff too large to display. Open the file', { timeout: 30_000 });
      await expect(review.locator('[data-review-body]')).toHaveCount(0);
      await expect(review.locator('[data-review-note]')).toHaveCount(0);
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
      const strip = await stripIds(p.page);
      await selectReviewFile(review, 'src/app.ts');
      await review.locator('[data-open-file]').click();
      await expectLandedOn(p.page, '// added at line 5');
      // UX wave U6b-1: the file opens beside the chat, in Review's place in its group (one tab in view per group); Review's
      // tab stays in the strip, and brings Review back on its hunk
      await expect(sideColumn(p.page).locator(`[data-files-tab][data-file="${p.scratch.path('src/app.ts')}"]`)).toBeVisible();
      const reviewTab = sideTab(sideColumn(p.page), /^Review/);
      await expect(reviewTab, 'Review’s tab still in its strip').toHaveCount(1);
      await reviewTab.click();
      await review.getByRole('button', { name: 'Next hunk' }).click();
      await expect(review.locator('[data-review-hunk]')).toHaveText('Showing hunk 2 of 3');
      await review.locator('[data-open-file]').click();
      await expectLandedOn(p.page, '// added at line 14');
      await expect(p.page.locator('[data-file-viewer]')).toHaveCount(1);
      await expect(sideFileTab(p.page, 'app.ts'), 'one side tab of the file').toHaveCount(1);
      await expect(reviewTab).toHaveCount(1);
      expect(await stripIds(p.page), 'no main file tab').toEqual(strip);
      await expect.poll(() => storedFiles(p.page), { message: 'one side tab of the file is stored, and no main file tab' }).toEqual({ beside: [p.scratch.path('src/app.ts')], main: [] });
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
      const id = await addressed(p.page, p.scratch.appSessionId); // the page's tabs hold the session's address
      await expect
        .poll(async () =>
          p.page.evaluate(async () => {
            const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
            return result.ok ? JSON.stringify(result.value.value) : '';
          }),
        )
        .toContain(`session:${id}`);
      await restoreWithTab(p, [
        { id: `diff:${id}:uncommitted @ src/app.ts`, kind: 'diff', appSessionId: id as AppSessionId, ref: 'uncommitted @ src/app.ts', pinned: false },
        { id: `diff:${id}:uncommitted @ /etc/hosts`, kind: 'diff', appSessionId: id as AppSessionId, ref: 'uncommitted @ /etc/hosts', pinned: false },
      ]);
      const tabs = mainTabs(p.page);
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
        // UX wave U6b-2 (M6; Interfaces §H): a framed file whose load failed, its body the sentence and Open again. A PDF
        // kept in its tab is removed (its folder's watch says so, and its frame, already drawn, stays); shown again after
        // another tab, its frame asks its URL once more and the read for it fails.
        const stopped = await openInViewer(p, 'gone.pdf');
        await expect(stopped).toHaveAttribute('data-frame', 'pdf');
        await sideFileTab(p.page, 'gone.pdf').getByRole('tab').dblclick();
        await expect(sideFileTab(p.page, 'gone.pdf'), 'kept').not.toHaveAttribute('data-preview', 'true');
        rmSync(p.scratch.path('gone.pdf'));
        await expect(notice(stopped)).toHaveText('File removed');
        for (const theme of ['dark', 'light'] as const) {
          await menu(p.maws, `theme.${theme}`);
          await expect(p.page.locator('html')).toHaveAttribute('data-theme', theme);
          for (const [file, ready] of [
            ['src/app.ts', '[data-code-view] .cm-line'],
            ['README.md', '[data-markdown-view] h1'],
            ['img/dot.png', '[data-image-view] img'],
            ['doc.pdf', '[data-artifact-frame="pdf"]'], // UX wave U6b-2: drawn in its frame, the bar judged with Open externally in it
          ] as const) {
            const viewer = await openInViewer(p, file);
            await expect(viewer.locator(ready).first()).toBeVisible();
            if (file === 'doc.pdf') await expect(viewer.getByRole('button', { name: 'Open externally', exact: true }), 'the bar’s Open externally').toBeVisible();
            // UX wave U6b-1: the scan covers the tree's column at the file's left and the preview tab's italic title
            await expect(p.panel.locator('[data-files-tree][data-place="beside"]')).toBeVisible();
            await expect(sideFileTab(p.page, basename(file))).toHaveAttribute('data-preview', 'true');
            expect(await otherThemeColours(p.page), `${theme}: the tree with a refused row beside ${file}, its tab the preview`).toEqual([]);
          }
          // UX wave U6b-2: the failure body and its button
          await sideFileTab(p.page, 'gone.pdf').getByRole('tab').click();
          await expect(stopped, 'the read for its frame failed').toHaveAttribute('data-frame', 'failed', { timeout: 20_000 });
          await expect(stopped.locator('[data-frame-stopped]').getByRole('button', { name: 'Open again', exact: true })).toBeVisible();
          expect(await otherThemeColours(p.page), `${theme}: the failure body of a framed file, and its Open again`).toEqual([]);
        }
      },
      (scratch) => {
        mkdirSync(scratch.path('locked'), { mode: 0o000 });
        // UX wave U6b-2: a PDF the viewer can draw in place of the scratch's placeholder, and one to remove
        writeFileSync(scratch.path('doc.pdf'), minimalPdf());
        writeFileSync(scratch.path('gone.pdf'), minimalPdf());
      },
      // UX wave U6b-2: the removed PDF's frame asking its URL again, answered 404 before a byte (the responder's one answer)
      { frames: [/^maws-artifact:\/\/[0-9a-f]{32}\/gone\.pdf(#\S*)? Failed to load resource: the server responded with a status of 404 \(Not Found\)$/] },
    );
  });
});

// ---- UX wave U8c-2 (§L, scene 1): the card and the code surfaces follow the agent -------------------------------------
// docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md. A session discovered from a transcript of
// invented rows in a scratch engine store, over a scratch repository with a worktree under `.claude/worktrees/`. No
// engine runs: a move by `cd` is rows appended with another `cwd` (the engine's rows then keep the launch branch); a move
// by the tool is the transcript and its folder renamed into the worktree's project folder with a `relocated` row and a
// row there, as the engine does (engine 2.1.322, cli.pretty.js:381469-381548). Every step settles on what the screen
// shows (a row's text, a mark, a listed file), never on two reads agreeing or on a read taken straight after a layout
// change.

// The app id of the session the index lists for the engine's session id, once it does.
async function indexedSession(page: Page, sid: string): Promise<string> {
  const find = () =>
    page.evaluate(async (sid) => {
      const listed = await window.maws.invoke('session.list', {});
      if (!listed.ok) throw new Error(listed.error.message);
      return listed.value.sessions.find((r) => r.engineSessionId === sid)?.appId ?? null;
    }, sid);
  await expect.poll(find, { timeout: 20_000, message: 'the session is indexed' }).not.toBeNull();
  return (await find())!;
}

test.describe('the product over a session discovered from its transcript', () => {
  test('the card and the code surfaces follow the agent', async () => {
    const repo = await ScratchRepo.create({ sentinels: false });
    const store = await StoreFixture.create();
    const answers = mkdtempSync(join(tmpdir(), 'maws-u8c2-shell-')); // the terminals' answers, outside both checkouts
    let asked = 0;
    let maws: MawsLaunch | null = null;
    try {
      const sid = '5e551011-0000-4000-8000-0000000000d1';
      const worktree = await repo.addManagedWorktree('w1');
      const sub = join(worktree, 'sub');
      mkdirSync(sub);
      // One change in each checkout, so Review and Source control say which checkout they read.
      writeFileSync(repo.path('README.md'), 'hello\nchanged in the repository\n');
      writeFileSync(join(worktree, 'worktree-note.txt'), 'made in the worktree\n');
      let turn = 0;
      let parent: string | null = null;
      const row = (cwd: string, gitBranch: string, text: string) => {
        const uuid = `u8c-${String(++turn).padStart(4, '0')}`;
        const made = { type: 'user', uuid, parentUuid: parent, cwd, gitBranch, sessionId: sid, timestamp: `2026-11-13T10:${String(turn).padStart(2, '0')}:00.000Z`, message: { role: 'user', content: text } };
        parent = uuid;
        return made;
      };
      const lines = (rows: object[]) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');
      let transcript = await store.addTranscript(repo.root, sid, [row(repo.root, 'main', 'Written in the repository')]);
      writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
      maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: '', CLAUDE_CONFIG_DIR: store.configHome, MAWS_HARNESS: '0' } });
      const { page } = maws;
      const appId = await indexedSession(page, sid);
      // Every record the window is sent for the session from here on, and any removal: the row is never absent.
      await page.evaluate((id) => {
        const seen: string[] = [];
        (window as unknown as { __u8c2: string[] }).__u8c2 = seen;
        window.maws.on('session.changed', ({ record }) => void (record.appId === id && seen.push(record.archived ? 'archived' : 'listed')));
        window.maws.on('session.removed', ({ appSessionId }) => void (appSessionId === id && seen.push('removed')));
      }, appId);
      const sessionRow = () => sidebarRow(page, { appSessionId: appId });
      await (await sessionRow()).click();

      const moved = `moved from ${basename(repo.root)}`;
      const card = () => unfoldSessionCard(page, 'Environment');
      const folderRow = () => sessionCard(page, 'Environment').getByTestId('card-folder');
      const movedFrom = () => sessionCard(page, 'Environment').getByTestId('moved-from');
      const branchRow = (branch: string) => sessionCard(page, 'Environment').getByText(`⎇ ${branch}`, { exact: true });
      const mark = async () => (await sessionRow()).getByRole('img', { name: 'Worktree', exact: true });
      const hoverPlace = async () => {
        const hover = page.locator('[data-hover-card]');
        await expect(async () => {
          await page.mouse.move(700, 20);
          await (await sessionRow()).hover();
          await expect(hover).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 10_000 });
        return hover.getByTestId('hover-place');
      };
      const review = async () => {
        await openSurface(page, 'Review');
        const body = surface(page, 'review').locator('[data-review]');
        const uncommitted = body.locator('[data-chip="uncommitted"]');
        await expect(uncommitted).toBeVisible({ timeout: 20_000 });
        if ((await uncommitted.getAttribute('aria-pressed')) !== 'true') await uncommitted.click();
        await expect(uncommitted).toHaveAttribute('aria-pressed', 'true');
        return body;
      };
      const reviewRow = (body: Locator, path: string) => body.locator(`[role="option"] button[data-path="${path}"]`);
      const firstRoot = async () => {
        await openSurface(page, 'Files');
        return surface(page, 'files').locator('[role="treeitem"][data-kind="root"]').first();
      };
      const sourceControl = async () => {
        await openSurface(page, 'Source control');
        return surface(page, 'source-control');
      };
      const scmActs = (tool: Locator) => tool.locator('[data-scm-action], [data-scm-remote-action="push"], [data-scm-remote-action="pr"]');
      // The terminals: a tab of the side column's strip by its id, its worktree warning when in view.
      const shownTab = () => sideColumn(page).locator('section[data-side-group]:has([data-surface="terminal"]) [data-side-strip] [data-tab-id]:has([role="tab"][aria-selected="true"])');
      const showTerminal = async (tabId: string) => {
        await openSurface(page, 'Terminal');
        await sideColumn(page).locator(`[data-side-strip] [data-tab-id="${tabId}"] [role="tab"]`).click();
        await expect(shownTab()).toHaveAttribute('data-tab-id', tabId);
        return surface(page, 'terminal').getByRole('status', { name: 'worktree warning' });
      };
      // The shown terminal's own shell asked where it runs: an invented marker and `pwd -P` typed into it, its answer
      // written to a file outside both checkouts (the terminal draws on a canvas). A tab whose shell never starts, or
      // whose spawn stays pending, never answers. A keystroke lost to a focus the click had not yet given is typed again.
      const shellAnswer = async () => {
        const file = join(answers, `answer-${++asked}.txt`);
        const marker = `U8C2-SHELL-${asked}`;
        const said = () => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');
        await expect(surface(page, 'terminal').getByText('Starting shell…', { exact: true }), 'the shell has started').toHaveCount(0, { timeout: 20_000 });
        await expect(async () => {
          await surface(page, 'terminal').locator('[data-testid="terminal-surface"]').filter({ visible: true }).click();
          await page.keyboard.type(`printf '%s:%s\\n' ${marker} "$(pwd -P)" > '${file}'\n`);
          await expect.poll(said, { timeout: 5_000 }).toMatch(new RegExp(`^${marker}:`));
        }).toPass({ timeout: 30_000 });
        return said().slice(marker.length + 1);
      };
      const append = (rows: object[]) => appendFileSync(transcript, lines(rows));

      // At the launch folder: the card names the repository, nothing says moved, no mark; Files' root and Review are the
      // repository's. A terminal is opened here, before any move.
      await card();
      await expect(folderRow()).toHaveText(repo.root, { timeout: 20_000 });
      await expect(branchRow('main')).toBeVisible({ timeout: 20_000 });
      await expect(movedFrom()).toHaveCount(0);
      await expect(await mark()).toHaveCount(0);
      await openSurface(page, 'Terminal');
      await expect(shownTab()).toHaveCount(1);
      const before = (await shownTab().getAttribute('data-tab-id'))!;
      expect(await shellAnswer(), 'the first terminal’s shell runs in the repository').toBe(repo.root);
      await expect(surface(page, 'terminal').getByRole('status', { name: 'worktree warning' })).toHaveCount(0);

      // `cd` into the worktree.
      append([row(worktree, 'main', 'Working in the worktree')]);
      await card();
      await expect(folderRow(), 'the folder row names the worktree').toHaveText(worktree, { timeout: 20_000 });
      await expect(movedFrom()).toHaveText(moved);
      await expect(movedFrom()).toHaveAttribute('title', repo.root);
      await expect(branchRow('worktree-w1'), 'the branch git reports at the worktree').toBeVisible({ timeout: 20_000 });
      let body = await review();
      await expect(reviewRow(body, 'worktree-note.txt'), 'Review lists the worktree’s change').toBeVisible({ timeout: 20_000 });
      await expect(reviewRow(body, 'README.md'), 'and not the repository’s').toHaveCount(0);
      let root = await firstRoot();
      await expect(root).toHaveAttribute('data-path', worktree, { timeout: 20_000 });
      await expect(root).toContainText('working folder');
      let scm = await sourceControl();
      await expect(scm.locator('[data-scm-row][data-path="worktree-note.txt"]')).toBeVisible({ timeout: 20_000 });
      await expect(scm.locator('[data-scm-row][data-path="README.md"]')).toHaveCount(0);
      await expect(scmActs(scm), 'no Push, no Open PR, no button on a row or a group').toHaveCount(0);
      await expect(scm.getByRole('textbox', { name: 'Commit message' }), 'no commit form').toHaveCount(0);
      await expect(await showTerminal(before), 'the terminal opened before stays in the repository').toContainText(`This terminal is in ${repo.root}; the session now runs in ${worktree}.`);
      expect(await shellAnswer(), 'and its shell is still there').toBe(repo.root);
      await sideColumn(page).locator('section[data-side-group]:has([data-surface="terminal"]) [data-side-strip]').getByRole('button', { name: 'Add a tool', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
      await expect(shownTab()).not.toHaveAttribute('data-tab-id', before);
      const after = (await shownTab().getAttribute('data-tab-id'))!;
      expect(await shellAnswer(), 'a new terminal’s shell starts in the worktree').toBe(worktree);
      await expect(surface(page, 'terminal').getByRole('status', { name: 'worktree warning' }), 'and warns of nothing').toHaveCount(0);
      await expect(await mark(), 'the sidebar row carries the worktree mark').toBeVisible({ timeout: 20_000 });
      await expect(await hoverPlace()).toContainText('worktree w1');
      await page.mouse.move(700, 20);

      // `cd` into a sub-folder of the worktree: the folder row's text ends with it, at the same height; nothing else moves.
      await card();
      await expect(branchRow('worktree-w1')).toBeVisible();
      await expect(folderRow()).toHaveText(worktree); // the card as it shows the worktree, before the height is read
      const heightOf = async () => (await sessionCard(page, 'Environment').boundingBox())!.height;
      const heightIn = await heightOf();
      append([row(sub, 'main', 'Working in a sub-folder')]);
      await expect(folderRow(), 'the folder row ends with the sub-folder').toHaveText(/\/sub$/, { timeout: 20_000 });
      await expect(folderRow()).toHaveText(sub);
      await expect.poll(heightOf, { message: 'the card keeps its height' }).toBe(heightIn);
      await expect(movedFrom()).toHaveText(moved);
      await expect(branchRow('worktree-w1')).toBeVisible();
      await expect(await mark()).toBeVisible();

      // `cd` back into the repository: all of it returns, the mark included.
      append([row(repo.root, 'main', 'Back in the repository')]);
      await card();
      await expect(folderRow()).toHaveText(repo.root, { timeout: 20_000 });
      await expect(movedFrom()).toHaveCount(0);
      await expect(branchRow('main')).toBeVisible({ timeout: 20_000 });
      body = await review();
      await expect(reviewRow(body, 'README.md')).toBeVisible({ timeout: 20_000 });
      await expect(reviewRow(body, 'worktree-note.txt')).toHaveCount(0);
      root = await firstRoot();
      await expect(root).toHaveAttribute('data-path', repo.root, { timeout: 20_000 });
      await expect(root).toContainText('directory');
      scm = await sourceControl();
      await expect(scm.locator('[data-scm-row][data-path="README.md"]')).toBeVisible({ timeout: 20_000 });
      await expect(scmActs(scm).first(), 'every act is back').toBeVisible();
      await expect(scm.getByRole('textbox', { name: 'Commit message' })).toBeVisible();
      await expect(await showTerminal(before), 'the first terminal is where the session is again').toHaveCount(0);
      await expect(await showTerminal(after), 'the second says it is in the worktree').toContainText(`This terminal is in ${worktree}; the session now runs in ${repo.root}.`);
      expect(await shellAnswer(), 'where its shell still is').toBe(worktree);
      await expect(await mark()).toHaveCount(0, { timeout: 20_000 });

      // The tool's way: the transcript and its folder renamed into the worktree's project folder, a `relocated` row and a
      // row there. The same card and the same mark; then back the same way.
      const moveTranscript = (to: string, branch: string, text: string) => {
        const project = join(store.paths.projects, slugOf(to));
        const target = join(project, `${sid}.jsonl`);
        mkdirSync(project, { recursive: true });
        renameSync(transcript, target);
        if (existsSync(join(dirname(transcript), sid))) renameSync(join(dirname(transcript), sid), join(project, sid));
        transcript = target;
        append([{ type: 'relocated', relocatedCwd: to, sessionId: sid }, row(to, branch, text)]);
      };
      moveTranscript(worktree, 'worktree-w1', 'Entered the worktree with the tool');
      await card();
      await expect(folderRow()).toHaveText(worktree, { timeout: 20_000 });
      await expect(movedFrom()).toHaveText(moved);
      await expect(branchRow('worktree-w1')).toBeVisible({ timeout: 20_000 });
      await expect(await mark()).toBeVisible({ timeout: 20_000 });
      moveTranscript(repo.root, 'main', 'Left the worktree with the tool');
      await card();
      await expect(folderRow()).toHaveText(repo.root, { timeout: 20_000 });
      await expect(movedFrom()).toHaveCount(0);
      await expect(await mark()).toHaveCount(0, { timeout: 20_000 });

      const seen = await page.evaluate(() => (window as unknown as { __u8c2: string[] }).__u8c2);
      expect(seen, 'never told archived or removed across the moves').not.toContain('archived');
      expect(seen).not.toContain('removed');
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    } finally {
      await maws?.cleanup();
      repo.dispose();
      await store.dispose();
      rmSync(answers, { recursive: true, force: true });
    }
  });
});

// ---- UX wave U6b-1 (A1, L1, L3): a file opens beside the chat ---------------------------------------------------------
// docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces §G. A session discovered from a
// transcript of invented rows in a scratch engine store, its reply linking two files of its folder, over a scratch
// repository with one change for Review. No engine runs. Every open is read on what the screen shows: the file's tab of
// the side column with Files' tree at its left, the main strip as it was, the session's tab in front and the reply in view.

test.describe('UX wave U6b-1: a file opens beside the chat', () => {
  test('a file opens beside the chat: from a path link, from Review and from the tree; the preview tab is reused, a double-click keeps it, ⌘-click opens a main tab', async () => {
    const repo = await ScratchRepo.create({ sentinels: false });
    const store = await StoreFixture.create();
    let maws: MawsLaunch | null = null;
    try {
      const sid = '5e551011-0000-4000-8000-0000000000b6';
      for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt', 'delta.txt']) writeFileSync(repo.path(name), `An invented file, ${name}.\n`);
      writeFileSync(repo.path('README.md'), 'hello\nchanged in the repository\n'); // the change Review opens
      const at = '2026-11-14T10:00:00.000Z';
      const row = { cwd: repo.root, sessionId: sid, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300' };
      const reply = `Read [alpha](${repo.path('alpha.txt')}) first, then [delta](${repo.path('delta.txt')}).`;
      await store.addTranscript(repo.root, sid, [
        { ...row, type: 'user', uuid: 'u-u6b1-1', parentUuid: null, message: { role: 'user', content: 'Which files should I read?' } },
        {
          ...row, type: 'assistant', uuid: 'a-u6b1-1', parentUuid: 'u-u6b1-1',
          message: { id: 'msg_u6b10001', type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
        },
      ]);
      writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
      maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: '', CLAUDE_CONFIG_DIR: store.configHome, MAWS_HARNESS: '0' } });
      const { page } = maws;
      const appId = await indexedSession(page, sid);
      await (await sidebarRow(page, { appSessionId: appId })).click();
      const main = page.locator('[data-region="main"]');
      const link = (name: string) => main.locator(`[data-chip="path"][title="${repo.path(name)}"]`);
      await expect(link('alpha.txt')).toBeVisible({ timeout: 20_000 });
      const sessionTab = `session:${await addressed(page, appId)}`;
      await expect(activeMainTab(page)).toHaveAttribute('data-tab-id', sessionTab);
      const strip = await stripIds(page);
      const machine = await localRef(page);

      // The Files tab that holds `name`, in the side column; the one preview tab of the strip; a row of the tree drawn in
      // the Files tab in view (one group here, so one tree is drawn).
      const holding = (name: string) => sideColumn(page).locator(`[data-files-tab][data-file="${repo.path(name)}"]`);
      const preview = sideColumn(page).locator('[data-side-strip] [data-tab-id][data-preview="true"]');
      const treeRowOf = (name: string) => sideColumn(page).locator(`[data-files-tab] [data-files-tree] [role="treeitem"][data-path="${repo.path(name)}"]`);
      const titleOf = (name: string) => sideFileTab(page, name).getByRole('tab').getByText(name, { exact: true });
      const besideTheChat = async (name: string, by: string) => {
        await expect(holding(name).locator(`[data-file-viewer][data-path="${repo.path(name)}"]`), `${name} beside the chat, from ${by}`).toBeVisible({ timeout: 20_000 });
        await expect(holding(name).locator('[data-files-tree][data-place="beside"]'), 'Files’ tree at its left').toBeVisible();
        expect(await stripIds(page), 'the main strip gains nothing').toEqual(strip);
        await expect(activeMainTab(page), 'the session’s tab still in front').toHaveAttribute('data-tab-id', sessionTab);
        await expect(link('alpha.txt'), 'the transcript keeps its place').toBeVisible();
      };

      // a path link in the transcript: the session's preview tab, its title in italics
      await link('alpha.txt').click();
      await besideTheChat('alpha.txt', 'a path link');
      await expect(preview).toHaveCount(1);
      const previewId = await preview.getAttribute('data-tab-id');
      await expect(sideFileTab(page, 'alpha.txt')).toHaveAttribute('data-preview', 'true');
      await expect(titleOf('alpha.txt'), 'the preview’s title in italics').toHaveCSS('font-style', 'italic');

      // Review's Open: the same tab, now its file; Review's tab stays in its strip
      await openSurface(page, 'Review');
      const review = surface(page, 'review').locator('[data-review]');
      const uncommitted = review.locator('[data-chip="uncommitted"]');
      await expect(uncommitted).toBeVisible({ timeout: 20_000 });
      if ((await uncommitted.getAttribute('aria-pressed')) !== 'true') await uncommitted.click();
      await selectReviewFile(review, 'README.md');
      await review.locator('[data-open-file]').click();
      await besideTheChat('README.md', 'Review’s Open');
      await expect(preview, 'the preview tab reused').toHaveAttribute('data-tab-id', previewId!);
      await expect(sideFileTab(page, 'alpha.txt'), 'the file it showed is no longer beside the chat').toHaveCount(0);
      await expect(sideTab(sideColumn(page), /^Review/), 'Review’s tab still in its strip').toHaveCount(1);

      // a row of Files' tree: the same tab again
      await treeRowOf('beta.txt').click();
      await besideTheChat('beta.txt', 'a row of the tree');
      await expect(preview, 'the preview tab reused').toHaveAttribute('data-tab-id', previewId!);
      await expect(treeRowOf('beta.txt'), 'its row marked').toHaveAttribute('aria-selected', 'true');

      // a double-click on the tab keeps it: its title no longer italic, and the next single click opens a second tab
      await sideFileTab(page, 'beta.txt').getByRole('tab').dblclick();
      await expect(preview, 'no preview tab once kept').toHaveCount(0);
      await expect(titleOf('beta.txt')).toHaveCSS('font-style', 'normal');
      await treeRowOf('gamma.txt').click();
      await besideTheChat('gamma.txt', 'a row of the tree, after the keep');
      await expect(sideFileTab(page, 'beta.txt'), 'the kept tab stays').toHaveCount(1);
      await expect(sideFileTab(page, 'gamma.txt')).toHaveAttribute('data-preview', 'true');
      expect(await preview.getAttribute('data-tab-id'), 'a second tab, not the kept one').not.toBe(previewId);

      // ⌘-click on a path link: a main tab, in front, and nothing of it beside the chat
      const mainFile = (name: string) => mainTabById(page, `file:${machine}:${repo.path(name)}`);
      await link('delta.txt').click({ modifiers: ['Meta'] });
      await expect(mainFile('delta.txt'), 'a main tab of the file, in front').toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
      await expect(main.locator(`[data-file-viewer][data-path="${repo.path('delta.txt')}"]`)).toBeVisible();
      await expect(sideFileTab(page, 'delta.txt')).toHaveCount(0);

      // ⌘-click on a row of the tree, whose file is beside the chat: a main tab, and its side tab gone (one view of a file)
      await treeRowOf('gamma.txt').click({ modifiers: ['Meta'] });
      await expect(mainFile('gamma.txt'), 'a main tab of the file, in front').toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
      await expect(sideFileTab(page, 'gamma.txt'), 'no side tab of it is left').toHaveCount(0);
      await expect(sideFileTab(page, 'beta.txt')).toHaveCount(1);
      expect((await stripIds(page)).sort(), 'the main strip gained the two files, and only them').toEqual([...strip, `file:${machine}:${repo.path('delta.txt')}`, `file:${machine}:${repo.path('gamma.txt')}`].sort());
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    } finally {
      await maws?.cleanup();
      repo.dispose();
      await store.dispose();
    }
  });
});
