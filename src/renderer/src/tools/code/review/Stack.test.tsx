// The mounted stack with stubbed measures (UX wave U5b, M4; the execution document's §F and M4's proof): only the bodies
// near the scroll position are drawn, a folded section weighs its header alone, the place the person reads is kept
// through a resize, a zoom and late drawing and is returned to after Review was hidden, and the hunk counter counts and
// moves across the whole stack. The page is laid out by `fakeStackLayout`: happy-dom lays nothing out.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { record } from '../../../../../../test/support/builders';
import { connectPanelEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { A, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { fakeStackLayout, type FakeStackLayout } from '../../../test-support/review-layout';
import { useTranscriptStore } from '../../../transcript';
import { openComment } from '../../../side/register';
import { closeCard, resetPlaceNotes, useCommentCard } from '../../../side/card/store';
import { registerCommentComposer } from '../anchor/anchor';
import { useViewer } from '../viewer/viewer-store';
import { resetDiffTabs } from './DiffTab';
import { REVIEW_SCOPE_BYTES_CAP } from './review-model';
import { useReview } from './review-store';
import { reviewTool } from './ReviewTool';

// The highlighter would load shiki's grammars; the diff paints plain until it is ready, which here is never.
vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
// What the stack prepares, counted (UX wave U5b-1's branch panel, its ninth finding): each block's data for the diff
// library, and each section's blocks (a section made again).
const prepared = vi.hoisted(() => ({ diffs: 0, sections: 0 }));
vi.mock('./review-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./review-model')>();
  return {
    ...actual,
    diffViewHunks: (...args: Parameters<typeof actual.diffViewHunks>) => {
      prepared.diffs += 1;
      return actual.diffViewHunks(...args);
    },
    blocksOf: (...args: Parameters<typeof actual.blocksOf>) => {
      prepared.sections += 1;
      return actual.blocksOf(...args);
    },
  };
});
// The library measures text on a canvas, which happy-dom does not draw.
HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) })) as never;

const VIEWPORT = 400;
const HEADER = 30;
const ROW = 20;
// The runner's time-out for this suite: happy-dom draws a diff slowly, a stack that draws every body (no band) takes
// seconds, and the suite runs beside the others. A bound on the run, not an assertion.
const SUITE_TIMEOUT = 60_000;

// A file of the stack: `hunks` hunks, each `lines` context lines around one added line, 40 lines apart.
interface Made {
  path: string;
  patch: string;
  added: number[]; // each hunk's added line, in the new file
  starts: number[]; // each hunk's first row, in the new file: where a jump to it opens (`hunkAnchor`)
}
function made(index: number, hunks: number, lines: number): Made {
  const path = `src/part-${String(index).padStart(3, '0')}.ts`;
  const out = [`diff --git a/${path} b/${path}`, 'index 1..2 100644', `--- a/${path}`, `+++ b/${path}`];
  const added: number[] = [];
  const starts: number[] = [];
  for (let h = 0; h < hunks; h++) {
    const start = 1 + h * 40;
    const half = Math.floor(lines / 2);
    starts.push(start + h);
    out.push(`@@ -${start},${lines} +${start + h},${lines + 1} @@`);
    for (let i = 0; i < lines; i++) {
      if (i === half) {
        out.push(`+export const added${h} = ${index};`);
        added.push(start + h + half);
      }
      out.push(` const line${h}x${i} = ${i};`);
    }
  }
  return { path, patch: `${out.join('\n')}\n`, added, starts };
}

// `staged`: the first file has a change in the index too, so Staged is listed; `untracked`: files listed untracked.
function statusOf(files: readonly Made[], options: { staged?: boolean; untracked?: readonly Made[] } = {}): GitStatus {
  return {
    repoRoot: '/repo',
    gitDir: '/repo/.git',
    commonDir: '/repo/.git',
    isWorktree: false,
    branch: 'main',
    head: '0123456789abcdef',
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: true,
    files: [
      ...files.map((file, i) => ({ path: file.path, oldPath: null, index: options.staged && i === 0 ? 'M' : '.', worktree: 'M', untracked: false })),
      ...(options.untracked ?? []).map((file) => ({ path: file.path, oldPath: null, index: '?', worktree: '?', untracked: true })),
    ],
    stashCount: 0,
    checkedAt: '2026-09-29T10:00:00.000Z',
  };
}

const numstat = (file: Made): GitDiffFile => ({ path: file.path, oldPath: null, insertions: file.added.length, deletions: 0, binary: false });

// Main over a scope of `files`, the whole patch in one answer, or past the scope's cap with each file read alone; `hold`
// keeps a file's own read open until the test releases it (its patch) or refuses it (a failed read). An untracked file
// is read alone. `files` is read at each call, so a test that changes it and tells of the change has the scope re-read.
interface StackMainOptions {
  pastCap?: boolean;
  staged?: boolean;
  untracked?: readonly Made[];
}
function stackMain(files: readonly Made[], options: StackMainOptions = {}) {
  const held = new Map<string, ReturnType<typeof deferred<ReturnType<typeof ok> | null>>>();
  const state = { hold: null as string | null };
  const main = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return ok(statusOf(files, options));
      case 'git.diff': {
        if (typeof input.path === 'string') {
          const file = [...files, ...(options.untracked ?? [])].find((f) => f.path === input.path);
          const answer = ok(file ? { patch: file.patch, files: [numstat(file)] } : { patch: '', files: [] });
          if (state.hold === input.path) {
            const late = deferred<ReturnType<typeof ok> | null>();
            held.set(input.path, late);
            return late.promise.then((given) => given ?? answer);
          }
          return answer;
        }
        const patch = files.map((file) => file.patch).join('');
        return ok({ patch: options.pastCap ? patch + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP) : patch, files: files.map(numstat) });
      }
      case 'layout.get':
        return ok({ value: null });
      case 'fs.workflows':
        return ok({ runs: [] });
      case 'git.worktree.branch':
        return ok({ repoRoot: input.repoRoot, branch: input.branch, head: '0123456789abcdef', checkedOutAt: '/repo', base: 'main', ahead: 0, merged: true });
      default:
        return ok();
    }
  });
  return { ...main, state, release: (path: string) => held.get(path)?.resolve(null), refuse: (path: string, message: string) => held.get(path)?.resolve(fail(message)) };
}

const scroller = () => document.querySelector<HTMLElement>('[data-review-stack]')!;
const sections = () => [...document.querySelectorAll<HTMLElement>('[data-review-file]')];
const sectionOf = (path: string) => sections().find((section) => section.dataset.reviewFile === path)!;
const drawnBodies = () => sections().filter((section) => section.querySelector(':scope > [data-review-body]'));
const spacers = () => [...document.querySelectorAll<HTMLElement>('[data-review-spacer]')];
const hunkLabel = () => document.querySelector('[data-review-hunk]')?.textContent ?? null;
const ownReads = (main: ReturnType<typeof stackMain>) => main.callsOf('git.diff').filter((input) => typeof input.path === 'string');
const hide = () => act(() => panelHost.showSummary());
const show = () => act(() => panelHost.selectTab(panelOf(A)!.tabs[0].id));
const request = (path: string) => act(() => void panelHost.addTool('review', { appSessionId: A, params: { path } }));
const next = () => fireEvent.click(screen.getByLabelText('Next hunk'));
const chipOf = (id: string) => document.querySelector<HTMLButtonElement>(`[data-chip="${id}"]`)!;
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
// The add button on a line of the new side, pressed as a pointer does (the library opens the card on the mouse press).
function addOn(path: string, line: number): void {
  const add = sectionOf(path).querySelector(`[data-line-new-num="${line}"]`)!.closest('tr')!.querySelector<HTMLButtonElement>('[data-add-widget="new"] button')!;
  fireEvent.pointerDown(add);
  fireEvent.mouseDown(add);
  fireEvent.pointerUp(window);
}
// A line's row on the new side, and the first row of the hunk it opens (the hunk's header row where one is drawn).
const lineRow = (path: string, line: number) => sectionOf(path).querySelector(`[data-line-new-num="${line}"]`)!.closest('tr')!;
function hunkTop(path: string, line: number): HTMLElement {
  const row = lineRow(path, line);
  const above = row.previousElementSibling as HTMLElement | null;
  return above?.dataset.state === 'hunk' ? above : row;
}

describe('the stack laid out', { timeout: SUITE_TIMEOUT }, () => {
  const offs: (() => void)[] = [];
  let page: FakeStackLayout;
  beforeAll(async () => {
    await import('./FileBody');
  });
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    useViewer.getState().reset();
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents(), registerPanelTool(reviewTool));
    page = fakeStackLayout({ viewport: VIEWPORT, header: HEADER, row: ROW });
  });
  afterEach(() => {
    cleanup();
    act(() => {
      useCommentCard.setState({ open: null, passes: new Map() });
      resetPlaceNotes();
    });
    page.restore();
    offs.splice(0).forEach((off) => off());
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(files: readonly Made[], options: StackMainOptions = {}) {
    const main = stackMain(files, options);
    act(() => void panelHost.addTool('review', { appSessionId: A }));
    render(<TestHost />);
    await page.settle();
    expect(sections()).toHaveLength(files.length + (options.untracked?.length ?? 0));
    return main;
  }

  // Each drawn body lies within two viewports of the scroll position.
  function expectBand() {
    const top = scroller().scrollTop;
    for (const section of drawnBodies()) {
      const from = page.topOf(section);
      const to = from + page.height(section);
      expect(to).toBeGreaterThanOrEqual(top - 2 * VIEWPORT);
      expect(from).toBeLessThanOrEqual(top + 3 * VIEWPORT);
    }
  }

  it('draws only the bodies within two viewports of the scroll position, at the top, in the middle and at the last file', async () => {
    const files = Array.from({ length: 200 }, (_, i) => made(i, 1, 6));
    await mount(files);
    const atTop = drawnBodies().length;
    expect(atTop).toBeGreaterThan(0);
    expect(atTop).toBeLessThan(20);
    expectBand();
    const first = sectionOf(files[0].path);
    const measured = page.height(first.querySelector('[data-review-body]')!);

    page.scrollTo(1400); // by hand: the first body leaves the band
    await page.settle();
    expect(first.querySelector('[data-review-body]')).toBeNull();
    expect(first.querySelector<HTMLElement>('[data-review-spacer]')?.style.height).toBe(`${measured}px`);
    // One viewport further, bodies leave the band above and enter it below: the scroll position does not jump.
    const step = scroller().scrollTop + VIEWPORT;
    page.scrollTo(step);
    const reading = page.rowAtTop();
    await page.settle();
    expect(scroller().scrollTop).toBe(step);
    expect(page.rowAtTop()).toEqual(reading);

    page.scrollTo(Math.round(scroller().scrollHeight / 2));
    await page.settle();
    expect(drawnBodies().length).toBeGreaterThan(0);
    expect(drawnBodies().length).toBeLessThan(20);
    expectBand();

    page.scrollTo(scroller().scrollHeight);
    await page.settle();
    expect(drawnBodies().length).toBeLessThan(20);
    expectBand();
    expect(sectionOf(files[199].path).querySelector('[data-review-body]')).not.toBeNull();
  });

  it('after Collapse all, the stack is as tall as its headers: no body and no spacer is left', async () => {
    const files = Array.from({ length: 200 }, (_, i) => made(i, 1, 6));
    await mount(files);
    page.scrollTo(Math.round(scroller().scrollHeight / 2));
    await page.settle();
    expect(spacers().length).toBeGreaterThan(0); // bodies above and below the band stand as spacers
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    await page.settle();
    expect(spacers()).toEqual([]);
    expect(drawnBodies()).toEqual([]);
    expect(scroller().scrollHeight).toBe(200 * HEADER);
  });

  it('past the scope cap, first paints its headers alone, and Expand all reads the files near the scroll position and no more', async () => {
    const files = Array.from({ length: 200 }, (_, i) => made(i, 1, 6));
    const main = await mount(files, { pastCap: true });
    expect(scroller().scrollHeight).toBe(200 * HEADER);
    expect(spacers()).toEqual([]);
    expect(ownReads(main)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    await page.settle();
    const read = ownReads(main).map((input) => input.path);
    expect(read.length).toBeGreaterThan(0);
    // A section unread is estimated by its counts (one line here): about 45 fit in the band's five viewports.
    expect(read.length).toBeLessThan(50);
    expect(read).toContain(files[0].path);
    expect(read).not.toContain(files[100].path);
  });

  // The branch panel's ninth finding: a section that draws no diff prepares none, and a file's own read makes that file's
  // section again and no other. Counts of preparations, over two hundred files.
  it('prepares the diff data of the bodies it draws and of no other file: of two hundred, those near the scroll position', async () => {
    const files = Array.from({ length: 200 }, (_, i) => made(i, 1, 6));
    prepared.diffs = 0;
    await mount(files);
    const drawn = drawnBodies().length;
    expect(drawn).toBeGreaterThan(0);
    expect(prepared.diffs).toBeGreaterThanOrEqual(drawn);
    expect(prepared.diffs).toBeLessThan(20); // the band's bodies (the bound the band's own case gives them), not 200
    prepared.diffs = 0;
    page.scrollTo(Math.round(scroller().scrollHeight / 2));
    await page.settle();
    expect(prepared.diffs).toBeGreaterThan(0); // the bodies that came into the band
    expect(prepared.diffs).toBeLessThan(20);
  });

  it('makes again the section of the file whose own read answered and no other: one of two hundred and one', async () => {
    const files = Array.from({ length: 200 }, (_, i) => made(i, 1, 6));
    const untracked = made(200, 1, 6);
    const main = await mount(files, { untracked: [untracked] });
    main.state.hold = untracked.path; // its own read, asked once it is near the scroll position, stays out
    page.scrollTo(scroller().scrollHeight);
    await page.settle();
    expect(ownReads(main).map((input) => input.path)).toContain(untracked.path);
    prepared.sections = 0;
    prepared.diffs = 0;
    main.release(untracked.path);
    await page.settle();
    expect(sectionOf(untracked.path).querySelector('[data-review-body] table')).not.toBeNull();
    expect(prepared.sections).toBeLessThanOrEqual(2); // its section (not 201)
    expect(prepared.diffs).toBeLessThanOrEqual(2); // its body's data
  });

  it('keeps the file and row the person reads at the top through a change of width and a zoom', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    await mount(files);
    const third = sectionOf(files[2].path);
    page.scrollTo(page.topOf(third) + HEADER + 15 * ROW + 5); // by hand, into the middle of the third file
    await page.settle();
    const reading = page.rowAtTop();
    expect(reading).toEqual(expect.objectContaining({ path: files[2].path }));

    // Narrower: the rows of the files above wrap onto two lines.
    page.setRows((path, width) => (width < 600 && path < files[2].path ? 2 * ROW : ROW));
    page.setWidth(480);
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);

    page.setZoom(1.25); // every height scales
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
  });

  it('returns to the hunk it jumped to after Review was hidden and shown again, not to where it was before', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 2, 30));
    await mount(files);
    page.scrollTo(page.topOf(sectionOf(files[0].path)) + HEADER + 3 * ROW); // reading the first file
    await page.settle();
    for (let n = 0; n < 5; n++) fireEvent.click(screen.getByLabelText('Next hunk')); // to the third file's second hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 6 of 10');
    const jumped = { path: files[2].path, side: 'new', line: files[2].starts[1] };
    expect(page.rowAtTop()).toEqual(jumped);
    hide();
    show();
    await page.settle();
    expect(page.rowAtTop()).toEqual(jumped);
  });

  it('restores the place saved in the middle of the third file after a remount, and again when a body above it grows', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    await mount(files);
    page.scrollTo(page.topOf(sectionOf(files[2].path)) + HEADER + 20 * ROW + 3);
    await page.settle();
    const reading = page.rowAtTop();
    expect(reading).toEqual(expect.objectContaining({ path: files[2].path }));
    hide();
    show();
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
    page.setRows((path) => (path === files[0].path ? 1.5 * ROW : ROW)); // late highlighting: the first file's rows grow
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
  });

  // §F, the late answer: a reveal into a file whose read is still out stands at the section by its estimate; the
  // person's input first cancels it, and the answer then moves nothing; with no input it lands on its row once.
  async function revealIntoUnread(files: readonly Made[]) {
    const main = await mount(files, { pastCap: true });
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    await page.settle();
    page.scrollTo(page.topOf(sectionOf(files[2].path)) + HEADER + 20 * ROW + 3);
    await page.settle();
    const reading = page.rowAtTop();
    expect(reading).toEqual(expect.objectContaining({ path: files[2].path }));
    hide();
    main.state.hold = files[2].path; // shown again, the scope reads afresh and the third file's own read stays out
    show();
    await page.settle();
    const third = sectionOf(files[2].path);
    expect(third.querySelector('[data-review-body]')?.textContent).toBe('Loading');
    expect(scroller().scrollTop).toBe(page.topOf(third)); // the section, by its estimate
    return { main, reading, third };
  }

  it('cancels a reveal into a file still being read at the person’s input; the answer then moves nothing', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    const { main, third } = await revealIntoUnread(files);
    const at = scroller().scrollTop;
    fireEvent.wheel(scroller());
    main.release(files[2].path);
    await page.settle();
    expect(third.querySelector('[data-review-body] table')).not.toBeNull();
    expect(scroller().scrollTop).toBe(at);
  });

  it('saves the place it was restoring when Review is hidden before the read answers, and restores it when shown', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    const { main, reading } = await revealIntoUnread(files);
    hide(); // the reveal is not reached: the place saved is the one it was restoring, not where it stood meanwhile
    main.release(files[2].path);
    main.state.hold = null;
    show();
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
  });

  it('takes a scroll the browser makes when the page shrinks under the scroller for a layout change, not the person’s: the reveal stands and lands', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    const { main, reading, third } = await revealIntoUnread(files);
    page.setZoom(0.25); // the drawn heights shrink: the browser clamps the scroller, with a scroll event and no input
    await page.settle();
    expect(page.clamped()).toBeGreaterThan(0);
    expect(scroller().scrollTop).toBe(page.topOf(third)); // the section, by its estimate, under the new heights
    main.release(files[2].path);
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
  });

  it('leaves the scroller where it stands when a reveal’s read fails: the section reads Diff unavailable with Retry', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    const { main, third } = await revealIntoUnread(files);
    const at = scroller().scrollTop;
    main.refuse(files[2].path, 'git failed');
    await page.settle();
    expect(third.querySelector('[data-review-body]')?.textContent).toContain('Diff unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(scroller().scrollTop).toBe(at);
  });

  it('brings the same file to the top again on a second request after the person scrolled away', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    await mount(files);
    request(files[3].path);
    await page.settle();
    expect(scroller().scrollTop).toBe(page.topOf(sectionOf(files[3].path)));
    page.scrollTo(0);
    await page.settle();
    expect(scroller().scrollTop).toBe(0);
    request(files[3].path);
    await page.settle();
    expect(scroller().scrollTop).toBe(page.topOf(sectionOf(files[3].path)));
  });

  it('counts the hunk at the reading edge after a long scroll into a file that was not drawn, once its rows draw', async () => {
    const files = Array.from({ length: 20 }, (_, i) => made(i, 2, 10));
    await mount(files);
    const sixth = sectionOf(files[5].path);
    expect(sixth.querySelector('[data-review-body]')).toBeNull(); // outside the band: a spacer
    page.scrollTo(page.topOf(sixth) + HEADER + 2 * ROW); // by hand, into the sixth file's first hunk
    await page.settle();
    expect(sixth.querySelector('[data-review-body] table')).not.toBeNull();
    expect(page.rowAtTop()).toEqual({ path: files[5].path, side: 'new', line: files[5].starts[0] + 2 }); // the place kept
    expect(hunkLabel()).toBe('Showing hunk 11 of 40');
  });

  it('lands a reveal into a file still being read on its row once the read answers, and keeps that place', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    const { main, reading } = await revealIntoUnread(files);
    main.release(files[2].path);
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading);
    main.state.hold = null;
    hide();
    show();
    await page.settle();
    expect(page.rowAtTop()).toEqual(reading); // the saved place
  });

  it('counts every hunk of the stack; ↑ and ↓ cross files and unfold a folded file they land in; a hand scroll moves the count; a hunk in the last screenful stands', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 2, 10));
    await mount(files);
    fireEvent.click(sectionOf(files[1].path).querySelector('[data-review-fold]')!);
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 1 of 10'); // the folded file's hunks are counted
    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByLabelText('Next hunk')); // into the folded file's second hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 4 of 10');
    expect(sectionOf(files[1].path).hasAttribute('data-folded')).toBe(false); // unfolded where it landed
    expect(page.rowAtTop()).toEqual({ path: files[1].path, side: 'new', line: files[1].starts[1] });

    page.scrollTo(page.topOf(sectionOf(files[3].path)) + HEADER + 8 * ROW); // by hand, past the fourth file's first hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 7 of 10');

    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByLabelText('Next hunk'));
    await page.settle();
    expect(scroller().scrollTop).toBe(scroller().scrollHeight - VIEWPORT); // the last hunk cannot reach the top
    expect(hunkLabel()).toBe('Showing hunk 10 of 10');
    expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
  });
  // The branch panel's first finding: the counter is read again whenever the live place is set, a reveal reached included.
  it('counts the hunk at the reading edge once a requested file is reached, and moves on from it', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 2, 10));
    await mount(files);
    expect(hunkLabel()).toBe('Showing hunk 1 of 10');
    request(files[3].path);
    await page.settle();
    expect(scroller().scrollTop).toBe(page.topOf(sectionOf(files[3].path)));
    expect(hunkLabel()).toBe('Showing hunk 7 of 10');
    next();
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 8 of 10');
    expect(page.rowAtTop()).toEqual({ path: files[3].path, side: 'new', line: files[3].starts[1] });
  });

  it('counts the hunk at the saved place when a scope is chosen again, and moves on from it', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 2, 10));
    await mount(files, { staged: true });
    for (let n = 0; n < 5; n++) next(); // to the third file's second hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 6 of 10');
    const jumped = { path: files[2].path, side: 'new', line: files[2].starts[1] };
    expect(page.rowAtTop()).toEqual(jumped);
    fireEvent.click(chipOf('staged')); // another scope: its counter starts at its first hunk; this scope's place is kept
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 1 of 10');
    fireEvent.click(chipOf('uncommitted'));
    await page.settle();
    expect(page.rowAtTop()).toEqual(jumped); // the saved place
    expect(hunkLabel()).toBe('Showing hunk 6 of 10'); // and the counter read there
    next();
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 7 of 10');
    expect(page.rowAtTop()).toEqual({ path: files[3].path, side: 'new', line: files[3].starts[0] });
  });

  // The branch panel's second finding: the reading edge is under the header of the section the place is in.
  it('stands a hunk jumped to under its own section’s header, which the held file’s “This file changed” line makes taller', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 2, 10));
    offs.push(registerCommentComposer(openComment));
    const main = await mount(files);
    offs.push(connectPanelEvents()); // on this main's bridge, which the suite's own connection predates
    const held = files[1];
    page.scrollTo(page.topOf(sectionOf(held.path)) + HEADER); // by hand, to the second file, its first added line in view
    await page.settle();
    addOn(held.path, held.added[0]); // a card under it: the file holds still
    await page.settle();
    expect(card()).not.toBeNull();
    files[1] = made(1, 2, 11); // the agent changes the file under the card
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf(files), reason: 'worktree' }));
    await waitFor(() => expect(sectionOf(held.path).querySelector('[data-review-file-changed]')).not.toBeNull());
    await page.settle();
    expect(page.headerOf(held.path)).toBe(HEADER + 28);
    const at = Number(/hunk (\d+) of/.exec(hunkLabel()!)![1]) - 1;
    for (let n = at; n < 3; n++) next(); // to the held file's second hunk
    for (let n = at; n > 3; n--) fireEvent.click(screen.getByLabelText('Previous hunk'));
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 4 of 10');
    expect(page.topOf(hunkTop(held.path, held.starts[1])) - scroller().scrollTop).toBe(page.headerOf(held.path));
    expect(page.rowAtTop()).toEqual({ path: held.path, side: 'new', line: held.starts[1] });
  });

  // The branch panel's fifth finding: whether a card's line is revealed is decided by whether its row is in view.
  it('brings into view the line of a card opened from the chip while that line is drawn above the viewport', async () => {
    const files = [made(0, 1, 10), ...Array.from({ length: 4 }, (_, i) => made(i + 1, 1, 40))];
    offs.push(registerCommentComposer(openComment));
    await mount(files);
    addOn(files[0].path, files[0].added[0]); // in view at the top
    await page.settle();
    const field = within(card()!).getByRole('textbox', { name: 'Comment' });
    fireEvent.change(field, { target: { value: 'Say what this counts.' } });
    fireEvent.keyDown(field, { key: 'Escape' }); // a draft: the card goes, the chip stands for it
    await page.settle();
    expect(card()).toBeNull();
    page.scrollTo(page.topOf(sectionOf(files[1].path)) + HEADER + 10 * ROW); // by hand, into the second file
    await page.settle();
    expect(sectionOf(files[0].path).querySelector('[data-review-body] table')).not.toBeNull(); // drawn, in the band
    expect(page.topOf(lineRow(files[0].path, files[0].added[0]))).toBeLessThan(scroller().scrollTop); // and out of view
    fireEvent.click(document.querySelector<HTMLElement>('[data-review-toolbar] [data-unsent-chip]')!);
    await page.settle();
    expect(card()).not.toBeNull();
    expect(page.rowAtTop()).toEqual({ path: files[0].path, side: 'new', line: files[0].added[0] });
  });

  // UX wave U5b, M5: a comment's card opening under a line, and closing, is a layout change; the place holds through both.
  it('keeps the row the person reads at the top when a comment’s card opens under a line above it, and when it closes', async () => {
    const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
    offs.push(registerCommentComposer(openComment));
    await mount(files);
    page.scrollTo(page.topOf(sectionOf(files[2].path)) + HEADER + 15 * ROW + 5); // by hand, into the third file
    await page.settle();
    const reading = page.rowAtTop();
    expect(reading).toEqual(expect.objectContaining({ path: files[2].path }));
    // the second file's added line, drawn above the reading edge: its add button, pressed as a pointer does
    const line = sectionOf(files[1].path).querySelector(`[data-line-new-num="${files[1].added[0]}"]`)!.closest('tr')!;
    const add = line.querySelector<HTMLButtonElement>('[data-add-widget="new"] button')!;
    fireEvent.pointerDown(add);
    fireEvent.mouseDown(add);
    fireEvent.pointerUp(window);
    await page.settle();
    expect(document.querySelector('[data-comment-card]')).not.toBeNull();
    expect(sectionOf(files[1].path).querySelector('tr[data-state="widget"]')).not.toBeNull();
    expect(page.rowAtTop()).toEqual(reading);
    act(() => closeCard());
    await page.settle();
    expect(sectionOf(files[1].path).querySelector('tr[data-state="widget"]')).toBeNull();
    expect(page.rowAtTop()).toEqual(reading);
    act(() => {
      useCommentCard.setState({ open: null });
      resetPlaceNotes();
    });
  });

  // §F's gesture (Decision Log 17 b): a scroll event the stack did not make is the person's while a pointer is held in the
  // scroller or within GESTURE_MS (500) of their last wheel, touch, key or pointer release there, and a layout change
  // otherwise; a reveal starting ends the window. The clock is the test's: `performance.now` answers `clock`, so each
  // boundary is exact and nothing waits.
  describe('the person’s gesture', () => {
    let clock = 0;
    beforeEach(() => {
      clock = 1_000;
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
    });
    // A scroll event with no input before it, as the browser sends for a scroll it makes itself.
    const scrollWithoutInput = (top: number) => act(() => void (scroller().scrollTop = top));

    // Five files of 40 lines; the person reads the third by hand at `clock`, and the offset one step further on.
    async function reading() {
      const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
      await mount(files);
      const at = page.topOf(sectionOf(files[2].path)) + HEADER + 10 * ROW;
      page.scrollTo(at);
      await page.settle();
      const row = page.rowAtTop();
      expect(row).toEqual(expect.objectContaining({ path: files[2].path }));
      return { files, at, row, further: at + 5 * ROW };
    }

    it('takes a scroll 500 ms after the person’s last wheel for theirs: the scroller stays where it went', async () => {
      const { row, further } = await reading();
      clock += 500;
      scrollWithoutInput(further);
      await page.settle();
      expect(scroller().scrollTop).toBe(further);
      expect(page.rowAtTop()).not.toEqual(row);
    });

    it('takes a scroll 501 ms after the person’s last wheel for a layout change: the place read before stands', async () => {
      const { at, row, further } = await reading();
      clock += 501;
      scrollWithoutInput(further);
      await page.settle();
      expect(scroller().scrollTop).toBe(at);
      expect(page.rowAtTop()).toEqual(row);
    });

    it('takes every scroll while a pointer is held in the scroller for the person’s, however long the hold', async () => {
      const { further } = await reading();
      fireEvent.pointerDown(scroller());
      clock += 60_000;
      scrollWithoutInput(further);
      await page.settle();
      expect(scroller().scrollTop).toBe(further);
    });

    it('ends the held pointer’s gesture 500 ms after its release: a scroll then is the person’s, a scroll one millisecond later is a layout change', async () => {
      const { further } = await reading();
      fireEvent.pointerDown(scroller());
      clock += 60_000;
      fireEvent.pointerUp(window); // released over anything, as a drag of the scroll bar may end outside the scroller
      clock += 500;
      scrollWithoutInput(further);
      await page.settle();
      expect(scroller().scrollTop).toBe(further);
      const row = page.rowAtTop();
      clock += 1;
      scrollWithoutInput(further + 5 * ROW);
      await page.settle();
      expect(scroller().scrollTop).toBe(further);
      expect(page.rowAtTop()).toEqual(row);
    });

    // The branch panel's third finding: a scroll under a layout not measured yet is that layout change first.
    it('holds the place the person read when the page shrinks inside their gesture: the browser’s clamp is a layout change', async () => {
      const files = Array.from({ length: 5 }, (_, i) => made(i, 1, 40));
      await mount(files);
      page.scrollTo(page.topOf(sectionOf(files[1].path)) + HEADER + 10 * ROW); // by hand, into the second file
      await page.settle();
      const row = page.rowAtTop();
      expect(row).toEqual(expect.objectContaining({ path: files[1].path }));
      clock += 100; // inside the wheel's window
      page.setZoom(0.125); // the page shrinks under the scroller: the browser clamps it before the observers report
      await page.settle();
      expect(page.clamped()).toBeGreaterThan(0);
      expect(page.rowAtTop()).toEqual(row);
    });

    it('adds the person’s scroll to the place a layout change holds when the scroll comes before the page is measured again', async () => {
      const { files, row } = await reading();
      clock += 100;
      page.setRows((path) => (path === files[1].path ? 1.5 * ROW : ROW)); // the second file's rows grow above the reading edge, unreported
      page.scrollTo(scroller().scrollTop + 5 * ROW); // the person's scroll, five rows on, under the grown page
      await page.settle();
      expect(page.rowAtTop()).toEqual({ ...row!, line: row!.line + 5 });
    });

    it('ends an earlier wheel’s window when a reveal starts: a scroll 100 ms into the reveal is a layout change, and the requested file stays at the top', async () => {
      const { files, further } = await reading();
      clock += 100;
      request(files[3].path);
      await page.settle();
      const top = page.topOf(sectionOf(files[3].path));
      expect(scroller().scrollTop).toBe(top);
      clock += 100; // 200 ms after the wheel: inside its window, had the reveal not ended it
      scrollWithoutInput(further);
      await page.settle();
      expect(scroller().scrollTop).toBe(top);
    });
  });
});
