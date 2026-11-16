// The chip of a comment on a commit's diff (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// M9, R8; decision 28): in a session's transcript it opens Review on that commit at that file, through the transcript's
// optional `openCommit`, never the path as a file; a mount without `openCommit` (the desk) draws it as a label. And the act
// itself: Review in the session's panel, on that commit, at that file.
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost } from '../../../panel/host';
import { rowsOf } from '../../../transcript/model/derive';
import { applyEvents, createState } from '../../../transcript/model/reduce';
import { builder, uuid } from '../../../transcript/model/test-events';
import { renderRow, rowOf, spyActions } from '../../../transcript/view/rows/test-support';
import { commitLineAnchor } from '../anchor/anchor';
import { openCommit, reviewTranscriptActions } from './open-commit';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const APP = 'app-commit' as AppSessionId;
const SHA = '3f9a1c27b84e5d60a1f2c3b4d5e6f708192a3b4c';

function userRow() {
  const b = builder();
  b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
  const text = anchoredMessage({ anchor: commitLineAnchor('src/berths.ts', 14, 'new', SHA), text: 'Why quote it here?', destination: 'main', screenshot: false });
  b.emit('user.message', { messageUuid: uuid('u1'), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  return rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
}

describe('the chip of a comment on a commit’s diff', () => {
  it('opens Review on that commit at that file, and never the path as a file', () => {
    const actions = { ...spyActions(), openCommit: vi.fn() };
    const { container } = renderRow(userRow(), { storeKey: APP, actions });
    const chip = container.querySelector<HTMLButtonElement>('button[data-chip="anchor"]')!;
    expect(chip.textContent).toBe('berths.ts:14 · 3f9a1c2');
    expect(chip.title).toBe(`src/berths.ts#L14@${SHA}`);
    fireEvent.click(chip);
    expect(actions.openCommit).toHaveBeenCalledWith(APP, SHA, 'src/berths.ts');
    expect(actions.openFile).not.toHaveBeenCalled();
  });

  it('is a label where the mount has no openCommit, or outside a session’s transcript', () => {
    const { container } = renderRow(userRow(), { storeKey: APP });
    expect(container.querySelector('button[data-chip="anchor"]')).toBeNull();
    expect(container.querySelector('span[data-chip="anchor"]')?.textContent).toBe('berths.ts:14 · 3f9a1c2');
    cleanup();
    const outside = renderRow(userRow(), { actions: { ...spyActions(), openCommit: vi.fn() } });
    expect(outside.container.querySelector('button[data-chip="anchor"]')).toBeNull();
  });
});

describe('openCommit', () => {
  it('adds Review to the session’s panel on that commit, at that file when one is named', () => {
    const addTool = vi.spyOn(panelHost, 'addTool').mockImplementation(() => undefined as never);
    openCommit(APP, SHA, 'src/berths.ts');
    reviewTranscriptActions.openCommit!(APP, SHA);
    expect(addTool.mock.calls).toEqual([
      ['review', { appSessionId: APP, params: { scope: 'commit', commit: SHA, path: 'src/berths.ts' } }],
      ['review', { appSessionId: APP, params: { scope: 'commit', commit: SHA } }],
    ]);
  });
});
