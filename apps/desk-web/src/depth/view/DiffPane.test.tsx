// @vitest-environment happy-dom
// The Diff tab draws what the machine answered: its changes against the base, that there are none, or — when the machine
// could not take the diff — why, never an empty "No changes against" with no base.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlaneTranscript, PlaneTranscriptState } from '../../../../../src/renderer/src/lane-a/plane-transcript';
import { createDiffView, DiffPane } from './DiffPane';

afterEach(cleanup);

function pane(answer: { base: string; text: string; error?: string } | null) {
  const controller = { target: { machine: 'mini', session: 's', agentId: null }, requestDiff: vi.fn() } as unknown as PlaneTranscript;
  const state = { phase: 'live', diff: { pending: answer === null, answer } } as unknown as PlaneTranscriptState;
  render(<DiffPane controller={controller} state={state} view={createDiffView()} />);
  return screen.getByTestId('depth-diff');
}

it("draws the machine's error when it could not take the diff", () => {
  const diff = pane({ base: '', text: '', error: "Command '['git', 'diff']' timed out after 10 seconds" });
  expect(screen.getByRole('status').textContent).toBe("The diff failed on mini: Command '['git', 'diff']' timed out after 10 seconds");
  expect(diff.textContent).not.toContain('No changes against');
  expect(diff.querySelector('[data-review-header]')!.textContent).toBe('Diff');
  expect(diff.querySelector('[data-review-footer]')).toBeNull();
});

it('says when the session has no git working tree to diff, which the machine answers with no base', () => {
  const diff = pane({ base: '', text: '' });
  expect(screen.getByRole('status').textContent).toBe("No diff: the session's directory on mini is not in a git working tree.");
  expect(diff.textContent).not.toContain('No changes against');
  expect(diff.querySelector('[data-review-footer]')).toBeNull();
});

it('says there are no changes against a base it names', () => {
  const diff = pane({ base: 'main', text: '' });
  expect(diff.querySelector('[data-review-empty]')!.textContent).toBe('No changes against main');
  expect(diff.querySelector('[data-review-footer]')).toBeNull(); // the word cut (T357): the header names the base
});

// The pane's own words and its one-file walk (its view state is its own since MAWS's Review became a stack): the header's
// totals since the base, each file's header with its kind, and Previous file and Next file moving through the list.
it('heads the diff with its totals since the base and walks its files one at a time with Previous file and Next file', () => {
  const text = [
    'diff --git a/src/harbour.ts b/src/harbour.ts',
    'index 1..2 100644',
    '--- a/src/harbour.ts',
    '+++ b/src/harbour.ts',
    '@@ -1,2 +1,2 @@',
    '-const berths = 4;',
    '+const berths = 6;',
    ' export { berths };',
    'diff --git a/src/tide.ts b/src/tide.ts',
    'new file mode 100644',
    'index 0000000..3b18e51',
    '--- /dev/null',
    '+++ b/src/tide.ts',
    '@@ -0,0 +1 @@',
    '+export const tide = 2;',
    '',
  ].join('\n');
  const diff = pane({ base: 'main', text });
  const fileHeader = () => diff.querySelector('[data-review-file-header]')!.textContent;
  const previous = () => screen.getByRole('button', { name: 'Previous file' }) as HTMLButtonElement;
  const next = () => screen.getByRole('button', { name: 'Next file' }) as HTMLButtonElement;
  expect(diff.querySelector('[data-review-header]')!.textContent).toBe('2 files · +2 −1 · Since main'); // the word cut (T356)
  expect(diff.querySelector('[data-review-footer]')).toBeNull();
  expect(diff.textContent).not.toContain('Working tree');
  expect(fileHeader()).toBe('src/harbour.ts · Modified');
  expect([previous().disabled, next().disabled, previous().title, next().title]).toEqual([true, false, 'Previous file', 'Next file']);
  fireEvent.click(next());
  expect(fileHeader()).toBe('src/tide.ts · Added');
  expect([previous().disabled, next().disabled]).toEqual([false, true]);
  fireEvent.click(previous());
  expect(fileHeader()).toBe('src/harbour.ts · Modified');
});

// The word cut, as Review draws it: the hunk counter reads "n / m", named "Hunk n of m", its tooltip (T306); the wait for
// the diff is the quiet spinner, nothing for half a second (Review's Loading).
it('reads the hunk counter “n / m”, named “Hunk n of m”', () => {
  const text = ['diff --git a/src/harbour.ts b/src/harbour.ts', 'index 1..2 100644', '--- a/src/harbour.ts', '+++ b/src/harbour.ts', '@@ -1,2 +1,2 @@', '-const berths = 4;', '+const berths = 6;', ' export { berths };', ''].join('\n');
  const diff = pane({ base: 'main', text });
  const counter = screen.getByRole('img', { name: 'Hunk 1 of 1' });
  expect(counter.textContent).toBe('1 / 1');
  expect(counter.tabIndex).toBe(0); // the tooltip's owner takes the keyboard
  expect(diff.textContent).not.toContain('Showing hunk');
});

it('waits for the diff with the quiet spinner, nothing for its first half second', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const diff = pane(null);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(diff.textContent).not.toContain('Loading');
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
