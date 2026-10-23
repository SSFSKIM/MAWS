// P3-G (§D4.2): the overlay over the surface: the still, the drawing in the five inks with Pen, Box, Arrow and Text,
// Undo and Clear, Escape (outside a text field) discarding, Add to chat delivering.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DropdownMenu } from 'radix-ui';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CapturedImage } from '@shared/markup/image';
import { registerFocusTarget, resetComposerStore, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { installResizeObserver } from '../test-support/resize';
import { MarkupLayer } from './MarkupLayer';
import { resetMarkup, startMarkup, useMarkup } from './session';
import { registerMarkupSurface, resetMarkupSurfaces } from './surface';

vi.mock('./composite', () => ({ compositeMarkup: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })) }));

const A = 'app-a' as AppSessionId;
const TAB = 'browser:1';
const still: CapturedImage = { mediaType: 'image/png', data: 'c3RpbGw=', width: 1600, height: 1000 };
let end: Mock<() => void>;

// `live`: what the surface holds under the still (the DOM route's body, an editor in it); `element`: a surface already
// laid out in the test's own shell
async function open(live?: (element: HTMLElement) => void, element: HTMLElement = document.body.appendChild(document.createElement('div'))): Promise<void> {
  live?.(element);
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
  vi.unstubAllGlobals();
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

  it('moves the toolbar without drawing and keeps it inside the annotation surface', async () => {
    await open();
    const toolbar = document.querySelector<HTMLElement>('[data-markup-toolbar]')!;
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue({ left: 450, top: 560, width: 500, height: 40 } as DOMRect);
    const handle = screen.getByRole('button', { name: 'Move mark-up toolbar' });
    fireEvent.pointerDown(handle, { clientX: 460, clientY: 570, pointerId: 9, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 410, clientY: 270, pointerId: 9 });
    fireEvent.pointerUp(handle, { pointerId: 9 });
    expect(toolbar.style.left).toBe('100px');
    expect(toolbar.style.top).toBe('140px');
    expect(paths()).toEqual([]);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(toolbar.style.top).toBe('130px');
    fireEvent.pointerDown(handle, { clientX: 460, clientY: 570, pointerId: 10, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 10000, clientY: -10000, pointerId: 10 });
    fireEvent.pointerUp(handle, { pointerId: 10 });
    expect(toolbar.style.left).toBe('292px');
    expect(toolbar.style.top).toBe('8px');
  });

  it.each(['keyboard', 'pointer'] as const)('starts %s movement from the displayed toolbar position after its surface shrinks', async (input) => {
    const { resize } = installResizeObserver();
    const surface = document.body.appendChild(document.createElement('div'));
    await open(undefined, surface);
    let width = 800;
    let height = 500;
    vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => ({ left: 300, top: 120, width, height }) as DOMRect);
    const toolbar = document.querySelector<HTMLElement>('[data-markup-toolbar]')!;
    vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => ({
      left: 300 + (Number.parseFloat(toolbar.style.left) || 200),
      top: 120 + (Number.parseFloat(toolbar.style.top) || 440), width: 200, height: 40,
    }) as DOMRect);
    const grip = screen.getByRole('button', { name: 'Move mark-up toolbar' });
    for (let i = 0; i < 40; i++) fireEvent.keyDown(grip, { key: 'ArrowRight' });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(toolbar.style).toMatchObject({ left: '592px', top: '452px' });
    width = 600;
    height = 300;
    resize(surface, { width, height });
    await waitFor(() => expect(toolbar.style).toMatchObject({ left: '392px', top: '252px' }));
    if (input === 'keyboard') {
      fireEvent.keyDown(grip, { key: 'ArrowLeft' });
      fireEvent.keyDown(grip, { key: 'ArrowUp' });
    } else {
      fireEvent.pointerDown(grip, { clientX: 700, clientY: 380, pointerId: 9, button: 0 });
      fireEvent.pointerMove(grip, { clientX: 690, clientY: 370, pointerId: 9 });
      fireEvent.pointerUp(grip, { pointerId: 9 });
    }
    expect(toolbar.style).toMatchObject({ left: '382px', top: '242px' });
    expect(paths()).toEqual([]);
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

  // P3-F (F-shell, scalpel-4#1): the panel header's menus stay usable during a session (the overlay covers the surface
  // only). An Escape the open menu answers closes the menu; the marks stay. One nothing answers still discards.
  it('Escape with a menu open closes the menu and keeps the marks; the next Escape discards', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>More actions</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item>Export</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>,
    );
    await open();
    drag([[310, 130], [320, 140]]);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useMarkup.getState().session).not.toBeNull();
    expect(paths()).toEqual(['M10 10L20 20']);
    expect(end).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(useMarkup.getState().session).toBeNull();
    expect(end).toHaveBeenCalledTimes(1);
  });

  // P3-F (F-shell, scalpel-4#2): the live surface is under the still; the keyboard never reaches it from the overlay
  it('Tab and Shift+Tab stay inside the overlay, never reaching an editor under the still', async () => {
    const user = userEvent.setup();
    await open((element) => {
      const editor = element.appendChild(document.createElement('div'));
      editor.contentEditable = 'true';
      editor.setAttribute('aria-label', 'Live editor');
    });
    const layer = screen.getByRole('region', { name: 'Mark-up' });
    const add = screen.getByRole('button', { name: 'Add to chat' });
    expect(document.activeElement).toBe(layer);
    await user.tab({ shift: true });
    expect(document.activeElement, 'from the overlay itself, to its last control').toBe(add);
    await user.tab();
    expect(document.activeElement, 'from the last control, round to the first').toBe(screen.getByRole('button', { name: 'Move mark-up toolbar' }));
    await user.tab({ shift: true });
    expect(document.activeElement, 'from the first control, round to the last').toBe(add);
    expect(layer.contains(document.activeElement)).toBe(true);
  });

  // tech debt (L257): the trap covers only keys pressed inside the overlay; focus that leaves it another way (a header
  // menu closed with Escape gives the keyboard back to its trigger) must not be one Tab from hidden live content, so the
  // covered surface and the card layers over its region are inert for the session's life
  describe('what the overlay covers', () => {
    // a panel region holding a header menu, the surface (a live editor in it) and a card's layer over it (its composer);
    // beside it a main region's card layer and the toasts' viewport, which the overlay does not cover
    function shell() {
      const surface = { current: null as HTMLDivElement | null };
      render(
        <>
          <section data-region="panel">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>More actions</DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  <DropdownMenu.Item>Export</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div ref={surface} data-testid="surface">
              <div contentEditable suppressContentEditableWarning aria-label="Live editor" />
            </div>
            <div data-markup-occluder="" data-testid="card layer">
              <textarea aria-label="Card composer" />
            </div>
          </section>
          <section data-region="main">
            <div data-markup-occluder="" data-testid="main card layer" />
          </section>
          <ol data-toast-viewport="" data-markup-occluder="" data-testid="toasts" />
        </>,
      );
      return surface.current!;
    }
    const inert = (id: string) => screen.getByTestId(id).hasAttribute('inert');

    it('marks the surface and the card layer over it inert for the session’s life, and nothing the overlay leaves uncovered', async () => {
      const surface = shell();
      await open(undefined, surface);
      expect(['surface', 'card layer', 'main card layer', 'toasts'].map(inert)).toEqual([true, true, false, false]);
      await userEvent.keyboard('{Escape}');
      expect(useMarkup.getState().session).toBeNull();
      expect(['surface', 'card layer'].map(inert)).toEqual([false, false]);
    });

    it('Tab from the panel header after a closed menu never reaches the surface or the card’s composer', async () => {
      const user = userEvent.setup();
      const surface = shell();
      await open(undefined, surface);
      drag([[310, 130], [320, 140]]);
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.keyboard('{Escape}'); // the menu's: it closes, the keyboard back on its trigger, the marks kept
      expect(useMarkup.getState().session).not.toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions' }));
      await user.tab();
      await user.tab();
      expect(surface.contains(document.activeElement), 'the live editor under the still').toBe(false);
      expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Card composer' }));
    });

    it('Add to chat gives the keyboard to a composer in the card layer once the layer is live again', async () => {
      const surface = shell();
      const composer = screen.getByRole('textbox', { name: 'Card composer' });
      registerFocusTarget(A, { focusEditor: () => composer.focus(), focusFrame: vi.fn(), insertText: vi.fn(), attachFiles: async () => true });
      await open(undefined, surface);
      await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
      await vi.waitFor(() => expect(useMarkup.getState().session).toBeNull());
      expect(document.activeElement).toBe(composer);
    });
  });

  // P3-F (F-shell, scalpel-4#4): no composer mounted (the card closed to its pill), the picture is queued and the
  // keyboard goes back where it was, not to the body with the overlay gone
  it('Add to chat that queues the picture gives the keyboard back where it was', async () => {
    const before = document.body.appendChild(document.createElement('button'));
    before.textContent = 'Mark up';
    before.focus();
    await open();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Mark-up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
    await vi.waitFor(() => expect(useMarkup.getState().session).toBeNull());
    expect(useComposerStore.getState().attachmentQueue.get(A)).toHaveLength(1);
    expect(document.activeElement).toBe(before);
  });
});
