// A word's or a glyph's tooltip that the keyboard reaches (the word cut, rule 5): shown on pointing after the short
// delay and at once on keyboard focus, its words the owner's accessible description at rest; and a greyed control drawn
// `aria-disabled`, still focusable, with its reason as that tooltip.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { POINTING_DELAY_MS } from './pointing';
import { Popover, RadioGroup } from 'radix-ui';
import { Tip, tipBoundaryOf, TipsAbove, UnavailableButton } from './tip';

const FACT = 'MAWS falls back to a dock bounce and a toast';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;

function Chip() {
  return (
    <p data-testid="line">
      <Tip content={FACT} description={FACT}>
        <span tabIndex={0}>Blocked in macOS</span>
      </Tip>
    </p>
  );
}

describe('Tip', () => {
  it('is absent from the resting text, and its words are the owner’s description at rest', () => {
    render(<Chip />);
    expect(tooltip()).toBeNull();
    expect(accessibleText(screen.getByTestId('line'))).toBe('Blocked in macOS');
    const chip = screen.getByText('Blocked in macOS');
    expect(document.getElementById(chip.getAttribute('aria-describedby') ?? '')?.textContent).toBe(FACT);
  });

  it('shows on pointing after the short delay', async () => {
    render(<Chip />);
    await user().hover(screen.getByText('Blocked in macOS'));
    wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    wait(1);
    expect(tooltip()).toBe(FACT);
  });

  it('shows at once on keyboard focus, and closes on Escape and when focus leaves', async () => {
    render(
      <>
        <Chip />
        <button type="button">After</button>
      </>,
    );
    const keys = user();
    await keys.tab();
    expect(tooltip()).toBe(FACT);
    await keys.keyboard('{Escape}');
    expect(tooltip()).toBeNull();
    await keys.tab();
    await keys.tab({ shift: true });
    expect(tooltip()).toBe(FACT);
    await keys.tab();
    expect(tooltip()).toBeNull();
  });
});

// Where the tip opens (jsdom lays nothing out, so no collision moves it): above its owner, the app's side, unless the
// owner names another (an owner whose explanation stands above it, a caption or a heading, names below).
describe('Tip placement', () => {
  const side = () => document.querySelector('[data-radix-popper-content-wrapper] [data-side]')?.getAttribute('data-side');
  it('opens above its owner by default', async () => {
    render(<Chip />);
    await user().tab();
    expect(tooltip()).toBe(FACT);
    expect(side()).toBe('top');
  });

  it('opens on the side its owner names', async () => {
    render(
      <Tip content={FACT} side="bottom">
        <span tabIndex={0}>Blocked in macOS</span>
      </Tip>,
    );
    await user().tab();
    expect(tooltip()).toBe(FACT);
    expect(side()).toBe('bottom');
  });
});

describe('Tip under the keyboard', () => {
  it('stays open through the scroll its owner’s focus causes', async () => {
    render(
      <div data-testid="scroller">
        <Chip />
      </div>,
    );
    await user().tab();
    expect(tooltip()).toBe(FACT);
    fireEvent.scroll(screen.getByTestId('scroller')); // Chromium scrolls an offscreen owner into view as it takes focus
    expect(tooltip()).toBe(FACT);
  });

  it('closes when its owner is activated from the keyboard and keeps focus', async () => {
    function Disclosure() {
      const [open, setOpen] = useState(false);
      return (
        <Tip content="Device id and fingerprint">
          <button type="button" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            Details
          </button>
        </Tip>
      );
    }
    render(<Disclosure />);
    const keys = user();
    await keys.tab();
    expect(tooltip()).toBe('Device id and fingerprint');
    await keys.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Details', expanded: true })).toBe(document.activeElement);
    expect(tooltip()).toBeNull();
    await keys.tab({ shift: true }); // away and back: focus opens it again
    await keys.tab();
    expect(tooltip()).toBe('Device id and fingerprint');
    await keys.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Details', expanded: false })).toBe(document.activeElement);
    expect(tooltip()).toBeNull();
  });

  it('is not reopened by a pointing still in its delay once Escape has dismissed it', async () => {
    render(<Chip />);
    const keys = user();
    await keys.hover(screen.getByText('Blocked in macOS'));
    wait(POINTING_DELAY_MS / 3);
    await keys.tab(); // focus opens it before the pointing's delay has run
    expect(tooltip()).toBe(FACT);
    await keys.keyboard('{Escape}');
    expect(tooltip()).toBeNull();
    wait(POINTING_DELAY_MS * 2);
    expect(tooltip()).toBeNull();
  });
});

// Task 2 fix round 1 (T105): a fact about a whole line shows on pointing anywhere along it, while the keyboard reaches it
// on the one word that owns it, and the line's own controls stay controls of their own
describe('Tip pointed within a region', () => {
  function Line() {
    const line = useRef<HTMLDivElement>(null);
    return (
      <>
        <div ref={line} data-testid="line">
          <Tip content={FACT} description={FACT} pointedWithin={line}>
            <span tabIndex={0}>Blocked in macOS</span>
          </Tip>
          <button type="button">Open tab</button>
        </div>
        <button type="button">After</button>
      </>
    );
  }
  const action = () => screen.getByRole('button', { name: 'Open tab' });

  it('shows on pointing anywhere in the region after the delay, stays while the pointer crosses it, and closes when it leaves', async () => {
    render(<Line />);
    const keys = user();
    await keys.hover(action());
    wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    wait(1);
    expect(tooltip()).toBe(FACT);
    await keys.hover(screen.getByText('Blocked in macOS'));
    expect(tooltip()).toBe(FACT); // crossing the region's children keeps it, at once
    await keys.hover(action());
    expect(tooltip()).toBe(FACT);
    await keys.hover(screen.getByRole('tooltip')); // the tip stays hoverable (WCAG 1.4.13)
    expect(tooltip()).toBe(FACT);
    await keys.hover(action());
    await keys.hover(screen.getByRole('button', { name: 'After' }));
    expect(tooltip()).toBeNull();
  });

  it('keeps the keyboard on its owner alone: the region’s controls are neither its trigger nor described by it', async () => {
    render(<Line />);
    expect(action().hasAttribute('aria-describedby')).toBe(false);
    expect(action().hasAttribute('data-state')).toBe(false); // Radix marks its trigger
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(screen.getByText('Blocked in macOS'));
    expect(tooltip()).toBe(FACT);
    await keys.tab();
    expect(document.activeElement).toBe(action());
    expect(tooltip()).toBeNull();
  });

  it('closes on a press of the region’s control, and a pointing still in its delay is dropped by it', async () => {
    render(<Line />);
    const keys = user();
    await keys.hover(action());
    wait(POINTING_DELAY_MS);
    expect(tooltip()).toBe(FACT);
    await keys.click(action());
    expect(tooltip()).toBeNull();
    await keys.unhover(action());
    await keys.hover(action());
    wait(POINTING_DELAY_MS / 2);
    await keys.click(action());
    wait(POINTING_DELAY_MS * 2);
    expect(tooltip()).toBeNull();
  });
});

describe('Tip without a description of its own', () => {
  it('leaves its owner described by the open tooltip on focus', async () => {
    render(
      <Tip content={FACT}>
        <span tabIndex={0}>Blocked in macOS</span>
      </Tip>,
    );
    const chip = screen.getByText('Blocked in macOS');
    expect(chip.hasAttribute('aria-describedby')).toBe(false);
    await user().tab();
    expect(tooltip()).toBe(FACT);
    expect(chip.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });
});

describe('UnavailableButton', () => {
  it('leaves an available control as it is', () => {
    render(
      <UnavailableButton reason={null}>
        <button type="button">Commit</button>
      </UnavailableButton>,
    );
    const button = screen.getByRole('button', { name: 'Commit' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps the focused control itself as its reason comes and goes, describing it at once and showing it on the next focus', async () => {
    const Commit = ({ reason }: { reason: string | null }) => (
      <UnavailableButton reason={reason}>
        <button type="button">Commit</button>
      </UnavailableButton>
    );
    const view = render(<Commit reason={null} />);
    const button = screen.getByRole('button', { name: 'Commit' });
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(button);
    expect(tooltip()).toBeNull();
    view.rerender(<Commit reason="Write a commit message" />);
    expect(screen.getByRole('button', { name: 'Commit', description: 'Write a commit message' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(tooltip()).toBeNull(); // in the description at once; the tooltip waits for the next pointing or focus
    await keys.tab();
    await keys.tab({ shift: true });
    expect(document.activeElement).toBe(button);
    expect(tooltip()).toBe('Write a commit message');
    view.rerender(<Commit reason={null} />);
    expect(screen.getByRole('button', { name: 'Commit' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(tooltip()).toBeNull();
  });

  it('stays closed for a reason that arrives after the pointer has rested on the control and left', async () => {
    const Commit = ({ reason }: { reason: string | null }) => (
      <UnavailableButton reason={reason}>
        <button type="button">Commit</button>
      </UnavailableButton>
    );
    const view = render(<Commit reason={null} />);
    const pointer = user();
    await pointer.hover(screen.getByRole('button', { name: 'Commit' }));
    wait(POINTING_DELAY_MS * 2);
    await pointer.unhover(screen.getByRole('button', { name: 'Commit' }));
    view.rerender(<Commit reason="Still busy" />);
    wait(POINTING_DELAY_MS * 2);
    expect(screen.getByRole('button', { name: 'Commit', description: 'Still busy' })).toBeTruthy();
    expect(tooltip()).toBeNull();
  });

  it('drops a pointing still in its delay when the reason goes away, and a later reason waits for new pointing', async () => {
    const tips = () => screen.queryAllByRole('tooltip').map((tip) => tip.textContent);
    const Pair = ({ reason }: { reason: string | null }) => (
      <>
        <Chip />
        <UnavailableButton reason={reason}>
          <button type="button">Commit</button>
        </UnavailableButton>
      </>
    );
    const view = render(<Pair reason="Still busy" />);
    const keys = user();
    await keys.tab(); // the chip's tooltip opens on focus
    expect(tips()).toEqual([FACT]);
    await keys.hover(screen.getByRole('button', { name: 'Commit' }));
    wait(POINTING_DELAY_MS / 2);
    view.rerender(<Pair reason={null} />); // cleared before the delay has run
    wait(POINTING_DELAY_MS * 2);
    expect(tips()).toEqual([FACT]);
    view.rerender(<Pair reason="Still busy" />); // back, with no new pointing or focus
    wait(POINTING_DELAY_MS * 2);
    expect(tips()).toEqual([FACT]);
    await keys.unhover(screen.getByRole('button', { name: 'Commit' }));
    await keys.hover(screen.getByRole('button', { name: 'Commit' })); // new pointing
    wait(POINTING_DELAY_MS);
    expect(tips()).toEqual(['Still busy']); // one tip at a time
  });

  it('pointing at an available control leaves another control’s open tooltip open', async () => {
    render(
      <>
        <Chip />
        <UnavailableButton reason={null}>
          <button type="button">Commit</button>
        </UnavailableButton>
      </>,
    );
    const keys = user();
    await keys.tab(); // the chip's tooltip opens on focus
    expect(tooltip()).toBe(FACT);
    await keys.hover(screen.getByRole('button', { name: 'Commit' }));
    wait(POINTING_DELAY_MS * 2);
    expect(document.activeElement).toBe(screen.getByText('Blocked in macOS'));
    expect(tooltip()).toBe(FACT);
  });

  it('stays closed for a reason that arrives after focus has left the control', async () => {
    const Commit = ({ reason }: { reason: string | null }) => (
      <>
        <UnavailableButton reason={reason}>
          <button type="button">Commit</button>
        </UnavailableButton>
        <button type="button">After</button>
      </>
    );
    const view = render(<Commit reason={null} />);
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Commit' }));
    await keys.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    view.rerender(<Commit reason="Still busy" />);
    expect(screen.getByRole('button', { name: 'Commit', description: 'Still busy' })).toBeTruthy();
    expect(tooltip()).toBeNull();
  });

  it('keeps a greyed control in the Tab order, says why on pointing, and swallows its click', async () => {
    const commit = vi.fn();
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
        <UnavailableButton reason="Write a commit message">
          <button type="submit" onClick={commit}>
            Commit
          </button>
        </UnavailableButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Commit', description: 'Write a commit message' });
    const keys = user();
    await keys.hover(button);
    wait(POINTING_DELAY_MS);
    expect(tooltip()).toBe('Write a commit message');
    await keys.click(button);
    expect(commit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

// The medium review: a `TipBoundary`'s tips keep to what can be seen of its element, the element cut by its nearest
// scrolling ancestor (a page in a side panel's group, whose lower edge is the group's, not the page's).
describe('a tip boundary', () => {
  it('is the element’s nearest scrolling ancestor and the element itself', () => {
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowY = 'auto';
    const page = scroller.appendChild(document.createElement('div')).appendChild(document.createElement('div'));
    expect(tipBoundaryOf(page)).toEqual([scroller, page]);
    const alone = document.body.appendChild(document.createElement('div'));
    expect(tipBoundaryOf(alone)).toEqual([alone]);
    expect(tipBoundaryOf(null)).toEqual([]);
    scroller.remove();
    alone.remove();
  });
});

// The xhigh panel (scalpel-2#1): Radix's Tooltip puts its own `data-state` on its trigger, which an owner that is
// itself a Radix control (a radio item, a popover's or a menu's trigger) would draw over its own state with.
describe('a tip over a Radix control', () => {
  it('keeps a radio item’s checked state and a popover trigger’s open state, through pointing and focus', async () => {
    render(
      <>
        <RadioGroup.Root aria-label="Tool" defaultValue="pen">
          <Tip content="Pen">
            <RadioGroup.Item value="pen" aria-label="Pen" />
          </Tip>
          <Tip content="Box">
            <RadioGroup.Item value="box" aria-label="Box" />
          </Tip>
        </RadioGroup.Root>
        <Popover.Root defaultOpen>
          <Tip content="Where it runs">
            <Popover.Trigger>Location</Popover.Trigger>
          </Tip>
          <Popover.Portal>
            <Popover.Content>Folders</Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </>,
    );
    const states = () => [screen.getByRole('radio', { name: 'Pen' }), screen.getByRole('radio', { name: 'Box' }), screen.getByRole('button', { name: 'Location' })].map((element) => element.getAttribute('data-state'));
    expect(states()).toEqual(['checked', 'unchecked', 'open']);
    await user().hover(screen.getByRole('radio', { name: 'Pen' }));
    wait(POINTING_DELAY_MS);
    expect(tooltip()).toBe('Pen');
    expect(states()).toEqual(['checked', 'unchecked', 'open']);
    act(() => screen.getByRole('button', { name: 'Location' }).focus());
    expect(tooltip()).toBe('Where it runs');
    expect(states()).toEqual(['checked', 'unchecked', 'open']);
  });

  it('still marks a plain owner with the tip’s state, as before', () => {
    render(
      <Tip content={FACT}>
        <button type="button">Blocked</button>
      </Tip>,
    );
    expect(screen.getByRole('button', { name: 'Blocked' }).getAttribute('data-state')).toBe('closed');
  });
});

// The medium review of fix wave 1: a tip over what lies below it must not cover it (the browser chrome over its live
// page, a native view the renderer cannot draw over: covering the page for a passive tip would take its focus).
describe('tips held above', () => {
  it('open above their owner inside TipsAbove, whatever side the owner names, and on the named side outside it', async () => {
    render(
      <>
        <TipsAbove>
          <Tip content="Inside" side="bottom">
            <button type="button">In</button>
          </Tip>
        </TipsAbove>
        <Tip content="Outside" side="bottom">
          <button type="button">Out</button>
        </Tip>
      </>,
    );
    const sideOf = () => screen.getByRole('tooltip').closest('[data-side]')?.getAttribute('data-side');
    act(() => screen.getByRole('button', { name: 'In' }).focus());
    expect([tooltip(), sideOf()]).toEqual(['Inside', 'top']);
    act(() => screen.getByRole('button', { name: 'Out' }).focus());
    expect([tooltip(), sideOf()]).toEqual(['Outside', 'bottom']);
  });
});
