// E7 (M7): the agent tools' wall clock, which the `#panel` harness's `setClock` fixes so the widget's elapsed, the
// Scheduled rows' next runs and expiries read a known now.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setAgentsClock, useTicker, wallClock } from './shared';

function Now({ active }: { active: boolean }) {
  return <span data-testid="now">{useTicker(active)}</span>;
}
const shown = () => Number(screen.getByTestId('now').textContent);

afterEach(() => {
  setAgentsClock(null);
  cleanup();
});

describe('the agent tools’ clock', () => {
  it('reads the wall clock until fixed, the fixed time while fixed, and the wall clock again once released', () => {
    const before = Date.now();
    expect(wallClock()).toBeGreaterThanOrEqual(before);
    setAgentsClock(Date.parse('2026-10-06T11:12:30.000Z'));
    expect(wallClock()).toBe(Date.parse('2026-10-06T11:12:30.000Z'));
    setAgentsClock(null);
    expect(wallClock()).toBeGreaterThanOrEqual(before);
  });

  it('gives a mounted ticker the fixed time at once, whether or not it ticks', () => {
    render(<Now active={false} />);
    act(() => setAgentsClock(Date.parse('2026-10-06T11:12:30.000Z')));
    expect(shown()).toBe(Date.parse('2026-10-06T11:12:30.000Z'));
    act(() => setAgentsClock(Date.parse('2026-10-07T00:00:00.000Z')));
    expect(shown()).toBe(Date.parse('2026-10-07T00:00:00.000Z'));
  });

  it('mounts on the fixed time', () => {
    setAgentsClock(Date.parse('2026-10-06T11:12:30.000Z'));
    render(<Now active />);
    expect(shown()).toBe(Date.parse('2026-10-06T11:12:30.000Z'));
  });
});
