// A word's or a glyph's tooltip that the keyboard reaches (the word cut, rule 5): shown on pointing after the short
// delay and at once on keyboard focus, its words the owner's accessible description at rest; and a greyed control drawn
// `aria-disabled`, still focusable, with its reason as that tooltip.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnText } from '../test-support/drawn-text';
import { POINTING_DELAY_MS } from './pointing';
import { Tip, Unavailable } from './tip';

const FACT = 'MAWS falls back to a dock bounce and a toast';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
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
    expect(drawnText(screen.getByTestId('line'))).toBe('Blocked in macOS');
    const chip = screen.getByText('Blocked in macOS');
    expect(document.getElementById(chip.getAttribute('aria-describedby') ?? '')?.textContent).toBe(FACT);
  });

  it('shows on pointing after the short delay', async () => {
    render(<Chip />);
    await user().hover(screen.getByText('Blocked in macOS'));
    await wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    await wait(1);
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

describe('Unavailable', () => {
  it('leaves an available control as it is', () => {
    render(
      <Unavailable reason={null}>
        <button type="button">Commit</button>
      </Unavailable>,
    );
    const button = screen.getByRole('button', { name: 'Commit' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps a greyed control in the Tab order, says why on pointing, and swallows its click', async () => {
    const commit = vi.fn();
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
        <Unavailable reason="Write a commit message">
          <button type="submit" onClick={commit}>
            Commit
          </button>
        </Unavailable>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Commit', description: 'Write a commit message' });
    const keys = user();
    await keys.hover(button);
    await wait(POINTING_DELAY_MS);
    expect(tooltip()).toBe('Write a commit message');
    await keys.click(button);
    expect(commit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
