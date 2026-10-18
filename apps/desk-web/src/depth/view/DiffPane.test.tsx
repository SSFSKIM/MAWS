// @vitest-environment happy-dom
// The Diff tab draws what the machine answered: its changes against the base, that there are none, or — when the machine
// could not take the diff — why, never an empty "No changes against" with no base.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import { createDiffView, DiffPane } from './DiffPane';

afterEach(cleanup);

function pane(answer: { base: string; text: string; error?: string }) {
  const controller = { target: { machine: 'mini', session: 's', agentId: null }, requestDiff: vi.fn() } as unknown as DeskTranscript;
  const state = { phase: 'live', diff: { pending: false, answer } } as unknown as DepthTranscriptState;
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
  expect(diff.querySelector('[data-review-footer]')!.textContent).toBe('Working tree · Since main');
});
