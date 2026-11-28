// E4a (Task 3.2): which renderer layers cover a placed pane (Design §3 "Which layers cover"; Decision Log 2), pinned
// against the real Radix components in happy-dom rather than hand-made wrappers: a Dialog covers while open; a Popover
// (whose content carries role="dialog" inside its popper wrapper) and a DropdownMenu cover only when the wrapper meets a
// pane; a Tooltip never; a bare body child follows the intersection rule; so does a toast over the pane. happy-dom lays
// nothing out, so each layer's rect is given by a `data-rect` marker inside it.
import { act, cleanup, render } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { Dialog, DropdownMenu, Popover, Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyLayer, watchCoverLayers, type CoverWatch, type PaneRect } from './cover';

const PANE: PaneRect = { x: 100, y: 100, width: 400, height: 300 };
const RECTS: Record<string, { left: number; top: number; right: number; bottom: number }> = {
  over: { left: 150, top: 150, right: 250, bottom: 250 },
  away: { left: 600, top: 0, right: 700, bottom: 50 },
  edge: { left: 500, top: 100, right: 560, bottom: 200 }, // touches the pane's right edge, no area in common
};

function rectFor(element: Element): DOMRect {
  const marked = element.matches('[data-rect]') ? element : element.querySelector('[data-rect]');
  const r = RECTS[marked?.getAttribute('data-rect') ?? ''] ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect;
}

// The app's root, where the shell (and its toast viewport) lives: never a layer itself.
function appRoot(): HTMLElement {
  const root = Object.assign(document.createElement('div'), { id: 'root' });
  root.setAttribute('data-test-layer', '');
  document.body.append(root);
  return root;
}

// Two animation frames (happy-dom runs a frame as an immediate) and the observers' microtasks.
const frames = async (n = 3) => {
  for (let i = 0; i < n; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

let changes: boolean[];
let watch: CoverWatch;
let panes: PaneRect[];
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectFor(this);
  });
  changes = [];
  panes = [PANE];
  watch = watchCoverLayers(() => panes, (covered) => changes.push(covered));
});
afterEach(() => {
  watch.unwatch();
  cleanup();
  document.body.querySelectorAll('[data-test-layer]').forEach((element) => element.remove());
  vi.restoreAllMocks();
});

const popover = (open: boolean, rect: string): ReactNode =>
  h(Popover.Root, { open }, h(Popover.Trigger, null, 'chip'), h(Popover.Portal, null, h(Popover.Content, { 'data-rect': rect } as object, 'popover body')));
const menu = (open: boolean, rect: string): ReactNode =>
  h(
    DropdownMenu.Root,
    { open, modal: false },
    h(DropdownMenu.Trigger, null, '+'),
    h(DropdownMenu.Portal, null, h(DropdownMenu.Content, { 'data-rect': rect } as object, h(DropdownMenu.Item, null, 'Browser'))),
  );

describe('watchCoverLayers', () => {
  it('a Dialog covers while it is open, wherever it is drawn', async () => {
    const dialog = (open: boolean) =>
      h(Dialog.Root, { open }, h(Dialog.Portal, null, h(Dialog.Overlay), h(Dialog.Content, { 'aria-describedby': undefined }, h(Dialog.Title, null, 'Rename'))));
    const { rerender } = render(dialog(true));
    await frames();
    expect(changes).toEqual([true]);
    rerender(dialog(false));
    await frames();
    expect(changes).toEqual([true, false]);
  });

  it('a Popover, role="dialog" inside its popper wrapper, covers only when its wrapper meets a pane', async () => {
    const { rerender } = render(popover(true, 'away'));
    await frames();
    expect(document.querySelector('[data-radix-popper-content-wrapper] [role="dialog"]')).not.toBeNull();
    expect(changes).toEqual([]);
    rerender(popover(false, 'away'));
    await frames();
    rerender(popover(true, 'over'));
    await frames();
    expect(changes).toEqual([true]);
    rerender(popover(false, 'over'));
    await frames();
    expect(changes).toEqual([true, false]);
  });

  it('a DropdownMenu likewise: over the pane it covers, beside it it does not', async () => {
    const { rerender } = render(menu(true, 'edge'));
    await frames();
    expect(changes).toEqual([]);
    rerender(menu(false, 'edge'));
    await frames();
    rerender(menu(true, 'over'));
    await frames();
    expect(changes).toEqual([true]);
  });

  it('a Tooltip never covers, even over the pane', async () => {
    render(
      h(
        Tooltip.Provider,
        null,
        h(Tooltip.Root, { open: true }, h(Tooltip.Trigger, null, 'Back'), h(Tooltip.Portal, null, h(Tooltip.Content, { 'data-rect': 'over' } as object, 'Back'))),
      ),
    );
    await frames();
    expect(document.querySelector('[data-radix-popper-content-wrapper] [role="tooltip"]')).not.toBeNull();
    expect(changes).toEqual([]);
  });

  it('a bare body child with no marker (the composer’s suggestion popup) follows the intersection rule', async () => {
    const away = Object.assign(document.createElement('div'), { className: 'popup' });
    away.setAttribute('data-test-layer', '');
    away.setAttribute('data-rect', 'away');
    document.body.append(away);
    await frames();
    expect(changes).toEqual([]);
    const over = document.createElement('div');
    over.setAttribute('data-test-layer', '');
    over.setAttribute('data-rect', 'over');
    document.body.append(over);
    await frames();
    expect(changes).toEqual([true]);
    over.remove();
    await frames();
    expect(changes).toEqual([true, false]);
  });

  it('the app root and Radix’s focus guards never cover', () => {
    const root = Object.assign(document.createElement('div'), { id: 'root' });
    const guard = document.createElement('span');
    guard.setAttribute('data-radix-focus-guard', '');
    expect(classifyLayer(root)).toBe('never');
    expect(classifyLayer(guard)).toBe('never');
  });

  it('a toast over the pane covers while it is shown; one elsewhere does not', async () => {
    const viewport = document.createElement('ol');
    viewport.setAttribute('data-toast-viewport', '');
    appRoot().append(viewport); // inside the shell, as in the app
    watch.refresh(); // found on the next refresh when it mounted after the watch began
    const elsewhere = document.createElement('li');
    elsewhere.setAttribute('data-rect', 'away');
    viewport.append(elsewhere);
    await frames();
    expect(changes).toEqual([]);
    const toast = document.createElement('li');
    toast.setAttribute('data-rect', 'over');
    viewport.append(toast);
    await frames();
    expect(changes).toEqual([true]);
    toast.remove();
    await frames();
    expect(changes).toEqual([true, false]);
  });

  it('the toast viewport unmounting while toasts are held and remounting as a new element is followed on refresh', async () => {
    const root = appRoot();
    const mount = (rect: string) => {
      const viewport = document.createElement('ol');
      viewport.setAttribute('data-toast-viewport', '');
      const toast = document.createElement('li');
      toast.setAttribute('data-rect', rect);
      viewport.append(toast);
      root.append(viewport);
      return viewport;
    };
    const first = mount('over');
    watch.refresh();
    await frames();
    expect(changes).toEqual([true]);
    first.remove(); // the host holds its toasts: the viewport and its toast leave together
    watch.refresh();
    expect(changes).toEqual([true, false]);
    mount('over'); // released: a new viewport element
    watch.refresh();
    await frames();
    expect(changes).toEqual([true, false, true]);
  });

  it('a pane moving under a layer already measured is re-checked on refresh', async () => {
    panes = [];
    render(popover(true, 'over'));
    await frames();
    expect(changes).toEqual([]);
    panes = [PANE];
    watch.refresh();
    expect(changes).toEqual([true]);
  });

  it('unwatch stops: no layer is heard after it', async () => {
    watch.unwatch();
    render(h(Dialog.Root, { open: true }, h(Dialog.Portal, null, h(Dialog.Content, { 'aria-describedby': undefined }, h(Dialog.Title, null, 'Rename')))));
    await frames();
    expect(changes).toEqual([]);
  });
});
