// The bare count (the word cut, "What the cut builds"): a heading followed by a number, the number's meaning its
// accessible name and its tooltip, which the keyboard reaches.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnText } from '../test-support/drawn-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { BareCount } from './count';
import { POINTING_DELAY_MS } from './pointing';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;

const Heading = () => (
  <h3>
    Agents <BareCount count={2} meaning="2 running" />
  </h3>
);

describe('BareCount', () => {
  it('draws the number alone, and names its meaning in the heading', () => {
    render(<Heading />);
    const heading = screen.getByRole('heading', { name: 'Agents 2 running' });
    expect(drawnText(heading)).toBe('Agents 2');
    expect(screen.getByRole('img', { name: '2 running' }).textContent).toBe('2');
    expect(tooltip()).toBeNull();
  });

  it('shows its meaning on pointing after the short delay', async () => {
    render(<Heading />);
    await user().hover(screen.getByRole('img', { name: '2 running' }));
    wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    wait(1);
    expect(tooltip()).toBe('2 running');
  });

  it('takes keyboard focus and shows its meaning at once', async () => {
    render(<Heading />);
    await user().tab();
    expect(document.activeElement).toBe(screen.getByRole('img', { name: '2 running' }));
    expect(tooltip()).toBe('2 running');
  });
});
