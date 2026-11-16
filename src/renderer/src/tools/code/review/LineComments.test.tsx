// Comments on lines in Review (UX wave U5b, M5; the execution document's §B and §G, and M5's proof): the library's add
// button on a line of either side opens the card under that line with "Send to main" ticked; several comments go as one
// message whose comments quote their lines; every other unsent comment is a row under its line; a file under an open card
// holds still and says so; a refused send that answers after the file changed opens the card again under the line whose
// text is the quote. The tool runs over C8a's host with a fake main; happy-dom lays nothing out, so the library's table
// wrappers are given a width (it draws a widget or an extend row only then) and the stack's measures are stubbed where a
// case reads them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commentsMessage, MESSAGE_COMMENTS_MAX, type MessageComment } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { addressOf } from '@shared/machine/address';
import { record, remoteRow, status, T0 } from '../../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectPanelEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { openComment } from '../../../side/register';
import { passKey, resetPlaceNotes, useCommentCard, type PassComment } from '../../../side/card/store';
import { useMachines } from '../../../stores/machines';
import { useTranscriptStore, type TurnId } from '../../../transcript';
import { builder, uuid } from '../../../transcript/model/test-events';
import { rowsOf } from '../../../transcript/model/derive';
import { applyEvents, createState } from '../../../transcript/model/reduce';
import { renderRow, rowOf, spyActions } from '../../../transcript/view/rows/test-support';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { A, resetPanelStores, TestHost } from '../../../test-support/panel';
import { commitLineAnchor, registerCommentComposer } from '../anchor/anchor';
import { useViewer } from '../viewer/viewer-store';
import { DiffTab, resetDiffTabs } from './DiffTab';
import { UNPLACED_ROWS_SHOWN } from './UnplacedComments';
import { reviewLayout } from './measure';
import { REVIEW_SCOPE_BYTES_CAP } from './review-model';
import { useReview } from './review-store';
import { useBranchReads } from './branch-read';
import { reviewTool } from './ReviewTool';

// The highlighter would load shiki's grammars; the diff paints plain until it is ready, which here is never.
vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
// The library measures text on a canvas, which happy-dom does not draw.
HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) })) as never;

// Two files of an invented change. In `src/report.ts` line 12 was `return value;` (old side) and is
// `return quoted(value);` (new side); `src/other.ts` gains line 2.
const REPORT = (lead: string[] = []) =>
  [
    'diff --git a/src/report.ts b/src/report.ts',
    'index 1..2 100644',
    '--- a/src/report.ts',
    '+++ b/src/report.ts',
    `@@ -10,5 +10,${5 + lead.length} @@`,
    ...lead.map((line) => `+${line}`),
    ' function cell(value) {',
    " if (value === '') return value;",
    '-return value;',
    '+return quoted(value);',
    ' }',
    ' const end = 1;',
    '',
  ].join('\n');
const OTHER = (added = 'export const b = 2;') => ['diff --git a/src/other.ts b/src/other.ts', 'index 3..4 100644', '--- a/src/other.ts', '+++ b/src/other.ts', '@@ -1,2 +1,3 @@', ' export const a = 1;', `+${added}`, ' export const c = 3;', ''].join('\n');
// The agent's next write: two lines above the commented one, which moves its new line from 12 to 14.
const MOVED = REPORT(['// one', '// two']);
const FILES = (lead = 0): GitDiffFile[] => [
  { path: 'src/report.ts', oldPath: null, insertions: 1 + lead, deletions: 1, binary: false },
  { path: 'src/other.ts', oldPath: null, insertions: 1, deletions: 0, binary: false },
];

const STATUS: GitStatus = {
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
    { path: 'src/report.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'src/other.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
  ],
  stashCount: 0,
  checkedAt: '2026-09-29T10:00:00.000Z',
};

const PAST_THE_CAP = ' '.repeat(REVIEW_SCOPE_BYTES_CAP); // what makes a scope's patch too large to keep
const BUILT = [{ type: 'text', text: 'the built message' }];
const SENT = { messageUuid: null, disposition: 'sent', queueId: 'q0' };

function commentsMain() {
  const state = {
    patch: REPORT() + OTHER(),
    pastCap: false, // the scope's patch past REVIEW_SCOPE_BYTES_CAP: its files folded, each read on its own
    perFile: { 'src/report.ts': REPORT(), 'src/other.ts': OTHER() } as Record<string, string>, // a file's own read
    failing: new Set<string>(), // files whose own read fails
    files: FILES(),
    content: null as null | (() => Promise<ReturnType<typeof ok>>), // a test's own answer to the comments' content
    status: STATUS as GitStatus | null, // null: git.watch fails (outside Git, or a failed watch)
    staged: null as null | { patch: string; files: GitDiffFile[] }, // the Staged scope's read; null, Uncommitted's
  };
  const main = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return state.status ? ok(state.status) : fail('fatal: not a git repository');
      case 'git.diff':
        if (typeof input.path === 'string') return state.failing.has(input.path) ? fail('the disk is busy') : ok({ patch: state.perFile[input.path] ?? '', files: state.files.filter((file) => file.path === input.path) });
        if (state.pastCap) return ok({ patch: state.patch + PAST_THE_CAP, files: state.files });
        return ok(input.scope === 'staged' && state.staged ? state.staged : { patch: state.patch, files: state.files });
      case 'git.worktree.branch':
        return ok({ repoRoot: '/repo', branch: 'main', head: STATUS.head, checkedOutAt: '/repo', base: 'main', ahead: 0, merged: true });
      case 'layout.get':
        return ok({ value: null });
      case 'fs.workflows':
        return ok({ runs: [] });
      case 'session.queue.list':
        return ok({ entries: [], paused: false });
      case 'session.intent.get':
        return ok(null);
      case 'git.changesSince': // UX wave U5b-2: the reads, asked only where the machine serves them
        return ok({ patch: state.patch, files: state.files, untracked: [] });
      case 'git.branchCommits':
        return ok({ base: { ref: 'origin/main', mergeBase: STATUS.head.padEnd(40, '0') }, upstream: null, commits: [], counts: { all: 0, notPushed: 0, pushed: 0 }, behind: 0 });
      case 'git.commitDiff':
        return ok({ commit: { sha: input.commit, shortSha: String(input.commit).slice(0, 7), author: 'Ada', authoredAt: '2026-11-14T10:00:00.000Z', subject: 'Quote the cells', parents: ['0000000000000000000000000000000000000001'] }, onHead: true, patch: input.patch === false ? '' : state.patch, files: input.patch === false ? [] : state.files });
      case 'side.comment.content':
        return state.content ? state.content() : ok({ content: BUILT });
      case 'session.send':
        return ok(SENT);
      default:
        return ok();
    }
  });
  return { ...main, state };
}

let main: ReturnType<typeof commentsMain>;
const KEY = passKey('review', A, A);
const pass = () => useCommentCard.getState().passes.get(KEY) ?? null;

const sectionOf = (path: string) => document.querySelector<HTMLElement>(`[data-review-file="${path}"]`);
const bodyOf = (path: string) => sectionOf(path)?.querySelector<HTMLElement>('[data-review-body]') ?? null;
// The line's row, by its number on a side (unified: its gutter's `data-line-<side>-num`; split: its side's table).
function lineRow(path: string, side: 'old' | 'new', line: number): HTMLElement | null {
  const cells = [...(bodyOf(path)?.querySelectorAll<HTMLElement>(`[data-line-${side}-num="${line}"], [data-side="${side}"] [data-line-num="${line}"]`) ?? [])];
  return cells.map((cell) => cell.closest<HTMLElement>('tr')).find((tr) => tr !== null && tr.dataset.state !== 'widget' && tr.dataset.state !== 'extend') ?? null;
}
// The add button the library draws on a line, pressed as the library listens for it (a mouse press).
function addOn(path: string, side: 'old' | 'new', line: number): void {
  const button = lineRow(path, side, line)?.querySelector<HTMLButtonElement>(`[data-add-widget="${side}"] button`);
  expect(button, `the add button on ${path} ${side} ${line}`).toBeTruthy();
  fireEvent.mouseDown(button!);
}
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const cardRow = () => document.querySelector<HTMLElement>('[data-review-card-row]');
const field = () => within(card()!).getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const sendButton = () => within(card()!).getByRole('button', { name: /^(Send|Sending…)/ }) as HTMLButtonElement;
const box = () => within(card()!).getByRole('checkbox', { name: 'Send to main' }) as HTMLInputElement;
const leave = () => fireEvent.keyDown(field(), { key: 'Escape' }); // a draft is kept: the card goes, its comment stays
const chip = () => document.querySelector<HTMLElement>('[data-review-toolbar] [data-unsent-chip]');
const surfaceChip = () => document.querySelector<HTMLElement>('[data-review] [data-unsent-chip]'); // in the toolbar or where it stands
const lineLeft = () => document.querySelector<HTMLElement>('[data-review-unplaced]'); // the row under the toolbar
const unplacedRows = () => [...document.querySelectorAll<HTMLElement>('[data-review-unplaced-comment]')];
const unplacedEdit = (index: number) => unplacedRows()[index].querySelector<HTMLButtonElement>('[data-review-unplaced-edit]')!;
const unplacedWords = () => [...document.querySelectorAll<HTMLElement>('[data-review-unplaced-words]')];
const stackElement = () => document.querySelector<HTMLElement>('[data-review-stack]');
// Other's line 2 rewritten: a comment on it is on a line no longer in the diff.
const OTHER_GONE = () => OTHER('export const total = 2;');
// Report's line 12, on both its sides, and line 11 rewritten.
const REPORT_GONE = () => REPORT().replace('+return quoted(value);', '+return escaped(value);').replace('-return value;', '-return value ;').replace(" if (value === '') return value;", ' if (value === null) return value;');
const scopeChip = (id: string) => document.querySelector<HTMLButtonElement>(`[data-chip="${id}"]`);
const unsentRows = (path?: string) => [...((path ? bodyOf(path) : document)?.querySelectorAll<HTMLElement>('[data-review-unsent-comment]') ?? [])];
const changedLine = (path: string) => sectionOf(path)?.querySelector<HTMLElement>('[data-review-file-changed]') ?? null;
const openReview = () => act(() => void panelHost.addTool('review', { appSessionId: A }));

// Turns of the event loop (the fake main's answers, the lazy chunk, the library's rows), not a time budget.
async function painted(check: () => boolean): Promise<void> {
  for (let turn = 0; turn < 60 && !check(); turn++) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  expect(check()).toBe(true);
}
const drawn = (path: string) => painted(() => (bodyOf(path)?.querySelector('table') ?? null) !== null);
// The scope read again after git.changed (250 ms on).
async function reread(patch: string, files: GitDiffFile[]) {
  const before = main.callsOf('git.diff').length;
  main.state.patch = patch;
  main.state.files = files;
  act(() => main.emit('git.changed', { repoRoot: '/repo', status: STATUS, reason: 'worktree' }));
  await waitFor(() => expect(main.callsOf('git.diff').length).toBeGreaterThan(before));
}

// Two comments, other.ts's line 2 first (the older) and report.ts's line 12, each left as a draft.
async function twoComments() {
  addOn('src/other.ts', 'new', 2);
  await painted(() => card() !== null);
  type('Name it for what it counts.');
  leave();
  await painted(() => card() === null);
  addOn('src/report.ts', 'new', 12);
  await painted(() => card() !== null);
  type('Quote only where a comma is.');
  leave();
  await painted(() => card() === null && chip() !== null);
}

async function mountReview() {
  openReview();
  render(<TestHost />);
  await drawn('src/report.ts');
  await drawn('src/other.ts');
}

// The library draws a widget or an extend row only where its table's wrapper has a width.
const WRAPPERS = '.unified-diff-table-wrapper, .old-diff-table-wrapper, .new-diff-table-wrapper';

describe('comments on lines in Review', () => {
  const offs: (() => void)[] = [];
  beforeAll(async () => {
    await import('./FileBody');
  });
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    useViewer.getState().reset();
    resetPlaceNotes();
    useCommentCard.setState({ open: null });
    main = commentsMain();
    useSessions.setState((s) => ({
      records: new Map(s.records).set(A, record(A, { directory: '/repo', title: { text: 'Berth import', source: 'user' } })),
      engine: new Map(s.engine).set(A, status(A, { process: 'ready' } as never)),
    }));
    offs.push(connectPanelEvents(), registerPanelTool(reviewTool), registerCommentComposer(openComment));
    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.matches(WRAPPERS) ? ({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 400, width: 720, height: 400, toJSON: () => ({}) } as DOMRect) : rect.call(this);
    });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    useCommentCard.setState({ open: null });
    resetPlaceNotes();
    useBranchReads.getState().reset(); // UX wave U5b-2: a case that serves the reads holds the branch read
    vi.restoreAllMocks();
  });

  it('opens the card under a line of either side with “Send to main” ticked; the anchor is the absolute path and the line, with side old for a removed line', async () => {
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    expect(lineRow('src/report.ts', 'new', 12)!.nextElementSibling?.contains(card())).toBe(true); // the row under the line
    expect(box().checked).toBe(true);
    expect(pass()!.comments.map((c) => [c.anchor, c.quote])).toEqual([[{ kind: 'file-line', locator: '/repo/src/report.ts#L12', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12 }, 'return quoted(value);']]);
    type('Quote only where a comma is.');
    addOn('src/report.ts', 'old', 12);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'old:12');
    expect(lineRow('src/report.ts', 'old', 12)!.nextElementSibling?.contains(card())).toBe(true);
    // card 4 at its default: the label is the file and the line, the side is the anchor's, and nothing says "before"
    expect(pass()!.comments[1]).toMatchObject({ anchor: { kind: 'file-line', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12, side: 'old' }, quote: 'return value;' });
  });

  it('sends two comments as one message (“Send 2 comments”), each with its quoted line, the removed one under “Before the change:”', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    addOn('src/report.ts', 'old', 12);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'old:12');
    type('Why was the plain return dropped?');
    expect(sendButton().textContent).toBe('Send 2 comments');
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
    expect(main.callsOf('side.comment.content')).toEqual([
      {
        comments: [
          { anchor: { kind: 'file-line', locator: '/repo/src/other.ts#L2', label: 'other.ts:2', path: '/repo/src/other.ts', line: 2 }, text: '`export const b = 2;`\nName it for what it counts.', screenshot: null },
          { anchor: { kind: 'file-line', locator: '/repo/src/report.ts#L12', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12, side: 'old' }, text: 'Before the change:\n`return value;`\nWhy was the plain return dropped?', screenshot: null },
        ],
      },
    ]);
    await painted(() => pass() === null && card() === null);
    expect(document.querySelector('[data-review-toolbar] [data-sent-note]')?.textContent).toBe('Sent to Berth import');
  });

  it('draws every other unsent comment as a row under its line: its words, a click that edits it, Remove; with the card closed the toolbar’s chip opens the card on the newest', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    addOn('src/report.ts', 'new', 12);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:12');
    type('Quote only where a comma is.');
    await painted(() => unsentRows('src/other.ts').length === 1);
    const [row] = unsentRows('src/other.ts');
    expect(lineRow('src/other.ts', 'new', 2)!.nextElementSibling?.contains(row)).toBe(true);
    expect(row.textContent).toBe('Name it for what it counts.');
    expect(card()!.querySelector('[data-pass-comments]')).toBeNull(); // the rows are the pass's list (D5)

    leave();
    await painted(() => card() === null && unsentRows().length === 2);
    expect(chip()?.textContent).toBe('2 unsent comments');
    fireEvent.click(chip()!);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:12');
    expect(field().value).toBe('Quote only where a comma is.');

    fireEvent.click(within(unsentRows('src/other.ts')[0]).getByText('Name it for what it counts.'));
    await painted(() => bodyOf('src/other.ts')?.contains(card()) ?? false);
    expect(field().value).toBe('Name it for what it counts.');
    expect(unsentRows('src/report.ts').map((each) => each.textContent)).toEqual(['Quote only where a comma is.']);
    fireEvent.click(within(unsentRows('src/report.ts')[0]).getByRole('button', { name: 'Remove comment' }));
    await painted(() => unsentRows().length === 0);
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for what it counts.']);
  });

  it('leaves the card’s node in place when a re-read changes another file (the file’s diff object is the same)', async () => {
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    const node = card();
    const text = field();
    await reread(REPORT() + OTHER('export const b = 20;'), FILES());
    await painted(() => bodyOf('src/other.ts')?.textContent?.includes('b = 20') ?? false);
    expect(card()).toBe(node);
    expect(field()).toBe(text);
    expect(changedLine('src/report.ts')).toBeNull();
  });

  it('holds a file under an open card when the agent changes it, saying “This file changed · Refresh”; Refresh draws the card again at the line’s new number with the store’s draft', async () => {
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    await reread(MOVED + OTHER(), FILES(2));
    await painted(() => changedLine('src/report.ts') !== null);
    expect(changedLine('src/report.ts')!.textContent).toBe('This file changed·Refresh');
    expect(bodyOf('src/report.ts')!.textContent).not.toContain('// one'); // the drawn hunks hold
    expect(cardRow()?.dataset.reviewCardRow).toBe('new:12');

    fireEvent.click(within(changedLine('src/report.ts')!).getByRole('button', { name: 'Refresh' }));
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:14' && card() !== null);
    expect(bodyOf('src/report.ts')!.textContent).toContain('// one');
    expect(lineRow('src/report.ts', 'new', 14)!.nextElementSibling?.contains(card())).toBe(true);
    expect(field().value).toBe('Quote only where a comma is.');
    expect(document.activeElement).toBe(field());
    expect(changedLine('src/report.ts')).toBeNull();
  });

  it('opens the card again under the moved line when a send refused after the file changed: the line whose text is the quote, with its words', async () => {
    await mountReview();
    const held = deferred<ReturnType<typeof ok>>();
    main.state.content = () => held.promise;
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('side.comment.content')).toHaveLength(1));
    leave(); // the person goes on reading: the card closes, and the file it held is let go
    await painted(() => card() === null);
    await reread(MOVED + OTHER(), FILES(2));
    await painted(() => bodyOf('src/report.ts')?.textContent?.includes('// one') ?? false);
    held.resolve(fail('the session is not running'));
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:14' && card() !== null);
    expect(lineRow('src/report.ts', 'new', 14)!.nextElementSibling?.contains(card())).toBe(true);
    expect(field().value).toBe('Quote only where a comma is.');
    expect(card()!.textContent).toContain('the session is not running');
  });

  it('opens from the chip a comment whose line left the diff in a row under the toolbar, below “The line this comment was on is no longer in this diff.”, and keeps it open there, under no line', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/other.ts')?.textContent?.includes('total') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    expect(lineLeft()!.querySelector('[data-review-unplaced-words]')!.textContent).toBe('The line this comment was on is no longer in this diff.');
    const toolbar = document.querySelector('[data-review-toolbar]')!;
    expect(toolbar.compareDocumentPosition(lineLeft()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // under the toolbar
    expect(lineLeft()!.compareDocumentPosition(stackElement()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the stack
    expect(stackElement()!.contains(card())).toBe(false); // attached to no line
    expect(field().value).toBe('Name it for what it counts.');
    for (let turn = 0; turn < 10; turn++) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
    expect(lineLeft()?.contains(card())).toBe(true); // it stays open
    expect(useCommentCard.getState().open?.phase.kind).toBe('composing');
  });

  it('reads, edits, sends and removes there a comment whose line left the diff', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/other.ts')?.textContent?.includes('total') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    type('Name it for what it adds up to.');
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for what it adds up to.']);
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' })); // the card's Close drops the comment
    await painted(() => card() === null && pass() === null);
    expect(lineLeft()).toBeNull();

    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    leave();
    await reread(REPORT().replace('+return quoted(value);', '+return escaped(value);') + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/report.ts')?.textContent?.includes('escaped') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
    expect(main.callsOf('side.comment.content')).toEqual([
      { comments: [{ anchor: { kind: 'file-line', locator: '/repo/src/report.ts#L12', label: 'report.ts:12', path: '/repo/src/report.ts', line: 12 }, text: '`return quoted(value);`\nQuote only where a comma is.', screenshot: null }] },
    ]);
    await painted(() => card() === null && pass() === null && lineLeft() === null);
  });

  it('shows a refused send there, its reason and Retry in the card under the toolbar, and sends it again from there', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/other.ts')?.textContent?.includes('total') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    const held = deferred<ReturnType<typeof ok>>();
    main.state.content = () => held.promise;
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('side.comment.content')).toHaveLength(1));
    held.resolve(fail('the session is not running'));
    await painted(() => lineLeft()?.querySelector('[role="alert"]') != null);
    const refusal = within(lineLeft()!).getByRole('alert');
    expect(refusal.textContent).toContain('the session is not running');
    expect(lineLeft()!.contains(card())).toBe(true);
    main.state.content = null;
    fireEvent.click(within(refusal).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
    await painted(() => card() === null && pass() === null && lineLeft() === null);
  });

  it('places it under its line again when the line returns: Refresh on the file the card holds draws it there, with its words and the keyboard', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/other.ts')?.textContent?.includes('total') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    field().focus();
    await reread(REPORT() + OTHER(), FILES()); // the agent puts the line back
    await painted(() => changedLine('src/other.ts') !== null);
    expect(lineLeft()?.contains(card())).toBe(true); // held, as any file under an open card: never another line
    fireEvent.click(within(changedLine('src/other.ts')!).getByRole('button', { name: 'Refresh' }));
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:2' && card() !== null && lineLeft() === null);
    expect(lineRow('src/other.ts', 'new', 2)!.nextElementSibling?.contains(card())).toBe(true);
    expect(field().value).toBe('Name it for what it counts.');
    expect(document.activeElement).toBe(field());
  });

  it('returns the keyboard on Escape to the stack from a card under a line, and to its row from a card opened from the row under the toolbar; the card is worked from the keyboard there', async () => {
    const user = userEvent.setup();
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    field().focus();
    await user.keyboard('{Escape}');
    await painted(() => card() === null);
    expect(document.activeElement).toBe(stackElement());
    expect(stackElement()!.tabIndex).toBe(-1); // focusable for the keyboard's return, and no new tab stop

    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => (bodyOf('src/other.ts')?.textContent?.includes('total') ?? false) && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    field().focus();
    const visited: Element[] = [];
    for (let step = 0; step < 6 && document.activeElement !== sendButton(); step++) {
      await user.tab();
      visited.push(document.activeElement!);
    }
    expect(visited).toContain(box());
    expect(document.activeElement).toBe(sendButton());
    field().focus();
    await user.keyboard('{Escape}');
    await painted(() => card() === null && unplacedRows().length === 1 && document.activeElement === unplacedEdit(0));
    expect(document.activeElement).toBe(unplacedEdit(0)); // its row, not the scroller
    await user.keyboard('{Enter}'); // the row opens the card again from the keyboard
    await painted(() => lineLeft()?.contains(card()) ?? false);
    field().focus();
    await user.keyboard('{Escape}');
    await painted(() => card() === null && document.activeElement === unplacedEdit(0));
    await user.keyboard(' ');
    await painted(() => lineLeft()?.contains(card()) ?? false);
    expect(field().value).toBe('Name it for what it counts.');
    await painted(() => lineLeft()?.contains(card()) ?? false);
    sendButton().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
    await painted(() => card() === null && pass() === null);
    expect(document.activeElement).toBe(stackElement()); // after a send, too
  });

  it('reaches and edits both of two comments whose lines left the diff from the row under the toolbar, oldest first, and keeps both', async () => {
    await mountReview();
    await twoComments();
    await reread(REPORT_GONE() + OTHER_GONE(), FILES());
    await painted(() => unplacedRows().length === 2);
    expect(unplacedWords().map((words) => words.textContent)).toEqual(['The line this comment was on is no longer in this diff.']); // once, over both
    expect(unplacedRows().map((row) => row.textContent)).toEqual(['export const b = 2;Name it for what it counts.', 'return quoted(value);Quote only where a comma is.']);
    fireEvent.click(unplacedEdit(0));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Name it for what it counts.');
    expect(unplacedRows().map((row) => row.textContent)).toEqual(['return quoted(value);Quote only where a comma is.']); // the card in its row's place
    type('Name it for the total.');
    leave();
    await painted(() => card() === null && unplacedRows().length === 2);
    fireEvent.click(unplacedEdit(1));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Quote only where a comma is.');
    type('Quote where a comma or a quote is.');
    leave();
    await painted(() => card() === null && unplacedRows().length === 2);
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for the total.', 'Quote where a comma or a quote is.']);
    expect(chip()!.textContent).toBe('2 unsent comments');
  });

  it('reaches an older comment whose line left the diff while the newest is placeable: the chip opens the newest under its line, the row the older one', async () => {
    await mountReview();
    await twoComments(); // other's is the older
    await reread(REPORT() + OTHER_GONE(), FILES());
    await painted(() => unplacedRows().length === 1 && chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:12' && card() !== null);
    expect(field().value).toBe('Quote only where a comma is.');
    expect(unplacedRows().map((row) => row.textContent)).toEqual(['export const b = 2;Name it for what it counts.']); // drawn with a card open elsewhere
    fireEvent.click(unplacedEdit(0));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Name it for what it counts.');
    await painted(() => unsentRows('src/report.ts').length === 1); // the newest, under its line again
    expect(unsentRows('src/report.ts').map((row) => row.textContent)).toEqual(['Quote only where a comma is.']);
  });

  it('removes the row under the toolbar with its last comment', async () => {
    await mountReview();
    await twoComments();
    await reread(REPORT_GONE() + OTHER_GONE(), FILES());
    await painted(() => unplacedRows().length === 2);
    fireEvent.click(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' }));
    await painted(() => unplacedRows().length === 1);
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Quote only where a comma is.']);
    fireEvent.click(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' }));
    await painted(() => lineLeft() === null);
    expect(pass()).toBeNull();
  });

  it(`shows at most ${UNPLACED_ROWS_SHOWN} rows of comments it cannot place and scrolls the rest inside the row`, async () => {
    expect(UNPLACED_ROWS_SHOWN).toBe(3);
    const items = () => [...document.querySelectorAll<HTMLElement>('[data-review-unplaced-item]')];
    vi.spyOn(reviewLayout, 'height').mockImplementation((element) => (element.matches('[data-review-unplaced-item]') ? 24 : 0));
    vi.spyOn(reviewLayout, 'offsetWithin').mockImplementation((element) => (element.matches('[data-review-unplaced-item]') ? 20 + 26 * items().indexOf(element as HTMLElement) : 0));
    await mountReview();
    await twoComments();
    for (const [side, line, text] of [['old', 12, 'Why was the plain return dropped?'], ['new', 11, 'Say what an empty value means.']] as const) {
      addOn('src/report.ts', side, line);
      await painted(() => card() !== null && cardRow()?.dataset.reviewCardRow === `${side}:${line}`);
      type(text);
      leave();
      await painted(() => card() === null);
    }
    await reread(REPORT_GONE() + OTHER_GONE(), FILES());
    await painted(() => unplacedRows().length === 4);
    const list = lineLeft()!.querySelector<HTMLElement>('[data-review-unplaced-list]')!;
    expect(list.className).toMatch(/(^| )overflow-y-auto( |$)/);
    expect(list.style.maxHeight).toBe(`${20 + 26 * 2 + 24}px`); // to the third row's bottom
    fireEvent.click(within(unplacedRows()[3]).getByRole('button', { name: 'Remove comment' }));
    await painted(() => unplacedRows().length === 3);
    expect(list.style.maxHeight).toBe(''); // three fit
  });

  it('says which comments’ lines left the diff and which comments’ files it does not hold, each sentence over its own', async () => {
    main.state.status = { ...STATUS, files: STATUS.files.map((file) => (file.path === 'src/report.ts' ? { ...file, index: 'M' as const } : file)) };
    main.state.staged = { patch: REPORT_GONE(), files: [FILES()[0]] }; // Staged: report.ts alone, its line 12 rewritten
    offs.push(useReview.getState().hold({ machine: TEST_MACHINE, directory: '/repo', scope: 'staged', read: 'git.diff', against: null }));
    await mountReview();
    await twoComments();
    await painted(() => scopeChip('staged') !== null && !scopeChip('staged')!.disabled);
    fireEvent.click(scopeChip('staged')!);
    await painted(() => unplacedRows().length === 2);
    const order = [...lineLeft()!.querySelectorAll<HTMLElement>('[data-review-unplaced-words], [data-review-unplaced-comment]')].map((each) => each.dataset.reviewUnplacedWords ?? each.textContent);
    expect(order).toEqual(['line-left', 'return quoted(value);Quote only where a comma is.', 'not-in-diff', 'export const b = 2;Name it for what it counts.']);
    expect(unplacedWords().map((words) => words.textContent)).toEqual(['The line this comment was on is no longer in this diff.', 'The file this comment is on is not in this diff.']);
  });

  it('reaches the rows in order from the toolbar by Tab', async () => {
    const user = userEvent.setup();
    await mountReview();
    await twoComments();
    await reread(REPORT_GONE() + OTHER_GONE(), FILES());
    await painted(() => unplacedRows().length === 2);
    screen.getByRole('button', { name: 'View' }).focus(); // the toolbar's last control
    await user.tab();
    expect(document.activeElement).toBe(unplacedEdit(0));
    await user.tab();
    expect(document.activeElement).toBe(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' }));
    await user.tab();
    expect(document.activeElement).toBe(unplacedEdit(1));
  });

  it('keeps a comment on a file that turned binary reachable: its row under the toolbar says its line left the diff, and its card there edits it', async () => {
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    leave();
    await painted(() => card() === null);
    const binary = ['diff --git a/src/report.ts b/src/report.ts', 'index 1..2 100644', 'Binary files a/src/report.ts and b/src/report.ts differ', ''].join('\n');
    await reread(binary + OTHER(), [{ path: 'src/report.ts', oldPath: null, insertions: 0, deletions: 0, binary: true }, FILES()[1]]);
    await painted(() => unplacedRows().length === 1);
    expect(unplacedWords().map((words) => words.textContent)).toEqual(['The line this comment was on is no longer in this diff.']);
    expect(unplacedRows()[0].textContent).toBe('return quoted(value);Quote only where a comma is.');
    fireEvent.click(unplacedEdit(0));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Quote only where a comma is.');
    type('Quote where a comma is, and say why.');
    leave();
    await painted(() => card() === null && unplacedRows().length === 1);
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Quote where a comma is, and say why.']);
  });

  it('opens from the chip a comment in a folded file of a scope past the cap under its line: the file unfolded and read, its words edited there', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => card() === null && chip() !== null);
    main.state.pastCap = true;
    await reread(REPORT() + OTHER(), FILES()); // past the cap: every file folded, read on its own
    await painted(() => sectionOf('src/other.ts')?.hasAttribute('data-folded') ?? false);
    expect(lineLeft()).toBeNull(); // not read yet is not unplaceable
    fireEvent.click(chip()!);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:2' && card() !== null);
    expect(bodyOf('src/other.ts')!.contains(card())).toBe(true);
    expect(sectionOf('src/other.ts')!.hasAttribute('data-folded')).toBe(false);
    expect(main.callsOf('git.diff')).toContainEqual(expect.objectContaining({ path: 'src/other.ts' }));
    expect(field().value).toBe('Name it for what it counts.');
    type('Name it for the total.');
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for the total.']);
  });

  it("lists a comment whose file’s own read failed under “This file's diff is not shown here.”, edits it there, and puts it back under its line when Retry succeeds", async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => card() === null && chip() !== null);
    main.state.failing.add('src/other.ts');
    main.state.pastCap = true;
    await reread(REPORT() + OTHER(), FILES());
    await painted(() => sectionOf('src/other.ts')?.hasAttribute('data-folded') ?? false);
    fireEvent.click(sectionOf('src/other.ts')!.querySelector('[data-review-fold]')!);
    await painted(() => unplacedRows().length === 1);
    expect(unplacedWords().map((words) => words.textContent)).toEqual(["This file's diff is not shown here."]);
    fireEvent.click(unplacedEdit(0));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Name it for what it counts.');
    type('Name it for the total.');
    leave();
    await painted(() => card() === null && unplacedRows().length === 1);

    main.state.failing.clear();
    fireEvent.click(within(sectionOf('src/other.ts')!).getByRole('button', { name: 'Retry' }));
    await painted(() => lineLeft() === null && unsentRows('src/other.ts').length === 1);
    expect(lineRow('src/other.ts', 'new', 2)!.nextElementSibling?.contains(unsentRows('src/other.ts')[0])).toBe(true);
    expect(unsentRows('src/other.ts')[0].textContent).toBe('Name it for the total.');
  });

  it("lists a comment on a file grown too large to draw under “This file's diff is not shown here.”, and opens its card there", async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => card() === null && chip() !== null);
    const huge = ['diff --git a/src/other.ts b/src/other.ts', 'index 3..4 100644', '--- a/src/other.ts', '+++ b/src/other.ts', '@@ -1,2 +1,2003 @@', ' export const a = 1;', '+export const b = 2;', ...Array.from({ length: 2000 }, (_, i) => `+export const n${i} = ${i};`), ' export const c = 3;', ''].join('\n');
    await reread(REPORT() + huge, [FILES()[0], { path: 'src/other.ts', oldPath: null, insertions: 2001, deletions: 0, binary: false }]);
    await painted(() => sectionOf('src/other.ts')?.querySelector('[data-review-too-large]') != null && unplacedRows().length === 1);
    expect(unplacedWords().map((words) => words.textContent)).toEqual(["This file's diff is not shown here."]);
    expect(unplacedRows()[0].textContent).toBe('export const b = 2;Name it for what it counts.');
    fireEvent.click(unplacedEdit(0));
    await painted(() => (lineLeft()?.contains(card()) ?? false) && field().value === 'Name it for what it counts.');
  });

  it('keeps a comment whose line left the diff in the pass and the chip, drawn under no line', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => unsentRows('src/other.ts').length === 1);
    await reread(REPORT() + OTHER('export const total = 2;'), FILES());
    await painted(() => bodyOf('src/other.ts')?.textContent?.includes('total') ?? false);
    expect(unsentRows()).toEqual([]);
    expect(chip()?.textContent).toBe('1 unsent comment');
    expect(unplacedRows().map((row) => row.textContent)).toEqual(['export const b = 2;Name it for what it counts.']); // its place: the row under the toolbar
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for what it counts.']);
  });

  it('keeps the card’s host while the scope has no files: the open card stands where the toolbar stands, under the line that says its line left, and goes back under its line when the file returns; a draft left there is the chip’s', async () => {
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    await reread('', []); // the agent reverts everything
    await painted(() => document.querySelector('[data-review-empty]') !== null && (lineLeft()?.contains(card()) ?? false));
    expect(lineLeft()!.textContent).toContain('The file this comment is on is not in this diff.');
    expect(field().value).toBe('Quote only where a comma is.');

    await reread(REPORT() + OTHER(), FILES());
    await drawn('src/report.ts');
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:12' && card() !== null);
    expect(lineLeft()).toBeNull();
    expect(field().value).toBe('Quote only where a comma is.');

    await reread('', []);
    await painted(() => lineLeft()?.contains(card()) ?? false);
    leave();
    await painted(() => card() === null && surfaceChip() !== null);
    expect(surfaceChip()!.textContent).toBe('1 unsent comment');
    expect(unplacedRows().map((row) => row.textContent)).toEqual(['return quoted(value);Quote only where a comma is.']); // and its row stands under the toolbar's place
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Quote only where a comma is.']);
  });

  it('keeps the place line after a confirmed send while the scope has no files', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    fireEvent.click(sendButton());
    await painted(() => document.querySelector('[data-review-toolbar] [data-sent-note]') !== null);
    await reread('', []);
    await painted(() => document.querySelector('[data-review-empty]') !== null);
    expect(document.querySelector('[data-review] [data-sent-note]')?.textContent).toBe('Sent to Berth import');
  });

  it('draws each scope’s own hunks for a file under an open card: Uncommitted’s hold is let go when Staged, already read, is chosen', async () => {
    main.state.status = { ...STATUS, files: STATUS.files.map((file) => (file.path === 'src/report.ts' ? { ...file, index: 'M' as const } : file)) };
    main.state.staged = { patch: MOVED, files: [FILES(2)[0]] }; // Staged holds the file with two lines more above the commented one
    // Staged read and kept by another surface (a diff tab of it), so choosing it answers at once and the stack stays
    const release = useReview.getState().hold({ machine: TEST_MACHINE, directory: '/repo', scope: 'staged', read: 'git.diff', against: null });
    offs.push(release);
    await mountReview();
    await painted(() => scopeChip('staged') !== null && !scopeChip('staged')!.disabled);
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Quote only where a comma is.');

    fireEvent.click(scopeChip('staged')!);
    expect(document.querySelector('[data-review-stack]')).not.toBeNull(); // answered at once: no wait between the scopes
    await painted(() => bodyOf('src/other.ts') === null && (bodyOf('src/report.ts')?.querySelector('table') ?? null) !== null);
    expect(bodyOf('src/report.ts')!.textContent).toContain('// one'); // Staged's hunks, not Uncommitted's held ones
    expect(changedLine('src/report.ts')).toBeNull();
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:14' && card() !== null);
    expect(field().value).toBe('Quote only where a comma is.');

    fireEvent.click(scopeChip('uncommitted')!);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:12' && card() !== null);
    expect(bodyOf('src/report.ts')!.textContent).not.toContain('// one');
    expect(changedLine('src/report.ts')).toBeNull();
  });

  it('stands an open card whose file is not in the chosen scope under the toolbar, with the keyboard, and back under its line in the scope that has it', async () => {
    main.state.status = { ...STATUS, files: STATUS.files.map((file) => (file.path === 'src/report.ts' ? { ...file, index: 'M' as const } : file)) };
    main.state.staged = { patch: REPORT(), files: [FILES()[0]] }; // Staged has report.ts alone
    offs.push(useReview.getState().hold({ machine: TEST_MACHINE, directory: '/repo', scope: 'staged', read: 'git.diff', against: null }));
    await mountReview();
    await painted(() => scopeChip('staged') !== null && !scopeChip('staged')!.disabled);
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    field().focus();
    fireEvent.click(scopeChip('staged')!);
    await painted(() => bodyOf('src/other.ts') === null && (lineLeft()?.contains(card()) ?? false));
    expect(field().value).toBe('Name it for what it counts.');
    expect(document.activeElement).toBe(field());
    fireEvent.click(scopeChip('uncommitted')!);
    await painted(() => cardRow()?.dataset.reviewCardRow === 'new:2' && card() !== null && lineLeft() === null);
    expect(bodyOf('src/other.ts')!.contains(card())).toBe(true);
  });

  it('keeps the pass when the session’s working folder changes', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => chip() !== null);
    const checkout = '/repo/.claude/worktrees/w1';
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo', title: { text: 'Berth import', source: 'user' }, agentFolder: { checkout, cwd: checkout, branch: 'w1', linked: true } })) })));
    await waitFor(() => expect(main.callsOf('git.diff')).toContainEqual({ directory: checkout, scope: 'all' }));
    await painted(() => chip() !== null);
    expect(chip()!.textContent).toBe('1 unsent comment');
    expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for what it counts.']);
  });

  it('stands the card, and the unsent rows with it, at the code’s left edge where the gutter and its width fit, at the row’s left edge where they do not, and in Split under the side that holds the line', async () => {
    let row = 720;
    vi.spyOn(reviewLayout, 'width').mockImplementation((element) => (element.matches('[data-review-card-row], [data-review-unsent]') ? row : element.matches('td.diff-line-num, td.diff-line-old-num, td.diff-line-new-num') ? 80 : 0));
    await mountReview();
    addOn('src/report.ts', 'new', 12);
    await painted(() => cardRow() !== null);
    type('Quote only where a comma is.');
    expect(cardRow()!.style.paddingLeft).toBe('80px'); // the gutter and the card's 300 px fit in 720
    leave();
    await painted(() => unsentRows().length === 1);
    expect(unsentRows()[0].closest<HTMLElement>('[data-review-unsent]')!.style.paddingLeft).toBe('80px'); // its row stands where its card stood
    row = 360; // a narrow column: 80 + 300 do not fit
    await painted(() => chip() !== null);
    fireEvent.click(chip()!);
    await painted(() => cardRow() !== null);
    expect(cardRow()!.style.paddingLeft).toBe('0px');

    row = 720;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Split' }));
    await painted(() => document.querySelector('[data-review-file="src/report.ts"] .split-diff-view') !== null && cardRow() !== null);
    const oldSide = document.querySelector('[data-review-file="src/report.ts"] .old-diff-table-wrapper')!;
    const newSide = document.querySelector('[data-review-file="src/report.ts"] .new-diff-table-wrapper')!;
    expect(newSide.contains(cardRow())).toBe(true); // a line of the new side: its card under the new side
    expect(oldSide.contains(cardRow())).toBe(false);
    expect(oldSide.querySelector('tr[data-state="widget"]')).not.toBeNull(); // and its row spans both sides
    expect(cardRow()!.style.paddingLeft).toBe('80px');
    expect(field().value).toBe('Quote only where a comma is.');
  });

  it('gives the add button, a row’s edit target and Remove a pressed area of at least 24 px', async () => {
    const css = readFileSync(resolve(__dirname, '../code.css'), 'utf8');
    expect(css).toMatch(/\.review-diff \.diff-add-widget::after \{[^}]*width: 24px;[^}]*height: 24px;/);
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => unsentRows().length === 1);
    expect(unsentRows()[0].querySelector('[data-review-unsent-edit]')!.className).toMatch(/(^| )min-h-6( |$)/);
    expect(unsentRows()[0].querySelector('[data-review-unsent-remove]')!.className).toMatch(/(^| )size-6( |$)/);
  });

  it('takes no room in the toolbar while the host draws neither a chip nor a place line', async () => {
    const css = readFileSync(resolve(__dirname, '../code.css'), 'utf8');
    const empty = '[data-review-toolbar-chip]:has([data-card-inline]:empty)';
    expect(css).toContain(`${empty} {\n  display: none;`);
    await mountReview();
    const slot = document.querySelector<HTMLElement>('[data-review-toolbar] [data-review-toolbar-chip]')!;
    expect(slot.matches(empty)).toBe(true);
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    await painted(() => chip() !== null);
    expect(slot.matches(empty)).toBe(false);
  });

  it('works in a diff tab as in the panel: the card under its line there, and the panel’s comment a row', async () => {
    await mountReview();
    addOn('src/other.ts', 'new', 2);
    await painted(() => card() !== null);
    type('Name it for what it counts.');
    leave();
    cleanup();
    render(<DiffTab tab={{ id: `diff:${A}:uncommitted`, kind: 'diff', appSessionId: A, ref: 'uncommitted', pinned: false }} />);
    await drawn('src/report.ts');
    await painted(() => unsentRows('src/other.ts').length === 1);
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null && (bodyOf('src/report.ts')?.contains(card()) ?? false));
    expect(useCommentCard.getState().open?.hostId).toBe(`diff:${A}:uncommitted`);
    type('Quote only where a comma is.');
    expect(sendButton().textContent).toBe('Send 2 comments');
  });

  it('for a session on another machine: the checkbox is ticked and locked, with today’s sentence', async () => {
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState((s) => ({
      listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-r', { lane: 'B' }), appId: remote }]]),
      listedMachines: new Set([OTHER_MACHINE]),
      records: new Map(s.records).set(remote, record(remote, { directory: '/repo' })),
    }));
    act(() => void panelHost.addTool('review', { appSessionId: remote }));
    render(<TestHost />);
    await drawn('src/report.ts');
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(box().closest('label')!.getAttribute('title')).toBe('A side thread is not available on Studio yet');
  });

  // Last turn: one file edited twice, each edit a block of its own whose new side shows `l9` at line 9.
  describe('on Last turn', () => {
    afterEach(() => {
      for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
      act(() => useCommentCard.setState({ open: null, passes: new Map() }));
    });

    async function lastTurn(file: string) {
      const b = builder();
      b.turn('u1');
      const edit = (id: string, input: Record<string, unknown>, hunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }) => {
        b.toolUse(id, 'Edit', { file_path: file, ...input }, `m-${id}`, 0);
        b.result(id, 'ok', { structured: { filePath: file, structuredPatch: [hunk], userModified: false } });
      };
      edit('e1', { old_string: 'l8', new_string: 'EIGHT' }, { oldStart: 7, oldLines: 3, newStart: 7, newLines: 3, lines: [' l7', '-l8', '+EIGHT', ' l9'] });
      edit('e2', { old_string: 'l10', new_string: 'TEN' }, { oldStart: 9, oldLines: 3, newStart: 9, newLines: 3, lines: [' l9', '-l10', '+TEN', ' l11'] });
      b.text('m9', 0, 'Done.');
      b.end(['u1']);
      await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(b.events) }));
      const divider = useTranscriptStore.getState().rows(A).find((row) => row.kind === 'divider' && row.files?.length);
      if (divider?.kind !== 'divider') throw new Error('no changed-file divider');
      act(() => void panelHost.addTool('review', { appSessionId: A, params: { scope: 'turn', turnId: divider.turnId as TurnId } }));
      render(<TestHost />);
      await painted(() => (bodyOf(file)?.querySelectorAll('[data-review-block] table').length ?? 0) === 2);
    }
    // A line's add button in one block, pressed as the library listens for it.
    function addIn(path: string, block: number, line: number): void {
      const cell = bodyOf(path)?.querySelector(`[data-review-block="${block}"] [data-line-new-num="${line}"]`);
      const button = cell?.closest('tr')?.querySelector<HTMLButtonElement>('[data-add-widget="new"] button');
      expect(button, `the add button on ${path} block ${block} line ${line}`).toBeTruthy();
      fireEvent.mouseDown(button!);
    }

    // The branch panel's fourth finding: a full pass adds nothing, and the comment it opens keeps the block it was made in.
    it('keeps the newest comment in the block it was made in when a full pass refuses an add on the same text in another block', async () => {
      const path = '/repo/two.ts';
      await lastTurn(path);
      const seeded: PassComment[] = Array.from({ length: MESSAGE_COMMENTS_MAX - 1 }, (_, i) => ({
        id: String(900_000 + i),
        anchor: { kind: 'file-line', locator: `${path}#L7`, label: 'two.ts:7', path, line: 7 },
        quote: 'l7',
        text: `An earlier comment, number ${i + 1}.`,
        screenshot: null,
        rect: null,
        flight: null,
        refused: null,
      }));
      act(() => useCommentCard.setState({ passes: new Map([[KEY, { host: 'review', subject: A, appSessionId: A, comments: seeded, toMain: true }]]) }));
      addIn(path, 0, 9); // the pass's last place: a comment in the first edit's block
      await painted(() => card() !== null);
      type('The ninth line, as the first edit left it.');
      leave();
      await painted(() => card() === null);
      expect(pass()!.comments).toHaveLength(MESSAGE_COMMENTS_MAX);
      addIn(path, 1, 9); // the same text in the second edit's block: the pass is full, and its newest is opened
      await painted(() => card() !== null && cardRow() !== null);
      expect(pass()!.comments).toHaveLength(MESSAGE_COMMENTS_MAX);
      expect(field().value).toBe('The ninth line, as the first edit left it.');
      expect(cardRow()!.closest('[data-review-block]')?.getAttribute('data-review-block')).toBe('0');
    });

    // The branch panel's sixth finding: Last turn names its files absolutely, which needs no repository's root.
    it('takes a comment on a line of Last turn when Git cannot be read: the add button opens the card, and its draft is drawn under its line', async () => {
      main.state.status = null;
      await lastTurn('/scratch/two.ts');
      addIn('/scratch/two.ts', 0, 8);
      await painted(() => card() !== null);
      expect(pass()!.comments.map((c) => [c.anchor, c.quote])).toEqual([[expect.objectContaining({ kind: 'file-line', path: '/scratch/two.ts', line: 8 }), 'EIGHT']]);
      type('Name the eighth line.');
      leave();
      await painted(() => card() === null && unsentRows('/scratch/two.ts').length === 1);
      expect(lineRow('/scratch/two.ts', 'new', 8)!.nextElementSibling?.contains(unsentRows('/scratch/two.ts')[0])).toBe(true);
    });
  });

  // UX wave U5b-2 (M9, S19): comments on two commits' diffs, made through the card's real store, each drawn only in its own
  // commit; sent together after an amend, each anchor the producer's, and the one message naming both hashes.
  it('keeps each commit’s comments its own on the same path and line, neither under a line in Uncommitted, and sends both after an amend; the message, derived as the transcript derives it, gives each chip its own commit (S19)', async () => {
    const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const SHA_B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
    act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: T0, generation: 0, capabilities: ['rl2.git-reads'] }]));
    const openCommit = (commit: string) => act(() => void panelHost.addTool('review', { appSessionId: A, params: { scope: 'commit', commit } }));
    openCommit(SHA_A);
    render(<TestHost />);
    await drawn('src/report.ts');
    addOn('src/report.ts', 'new', 12);
    await painted(() => card() !== null);
    type('Why quote it in this commit?');
    leave();
    await painted(() => card() === null && unsentRows('src/report.ts').length === 1);

    openCommit(SHA_B);
    await painted(() => scopeChip('commit')?.textContent === 'Commit b2c3d4e');
    await drawn('src/report.ts');
    expect(unsentRows()).toEqual([]); // commit A's comment is not under a line of commit B
    addOn('src/report.ts', 'new', 12); // the same path and line, in commit B
    await painted(() => card() !== null);
    type('Quote only where a comma is.');
    leave();
    await painted(() => card() === null && unsentRows('src/report.ts').length === 1);
    expect(unsentRows('src/report.ts')[0].textContent).toBe('Quote only where a comma is.');

    fireEvent.click(scopeChip('uncommitted')!);
    await painted(() => scopeChip('uncommitted')?.getAttribute('aria-pressed') === 'true');
    await drawn('src/report.ts');
    expect(unsentRows()).toEqual([]);

    const amended = { ...STATUS, head: 'fedcba9876543210' };
    main.state.status = amended;
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: amended, reason: 'head' }));
    await waitFor(() => expect(main.callsOf('git.commitDiff')).toContainEqual({ directory: '/repo', commit: SHA_B, patch: false }));

    fireEvent.click(scopeChip('commit')!);
    await drawn('src/report.ts');
    await painted(() => unsentRows('src/report.ts').length === 1);
    fireEvent.click(within(unsentRows('src/report.ts')[0]).getByText('Quote only where a comma is.'));
    await painted(() => card() !== null);
    expect(sendButton().textContent).toBe('Send 2 comments');
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
    const [{ comments }] = main.callsOf('side.comment.content') as { comments: MessageComment[] }[];
    const anchors = [commitLineAnchor('src/report.ts', 12, 'new', SHA_A), commitLineAnchor('src/report.ts', 12, 'new', SHA_B)];
    expect(comments.map((c) => c.anchor)).toEqual(anchors);

    // the message the main conversation receives, as a user event through the transcript's own derivation
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: commentsMessage(comments, 'main'), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const row = rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
    expect(row.comments?.map((c) => c.anchor)).toEqual(anchors);
    const actions = { ...spyActions(), openCommit: vi.fn() };
    const drawnRow = renderRow(row, { storeKey: A, actions });
    const chips = [...drawnRow.container.querySelectorAll<HTMLButtonElement>('button[data-chip="anchor"]')];
    expect(chips.map((each) => each.textContent)).toEqual(['report.ts:12 · a1b2c3d', 'report.ts:12 · b2c3d4e']);
    chips.forEach((each) => fireEvent.click(each));
    expect(actions.openCommit.mock.calls).toEqual([
      [A, SHA_A, 'src/report.ts'],
      [A, SHA_B, 'src/report.ts'],
    ]);
  });

  // UX wave U5b-2 fix 1 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §G, Decision Log 37): a
  // comment made on a commit, while Review shows any other scope, is listed in the row under the toolbar under "This comment
  // is on commit <sha7>.", whose hash opens that commit at the comment's file by the act R8's chip uses; the row keeps its
  // controls; U5a's chip opening it stands its card there. Comments made through the card's real store and producers.
  describe('a comment made on a commit, while another scope is shown (UX wave U5b-2)', () => {
    const ON = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const ELSE = 'c3d4e5f60718293a4b5c6d7e8f901234567890ab';
    const serve = () => act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: T0, generation: 0, capabilities: ['rl2.git-reads'] }]));
    const openOn = (commit: string) => act(() => void panelHost.addTool('review', { appSessionId: A, params: { scope: 'commit', commit } }));
    const onCommitWords = () => [...document.querySelectorAll<HTMLElement>('[data-review-unplaced-words="on-commit"]')].map((each) => each.textContent);
    const commitButton = () => document.querySelector<HTMLButtonElement>('[data-review-unplaced] [data-review-unplaced-commit]');
    afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));

    // Review on commit ON, and a comment left on report.ts's line 12 there
    async function commentOnCommit() {
      openOn(ON);
      await drawn('src/report.ts');
      await drawn('src/other.ts');
      addOn('src/report.ts', 'new', 12);
      await painted(() => card() !== null);
      type('Quote only where a comma is.');
      leave();
      await painted(() => card() === null && unsentRows('src/report.ts').length === 1);
    }
    async function mounted() {
      serve();
      openReview();
      render(<TestHost />);
      await drawn('src/report.ts');
    }

    const scopes: [string, () => void][] = [
      ['Uncommitted', () => fireEvent.click(scopeChip('uncommitted')!)],
      ['This branch', () => fireEvent.click(scopeChip('branch')!)],
      ['another commit', () => openOn(ELSE)],
    ];
    for (const [name, choose] of scopes)
      for (const present of [true, false])
        it(`lists it under “This comment is on commit a1b2c3d.” in ${name}, its file ${present ? 'in' : 'not in'} that scope`, async () => {
          await mounted();
          await commentOnCommit();
          if (!present) {
            main.state.patch = OTHER();
            main.state.files = FILES().filter((file) => file.path === 'src/other.ts');
          }
          choose();
          await drawn('src/other.ts');
          await painted(() => onCommitWords().length === 1);
          expect(sectionOf('src/report.ts') !== null).toBe(present);
          expect(onCommitWords()).toEqual(['This comment is on commit a1b2c3d.']);
          expect(commitButton()?.textContent).toBe('a1b2c3d');
          expect(unplacedRows()).toHaveLength(1);
          expect(unplacedRows()[0].textContent).toContain('Quote only where a comma is.');
          expect(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' })).toBeTruthy();
          expect(unsentRows()).toEqual([]); // drawn under no line, even where its file and line are in the scope
        });

    it('opens the newest comment from U5a’s chip in that row when it is a commit’s, and removes it there', async () => {
      await mounted();
      await drawn('src/other.ts');
      addOn('src/other.ts', 'new', 2); // an older comment, in Uncommitted
      await painted(() => card() !== null);
      type('Name it for what it counts.');
      leave();
      await painted(() => card() === null);
      await commentOnCommit();
      fireEvent.click(scopeChip('uncommitted')!);
      await painted(() => onCommitWords().length === 1 && unsentRows('src/other.ts').length === 1);
      expect(chip()?.textContent).toBe('2 unsent comments');
      fireEvent.click(chip()!);
      await painted(() => card() !== null);
      expect(lineLeft()!.contains(card())).toBe(true);
      expect(cardRow()?.dataset.reviewCardRow).toBe('away');
      expect(field().value).toBe('Quote only where a comma is.');
      leave();
      await painted(() => card() === null && unplacedRows().length === 1);
      fireEvent.click(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' }));
      await painted(() => lineLeft() === null);
      expect(pass()!.comments.map((c) => c.text)).toEqual(['Name it for what it counts.']);
    });

    it('edits it in that row and sends it, its anchor the commit’s', async () => {
      await mounted();
      await commentOnCommit();
      fireEvent.click(scopeChip('uncommitted')!);
      await painted(() => unplacedRows().length === 1);
      fireEvent.click(unplacedEdit(0));
      await painted(() => card() !== null && lineLeft()!.contains(card()));
      expect(field().value).toBe('Quote only where a comma is.');
      type('Quote only where a comma or a quote is.');
      fireEvent.click(sendButton());
      await waitFor(() => expect(main.callsOf('session.send')).toHaveLength(1));
      expect(main.callsOf('side.comment.content')).toEqual([
        { comments: [{ anchor: commitLineAnchor('src/report.ts', 12, 'new', ON), text: '`return quoted(value);`\nQuote only where a comma or a quote is.', screenshot: null }] },
      ]);
    });

    // M9 fix 3 (Decision Log 39): a comment made on no commit, while a commit's scope is shown
    it('opens a comment made on no commit from U5a’s chip in the row under “This comment is not on this commit.” while a commit’s scope is shown, and places it under its line again in Uncommitted', async () => {
      await mounted();
      addOn('src/report.ts', 'new', 12); // in Uncommitted
      await painted(() => card() !== null);
      type('Quote only where a comma is.');
      leave();
      await painted(() => card() === null && unsentRows('src/report.ts').length === 1);
      openOn(ON);
      await drawn('src/report.ts');
      const words = () => [...document.querySelectorAll<HTMLElement>('[data-review-unplaced-words="not-on-commit"]')].map((each) => each.textContent);
      await painted(() => words().length === 1);
      expect(words()).toEqual(['This comment is not on this commit.']);
      expect(document.querySelector('[data-review-unplaced] [data-review-unplaced-commit]')).toBeNull(); // no link in it
      expect(unsentRows()).toEqual([]); // not under the commit's line, though its text is the quote
      expect(unplacedRows()).toHaveLength(1);
      expect(within(unplacedRows()[0]).getByRole('button', { name: 'Remove comment' })).toBeTruthy();
      expect(chip()?.textContent).toBe('1 unsent comment');
      fireEvent.click(chip()!);
      await painted(() => card() !== null);
      expect(lineLeft()!.contains(card())).toBe(true);
      expect(cardRow()?.dataset.reviewCardRow).toBe('away');
      expect(field().value).toBe('Quote only where a comma is.');
      leave();
      await painted(() => card() === null && unplacedRows().length === 1);
      fireEvent.click(scopeChip('uncommitted')!);
      await drawn('src/report.ts');
      await painted(() => unsentRows('src/report.ts').length === 1);
      expect(lineLeft()).toBeNull();
      expect(lineRow('src/report.ts', 'new', 12)!.nextElementSibling?.contains(unsentRows('src/report.ts')[0])).toBe(true);
    });

    it('opens Review on that commit at the comment’s file from the hash, by the act R8’s chip uses; there it stands under its line', async () => {
      await mounted();
      await commentOnCommit();
      fireEvent.click(scopeChip('uncommitted')!);
      await painted(() => commitButton() !== null);
      const addTool = vi.spyOn(panelHost, 'addTool');
      fireEvent.click(commitButton()!);
      expect(addTool.mock.calls).toEqual([['review', { appSessionId: A, params: { scope: 'commit', commit: ON, path: 'src/report.ts' } }]]);
      await painted(() => scopeChip('commit')?.getAttribute('aria-pressed') === 'true' && unsentRows('src/report.ts').length === 1);
      expect(onCommitWords()).toEqual([]);
    });
  });
});
