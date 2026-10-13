// P3-G (§D4.2): the overlay over the surface: the still, the drawing in the five inks with Pen, Box, Arrow and Text,
// Undo and Clear, Escape (outside a text field) discarding, Add to chat delivering.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CapturedImage } from '@shared/markup/image';
import { registerFocusTarget, resetComposerStore, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { MarkupLayer } from './MarkupLayer';
import { resetMarkup, startMarkup, useMarkup } from './session';
import { registerMarkupSurface, resetMarkupSurfaces } from './surface';

vi.mock('./composite', () => ({ compositeMarkup: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })) }));

const A = 'app-a' as AppSessionId;
const TAB = 'browser:1';
const still: CapturedImage = { mediaType: 'image/png', data: 'c3RpbGw=', width: 1600, height: 1000 };
let end: Mock<() => void>;

async function open(): Promise<void> {
  const element = document.body.appendChild(document.createElement('div'));
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 120, width: 800, height: 500, x: 300, y: 120, right: 1100, bottom: 620, toJSON: () => ({}) } as DOMRect);
  end = vi.fn<() => void>();
  registerMarkupSurface({ surface: 'panel', tabId: TAB }, { element: () => element, label: () => 'Page A', begin: async () => still, end });
  render(<MarkupLayer />);
  await act(() => startMarkup());
}

const canvas = () => document.querySelector<SVGSVGElement>('[data-markup-canvas]')!;
const paths = () => [...canvas().querySelectorAll('path')].map((p) => p.getAttribute('d'));
function drag(points: [number, number][]): void {
  const [first, ...rest] = points;
  fireEvent.pointerDown(canvas(), { clientX: first[0], clientY: first[1], pointerId: 1, button: 0 });
  for (const [x, y] of rest) fireEvent.pointerMove(canvas(), { clientX: x, clientY: y, pointerId: 1 });
  const [x, y] = points.at(-1)!;
  fireEvent.pointerUp(canvas(), { clientX: x, clientY: y, pointerId: 1 });
}

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetMarkup();
  resetMarkupSurfaces();
  useLayout.setState({ main: mainShowing(A), panelBySession: new Map([[A, { tabs: [{ id: TAB, toolId: 'browser', pinned: false }], activeTabId: TAB }]]) });
});
afterEach(() => {
  cleanup();
  resetMarkup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('MarkupLayer', () => {
  it('draws nothing without a session', () => {
    render(<MarkupLayer />);
    expect(screen.queryByRole('region', { name: 'Mark-up' })).toBeNull();
  });

  it('lays the still over the surface’s rect, with Pen and Red chosen and nothing to undo or clear', async () => {
    await open();
    const layer = screen.getByRole('region', { name: 'Mark-up' });
    expect(layer.style).toMatchObject({ left: '300px', top: '120px', width: '800px', height: '500px' });
    expect(layer.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,c3RpbGw=');
    expect(screen.getByRole('radio', { name: 'Pen' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Mark-up tool' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Ink colour' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Pen', 'Box', 'Arrow', 'Text', 'Red', 'Blue', 'Green', 'Black', 'White']);
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveProperty('disabled', true);
    expect(undo.getAttribute('title')).toBe('Nothing to undo yet');
    expect(screen.getByRole('button', { name: 'Clear' }).getAttribute('title')).toBe('Nothing to clear yet');
    expect(screen.getByRole('button', { name: 'Add to chat' })).toHaveProperty('disabled', false); // an unmarked still is a screenshot
  });

  it('draws a pen stroke in surface px, then a box in the ink chosen; Undo and Clear take them back', async () => {
    await open();
    drag([[310, 130], [320, 140], [330, 135]]);
    expect(paths()).toEqual(['M10 10L20 20L30 15']);
    await userEvent.click(screen.getByRole('radio', { name: 'Box' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    drag([[400, 200], [450, 260]]);
    expect(paths()).toEqual(['M10 10L20 20L30 15', 'M100 80H150V140H100Z']);
    expect(canvas().querySelectorAll('path')[1].getAttribute('stroke')).toBe('var(--markup-ink-blue)');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(paths()).toEqual(['M10 10L20 20L30 15']);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(paths()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty('disabled', true);
  });

  it('places text where clicked: Enter commits, Escape in the field cancels the field only', async () => {
    await open();
    await userEvent.click(screen.getByRole('radio', { name: 'Text' }));
    fireEvent.pointerDown(canvas(), { clientX: 340, clientY: 150, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas(), { clientX: 340, clientY: 150, pointerId: 1 });
    const field = await screen.findByRole('textbox', { name: 'Mark-up text' });
    await userEvent.type(field, 'Too tight{Enter}');
    const text = canvas().querySelector('text')!;
    expect(text.textContent).toBe('Too tight');
    expect([text.getAttribute('x'), text.getAttribute('y')]).toEqual(['40', '46']);
    fireEvent.pointerDown(canvas(), { clientX: 500, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas(), { clientX: 500, clientY: 300, pointerId: 1 });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Mark-up text' }), 'gone{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Mark-up text' })).toBeNull();
    expect(canvas().querySelectorAll('text')).toHaveLength(1);
    expect(useMarkup.getState().session).not.toBeNull();
  });

  it('Escape discards the drawing and ends, unfreezing the surface; nothing is attached', async () => {
    await open();
    drag([[310, 130], [320, 140]]);
    await userEvent.keyboard('{Escape}');
    expect(useMarkup.getState().session).toBeNull();
    expect(end).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Mark-up' })).toBeNull();
    expect(useComposerStore.getState().attachmentQueue.size).toBe(0);
  });

  it('Add to chat delivers the composite to the shown session and ends', async () => {
    await open();
    drag([[310, 130], [320, 140]]);
    await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
    await vi.waitFor(() => expect(useMarkup.getState().session).toBeNull());
    const [queued] = useComposerStore.getState().attachmentQueue.get(A) ?? [];
    expect(queued.text).toBe('Mark-up of Page A ');
    expect(queued.files.map((f) => [f.name, f.type, f.size])).toEqual([['mark-up.png', 'image/png', 3]]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('a composer that refuses (busy) leaves the overlay and its drawing, and Add to chat can be pressed again', async () => {
    let accepts = false;
    registerFocusTarget(A, { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn(), attachFiles: async () => accepts });
    await open();
    drag([[310, 130], [320, 140]]);
    const add = screen.getByRole('button', { name: 'Add to chat' });
    await userEvent.click(add);
    await vi.waitFor(() => expect(add).toHaveProperty('disabled', false));
    expect(useMarkup.getState().session).not.toBeNull();
    expect(paths()).toEqual(['M10 10L20 20']);
    expect(end).not.toHaveBeenCalled();
    accepts = true;
    await userEvent.click(add);
    await vi.waitFor(() => expect(useMarkup.getState().session).toBeNull());
    expect(end).toHaveBeenCalledTimes(1);
  });
});
