// The mounted stack with stubbed measures (UX wave U5b, M4; the execution document's §F and M4's proof): only the bodies
// near the scroll position are drawn, a folded section weighs its header alone, the place the person reads is kept
// through a resize, a zoom and late drawing and is returned to after Review was hidden, and the hunk counter counts and
// moves across the whole stack. The page is laid out by `fakeStackLayout`: happy-dom lays nothing out.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { record } from '../../../../../../test/support/builders';
import { connectPanelEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useSessions } from '../../../stores/sessions';
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { A, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { fakeStackLayout, type FakeStackLayout } from '../../../test-support/review-layout';
import { useTranscriptStore } from '../../../transcript';
import { useViewer } from '../viewer/viewer-store';
import { resetDiffTabs } from './DiffTab';
import { REVIEW_SCOPE_BYTES_CAP } from './review-model';
import { useReview } from './review-store';
import { reviewTool } from './ReviewTool';

// The highlighter would load shiki's grammars; the diff paints plain until it is ready, which here is never.
vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
// The library measures text on a canvas, which happy-dom does not draw.
HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) })) as never;

const VIEWPORT = 400;
const HEADER = 30;
const ROW = 20;
// The runner's time-out for the cases over 200 files: happy-dom draws a diff slowly, and a stack that draws every body
// (no band) takes seconds. A bound on the run, not an assertion.
const LARGE = 60_000;

// A file of the stack: `hunks` hunks, each `lines` context lines around one added line, 40 lines apart.
interface Made {
  path: string;
  patch: string;
  added: number[]; // each hunk's added line, in the new file
}
function made(index: number, hunks: number, lines: number): Made {
  const path = `src/part-${String(index).padStart(3, '0')}.ts`;
  const out = [`diff --git a/${path} b/${path}`, 'index 1..2 100644', `--- a/${path}`, `+++ b/${path}`];
  const added: number[] = [];
  for (let h = 0; h < hunks; h++) {
    const start = 1 + h * 40;
    const half = Math.floor(lines / 2);
    out.push(`@@ -${start},${lines} +${start + h},${lines + 1} @@`);
    for (let i = 0; i < lines; i++) {
      if (i === half) {
        out.push(`+export const added${h} = ${index};`);
        added.push(start + h + half);
      }
      out.push(` const line${h}x${i} = ${i};`);
    }
  }
  return { path, patch: `${out.join('\n')}\n`, added };
}

function statusOf(files: readonly Made[]): GitStatus {
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
    files: files.map((file) => ({ path: file.path, oldPath: null, index: '.', worktree: 'M', untracked: false })),
    stashCount: 0,
    checkedAt: '2026-09-29T10:00:00.000Z',
  };
}

const numstat = (file: Made): GitDiffFile => ({ path: file.path, oldPath: null, insertions: file.added.length, deletions: 0, binary: false });

// Main over a scope of `files`, the whole patch in one answer, or past the scope's cap with each file read alone; `hold`
// keeps a file's own read open until the test releases it.
function stackMain(files: readonly Made[], options: { pastCap?: boolean } = {}) {
  const held = new Map<string, ReturnType<typeof deferred<ReturnType<typeof ok>>>>();
  const state = { hold: null as string | null };
  const main = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return ok(statusOf(files));
      case 'git.diff': {
        if (typeof input.path === 'string') {
          const file = files.find((f) => f.path === input.path);
          const answer = ok(file ? { patch: file.patch, files: [numstat(file)] } : { patch: '', files: [] });
          if (state.hold === input.path) {
            const late = deferred<ReturnType<typeof ok>>();
            held.set(input.path, late);
            return late.promise.then(() => answer);
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
  return { ...main, state, release: (path: string) => held.get(path)?.resolve(ok()) };
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

describe('the stack laid out', () => {
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
    page.restore();
    offs.splice(0).forEach((off) => off());
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(files: readonly Made[], options: { pastCap?: boolean } = {}) {
    const main = stackMain(files, options);
    act(() => void panelHost.addTool('review', { appSessionId: A }));
    render(<TestHost />);
    await page.settle();
    expect(sections()).toHaveLength(files.length);
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
  }, LARGE);

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
  }, LARGE);

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
  }, LARGE);

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
    for (let n = 0; n < 4; n++) fireEvent.click(screen.getByLabelText('Next hunk')); // to the third file's first hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 5 of 10');
    const jumped = { path: files[2].path, side: 'new', line: files[2].added[0] };
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
    fireEvent.click(screen.getByLabelText('Next hunk'));
    fireEvent.click(screen.getByLabelText('Next hunk'));
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 3 of 10');
    expect(sectionOf(files[1].path).hasAttribute('data-folded')).toBe(false); // unfolded where it landed
    expect(page.rowAtTop()).toEqual({ path: files[1].path, side: 'new', line: files[1].added[0] });

    page.scrollTo(page.topOf(sectionOf(files[3].path)) + HEADER + 8 * ROW); // by hand, past the fourth file's first hunk
    await page.settle();
    expect(hunkLabel()).toBe('Showing hunk 7 of 10');

    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByLabelText('Next hunk'));
    await page.settle();
    expect(scroller().scrollTop).toBe(scroller().scrollHeight - VIEWPORT); // the last hunk cannot reach the top
    expect(hunkLabel()).toBe('Showing hunk 10 of 10');
    expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
  });
});
