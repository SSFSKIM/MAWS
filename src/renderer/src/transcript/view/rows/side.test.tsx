// E3 (M3): the anchored prompt's chip and the side-thread row on screen (E3 execution document, Design §6): the chip
// names what the comment is about and opens a file anchor at its line; the bubble shows the comment alone with its
// screenshot; the row reads opened, finished with the turn count, or failed, and its Open shows the thread in the
// parent's Side pane.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { anchoredMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { rowsOf } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import type { Row } from '../../model/rows';
import { builder, uuid } from '../../model/test-events';
import { renderRow, rowOf } from './test-support';

afterEach(cleanup);

const ANCHOR: Anchor = { kind: 'file-line', locator: '/repo/src/x.ts#L42', label: 'x.ts:42', path: '/repo/src/x.ts', line: 42 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBAGADWLC/WeCk2QAAAAAElFTkSuQmCC';
const PARENT = 'parent-app' as AppSessionId;

describe('the anchored prompt', () => {
  it('opens with a chip naming the line, which opens the file there; the bubble shows the comment and its screenshot, no framing', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    const text = anchoredMessage({ anchor: ANCHOR, text: 'Why twice?', destination: 'main', screenshot: true });
    b.emit('user.message', { messageUuid: uuid('u1'), content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text }], isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const { container, actions } = renderRow(rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user'));
    const chip = container.querySelector<HTMLButtonElement>('[data-chip="anchor"]')!;
    expect(chip.textContent).toBe('x.ts:42');
    expect(chip.getAttribute('data-anchor-kind')).toBe('file-line');
    fireEvent.click(chip);
    expect(actions.openFile).toHaveBeenCalledWith('/repo/src/x.ts', 42);
    const content = container.querySelector('[data-user-content]')!.textContent!;
    expect(content).toContain('Why twice?');
    expect(content).not.toContain('maws_anchor');
    expect(content).not.toContain('Comment on');
    expect(container.querySelectorAll('img.transcript-attachment-image')).toHaveLength(1);
  });

  it('an anchor with no path is a label, not a button', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    const anchor: Anchor = { kind: 'browser-element', locator: 'button#save', label: 'Save button', pageUrl: 'https://example.com' };
    b.emit('user.message', { messageUuid: uuid('u1'), content: anchoredMessage({ anchor, text: 'Make it blue', destination: 'thread', screenshot: false }), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const { container } = renderRow(rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user'));
    const chip = container.querySelector('[data-chip="anchor"]')!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Save button');
  });
});

describe('the side-thread row', () => {
  const row = (over: Partial<Extract<Row, { kind: 'side_thread' }>> = {}): Extract<Row, { kind: 'side_thread' }> => ({
    id: 'side:child' as never, turnId: null, at: '2026-10-06T10:00:00.000Z', kind: 'side_thread', childAppSessionId: 'child' as AppSessionId, label: 'x.ts:42', anchorKind: 'file-line', openedBy: 'comment', state: 'opened', text: null, turns: 0, ...over,
  });

  it('reads opened, then finished with its text and turn count, or ended with an error', () => {
    const { container, rerenderRow } = renderRow(row(), { storeKey: PARENT });
    const text = () => container.querySelector('.transcript-side-thread-text')!.textContent;
    expect(text()).toBe('Side thread on x.ts:42 opened');
    rerenderRow(row({ state: 'finished', text: 'Fixed the check.', turns: 1 }));
    expect(text()).toBe('Side thread on x.ts:42 finished: Fixed the check.');
    rerenderRow(row({ state: 'finished', text: 'Fixed the check.', turns: 3 }));
    expect(text()).toBe('Side thread on x.ts:42 finished (3 turns): Fixed the check.');
    rerenderRow(row({ state: 'failed', text: 'API error', turns: 1 }));
    expect(text()).toBe('Side thread on x.ts:42 ended with an error: API error');
    rerenderRow(row({ label: null, anchorKind: null, openedBy: 'btw' }));
    expect(text()).toBe('Side thread on Side question opened');
  });

  it('Open shows the thread in its parent’s Side pane', () => {
    const { actions } = renderRow(row(), { storeKey: PARENT });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openSideThread).toHaveBeenCalledWith(PARENT, 'child');
  });
});
