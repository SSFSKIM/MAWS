// Review's toolbar (UX wave U5b, M3; the execution document's §F and card 1 at its default): the totals without the
// scope's name, the unsent-comments chip's place, Collapse all, the hunk counter with its arrows and the View menu, on
// one line when they fit and otherwise wrapped by measure. happy-dom lays nothing out: the widths are stubbed through
// the stack's one seam.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../test-support/resize';
import { reviewLayout } from './measure';
import { Toolbar, totalsWords } from './Toolbar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// The parts' natural widths and the toolbar's room, by the first selector an element matches.
function widths(table: Record<string, number>): void {
  vi.spyOn(reviewLayout, 'width').mockImplementation((element) => {
    for (const [selector, width] of Object.entries(table)) if (element.matches(selector)) return width;
    return 0;
  });
}
const PARTS = {
  '[data-review-header]': 200, // "12 files changed · +340 −120"
  '[data-review-toolbar-chip]': 130, // "2 unsent comments"
  '[data-review-collapse]': 80,
  '[data-review-hunk]': 130,
  '[data-review-counter="long"]': 130, // "Showing hunk 3 of 41"
  '[data-review-counter="short"]': 50, // "3 of 41"
  '[data-review-nav]': 250, // the counter, ↑, ↓ and View
};

const props = (over: Partial<ComponentProps<typeof Toolbar>> = {}): ComponentProps<typeof Toolbar> => ({
  totals: totalsWords({ files: 12, added: 340, removed: 120 }),
  allFolded: false,
  onFoldAll: () => {},
  counter: { index: 2, count: 41 },
  onHunk: () => {},
  mode: 'unified',
  splitRoom: true,
  onMode: () => {},
  wrap: false,
  onWrap: () => {},
  ...over,
});
const chip = <span>2 unsent comments</span>;
const lines = () => document.querySelector<HTMLElement>('[data-review-toolbar]')!.dataset.lines;
const counter = () => document.querySelector('[data-review-hunk]')?.textContent ?? null;

describe('the totals (card 1: the pressed chip names the scope)', () => {
  it('say the files and the lines, with the locale’s separator, and not the scope', () => {
    expect(totalsWords({ files: 12, added: 340, removed: 120 })).toBe('12 files changed · +340 −120');
    expect(totalsWords({ files: 1, added: 21530, removed: 4210 })).toBe('1 file changed · +21,530 −4,210');
  });
});

describe('the toolbar’s lines', () => {
  it('is one line when its parts fit', () => {
    widths({ '[data-review-toolbar]': 720, ...PARTS });
    render(<Toolbar {...props({ chip })} />);
    expect(lines()).toBe('1');
    expect(counter()).toBe('Showing hunk 3 of 41');
  });

  it('otherwise puts the totals on the first line and the controls on the next, the chip beside the totals while it fits there', () => {
    widths({ '[data-review-toolbar]': 360, ...PARTS });
    render(<Toolbar {...props({ chip })} />);
    expect(lines()).toBe('2');
    expect(counter()).toBe('Showing hunk 3 of 41');
  });

  it('gives the chip a line of its own when it does not fit beside the totals', () => {
    widths({ '[data-review-toolbar]': 300, ...PARTS });
    render(<Toolbar {...props({ chip })} />);
    expect(lines()).toBe('3');
  });

  it('shortens the counter last, to “n of m”, where “Showing hunk n of m” does not fit the controls’ line', () => {
    widths({ '[data-review-toolbar]': 280, ...PARTS });
    render(<Toolbar {...props()} />);
    expect(lines()).toBe('2');
    expect(counter()).toBe('3 of 41');
  });

  it('measures its room inside its padding and border', () => {
    const { resize } = installResizeObserver();
    widths({ '[data-review-toolbar]': 546, ...PARTS }); // the parts' one line exactly: 200 + 8 + 80 + 8 + 250
    render(<Toolbar {...props()} />);
    expect(lines()).toBe('1');
    const root = document.querySelector<HTMLElement>('[data-review-toolbar]')!;
    root.style.padding = '0 11px';
    root.style.borderLeft = '1px solid';
    root.style.borderRight = '1px solid';
    resize(root, { width: 522, height: 30 });
    expect(lines()).toBe('2'); // 24 px of the box are not room
  });

  it('is one line when nothing is laid out yet', () => {
    render(<Toolbar {...props({ chip })} />);
    expect(lines()).toBe('1');
  });
});

describe('the toolbar’s controls', () => {
  it('draws no counter and no arrows while no file is loaded', () => {
    render(<Toolbar {...props({ counter: null })} />);
    expect(counter()).toBeNull();
    expect(screen.queryByLabelText('Previous hunk')).toBeNull();
    expect(screen.queryByLabelText('Next hunk')).toBeNull();
  });

  it('reads Collapse all, or Expand all while every file is folded', () => {
    const onFoldAll = vi.fn();
    const { rerender } = render(<Toolbar {...props({ onFoldAll })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    rerender(<Toolbar {...props({ onFoldAll, allFolded: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(onFoldAll).toHaveBeenCalledTimes(2);
  });

  it('moves the counter with ↑ and ↓, each disabled at its end', () => {
    const onHunk = vi.fn();
    const { rerender } = render(<Toolbar {...props({ onHunk, counter: { index: 0, count: 2 } })} />);
    expect(screen.getByLabelText('Previous hunk')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(onHunk).toHaveBeenLastCalledWith(1);
    rerender(<Toolbar {...props({ onHunk, counter: { index: 1, count: 2 } })} />);
    expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('Previous hunk'));
    expect(onHunk).toHaveBeenLastCalledWith(0);
  });

  it('holds Unified, Split and Wrap in one View menu; Split is disabled with its reason where the stack lacks the room', async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    const onWrap = vi.fn();
    const { rerender } = render(<Toolbar {...props({ onMode, onWrap })} />);
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect((await screen.findAllByRole('menuitemradio')).map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Unified', 'true'],
      ['Split', 'false'],
    ]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Split' }));
    expect(onMode).toHaveBeenCalledWith('split');
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Wrap' }));
    expect(onWrap).toHaveBeenCalledTimes(1);
    rerender(<Toolbar {...props({ onMode, onWrap, mode: 'split', splitRoom: false })} />);
    await user.click(screen.getByRole('button', { name: 'View' }));
    const split = await screen.findByRole('menuitemradio', { name: 'Split' });
    expect([split.getAttribute('aria-disabled'), split.title, split.getAttribute('aria-checked')]).toEqual(['true', 'Split needs a wider column', 'false']);
    expect(screen.getByRole('menuitemradio', { name: 'Unified' }).getAttribute('aria-checked')).toBe('true'); // what is drawn
  });
});
