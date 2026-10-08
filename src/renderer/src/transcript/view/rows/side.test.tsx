// E3 (M3): the anchored prompt's chip and the side-thread row on screen (E3 execution document, Design §6): the chip
// names what the comment is about and opens a file anchor at its line; the bubble shows the comment alone with its
// screenshot; the row reads opened, finished with the turn count, or failed, and its Open shows the thread in the
// parent's Side pane.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { rowsOf } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import type { Row } from '../../model/rows';
import { builder, uuid } from '../../model/test-events';
import { serializeRows } from '../../model/serialize';
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

  it('Copy and the markdown export keep what the chip names: the anchor in words, then the comment (scale-review C scalpel-2#2)', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: anchoredMessage({ anchor: ANCHOR, text: 'Why so wide?', destination: 'thread', screenshot: false }), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const row = rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
    const words = 'Comment on "x.ts:42" (file /repo/src/x.ts, line 42):\nWhy so wide?';
    renderRow(row);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(words);
    expect(serializeRows([row])).toBe(`**You**\n\n${words}`);
  });

  it('an anchor with no path is a label, not a button', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    // E4d: a page element's anchor opens its page now (below); an artifact's has no opener yet (E2's later wave)
    const anchor: Anchor = { kind: 'artifact-element', locator: 'button#save', label: 'Save button', pageUrl: 'https://example.com' };
    b.emit('user.message', { messageUuid: uuid('u1'), content: anchoredMessage({ anchor, text: 'Make it blue', destination: 'thread', screenshot: false }), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const { container } = renderRow(rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user'));
    const chip = container.querySelector('[data-chip="anchor"]')!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Save button');
  });

  // E4d start: a page element's chip opens the page in the in-app browser (E4d execution document, Design §10)
  const browserAnchorRow = (anchor: Anchor) => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text: anchoredMessage({ anchor, text: 'Make this primary', destination: 'thread', screenshot: true }) }], isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    return rowOf(rowsOf(applyEvents(createState(null, null), b.events)), 'user');
  };
  const PAGE: Anchor = {
    kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: 'http://127.0.0.1:4000/comment.html',
    css: '#increment', role: 'button', name: 'Increment', a11y: 'main > region “A form” > button “Increment”', box: { x: 248, y: 312, width: 96, height: 30 },
  };

  it('a page element’s chip is a button that opens its page for the row’s session; the picture draws beside it', () => {
    const { container, actions } = renderRow(browserAnchorRow(PAGE), { storeKey: PARENT });
    const chip = container.querySelector<HTMLButtonElement>('[data-chip="anchor"]')!;
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('data-anchor-kind')).toBe('browser-element');
    expect(chip.textContent).toBe('button “Increment”');
    expect(chip.getAttribute('title')).toBe('#increment');
    fireEvent.click(chip);
    expect(actions.openBrowserUrl).toHaveBeenCalledWith(PARENT, 'http://127.0.0.1:4000/comment.html');
    expect(actions.openFile).not.toHaveBeenCalled();
    expect(container.querySelectorAll('img.transcript-attachment-image')).toHaveLength(1);
  });

  it('a page element’s chip without a page URL, or outside a session’s transcript, stays a label', () => {
    const noPage: Anchor = { ...PAGE };
    delete noPage.pageUrl;
    expect(renderRow(browserAnchorRow(noPage), { storeKey: PARENT }).container.querySelector('[data-chip="anchor"]')!.tagName).toBe('SPAN');
    cleanup();
    expect(renderRow(browserAnchorRow(PAGE)).container.querySelector('[data-chip="anchor"]')!.tagName).toBe('SPAN');
  });
  // E4d end
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
