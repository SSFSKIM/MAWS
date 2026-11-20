// The quiet spinner (the word cut, "What the cut builds"; Acceptance 5): nothing for the first half second of a wait,
// then a small spinner carrying the wait's words as its accessible name, never as drawn text.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { QUIET_MS, QuietSpinner } from './spinner';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuietSpinner', () => {
  it('shows nothing for the first half second', () => {
    const view = render(<QuietSpinner label="Reading settings…" />);
    act(() => vi.advanceTimersByTime(QUIET_MS - 1));
    expect(QUIET_MS).toBe(500);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(view.container.innerHTML).toBe('');
  });

  it('then shows a spinner named by the wait’s words, which are not drawn', () => {
    const view = render(<QuietSpinner label="Reading settings…" />);
    act(() => vi.advanceTimersByTime(QUIET_MS));
    expect(screen.getByRole('progressbar', { name: 'Reading settings…' })).toBeTruthy();
    expect(accessibleText(view.container)).toBe('');
  });

  it('a wait that ends within the half second leaves no timer behind', () => {
    const view = render(<QuietSpinner label="Reading settings…" />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
