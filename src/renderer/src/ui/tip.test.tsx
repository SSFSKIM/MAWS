// A word's or a glyph's tooltip that the keyboard reaches (the word cut, rule 5): shown on pointing after the short
// delay and at once on keyboard focus, its words the owner's accessible description at rest; and a greyed control drawn
// `aria-disabled`, still focusable, with its reason as that tooltip.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { POINTING_DELAY_MS } from './pointing';
import { Tip, UnavailableButton } from './tip';

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
