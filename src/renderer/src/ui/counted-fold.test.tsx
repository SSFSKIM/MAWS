// The counted fold (the word cut, "What the cut builds"): a block folded to one line that keeps its count and opens in
// place. The line is a disclosure named by its words; opening it shows the block under it and leaves the line as it was.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { CountedFold } from './counted-fold';
import { CLOSE_MOTION } from './disclosure';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const line = () => screen.getByRole('button', { name: 'Listed 9 agents' });
const body = () => screen.queryByText('Subagents · 3');

const Listing = () => (
  <div data-testid="listing">
    <CountedFold summary="Listed 9 agents">
      <p>Subagents · 3</p>
    </CountedFold>
  </div>
);

describe('CountedFold', () => {
  it('rests as one line that keeps its count, named by its words, folded', () => {
    render(<Listing />);
    expect(line().getAttribute('aria-expanded')).toBe('false');
    expect(accessibleText(screen.getByTestId('listing'))).toBe('Listed 9 agents');
    expect(body()).toBeNull();
  });

  it('opens in place on a press, the line unchanged above what it shows', async () => {
    render(<Listing />);
    await user().click(line());
    expect(line().getAttribute('aria-expanded')).toBe('true');
    expect(body()).not.toBeNull();
    expect(line().compareDocumentPosition(body()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line().textContent).toBe('Listed 9 agents');
  });

  it('opens and folds from the keyboard alone, and folds back to its line', async () => {
    render(<Listing />);
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(line());
    await keys.keyboard('{Enter}');
    expect(body()).not.toBeNull();
    await keys.keyboard(' ');
    expect(line().getAttribute('aria-expanded')).toBe('false');
    wait(CLOSE_MOTION.ms);
    expect(body()).toBeNull();
  });

  it('follows an open state its caller keeps, asking the caller to change it', async () => {
    const asked: boolean[] = [];
    function Kept() {
      const [open, setOpen] = useState(true);
      return (
        <CountedFold
          summary="Listed 9 agents"
          open={open}
          onOpenChange={(next) => {
            asked.push(next);
            setOpen(next);
          }}
        >
          <p>Subagents · 3</p>
        </CountedFold>
      );
    }
    render(<Kept />);
    expect(body()).not.toBeNull();
    await user().click(line());
    expect(asked).toEqual([false]);
    expect(line().getAttribute('aria-expanded')).toBe('false');
  });

  it('draws what leads its line before the words, outside its name', () => {
    render(
      <CountedFold summary="Listed 9 agents" lead={<svg aria-hidden="true" data-testid="lead" />}>
        <p>Subagents · 3</p>
      </CountedFold>,
    );
    expect(line().contains(screen.getByTestId('lead'))).toBe(true);
    expect(line().textContent).toBe('Listed 9 agents');
  });
});
