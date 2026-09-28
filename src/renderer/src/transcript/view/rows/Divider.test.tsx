import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../stores/transcript';
import { cellId } from '../../model/keys';
import { BASH_RESULT, builder, tool } from '../../model/test-events';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(cleanup);

// One turn: a denied Bash call, one run Bash call, an answer.
function deniedTurn(close = true) {
  const b = builder();
  b.turn('u1');
  b.toolUse('t1', 'Bash', { command: 'rm -rf x' }, 'm1', 0);
  b.result('t1', 'Probe denial', { isError: true, denial: 'permission-rule' });
  b.toolUse('t2', 'Bash', { command: 'ls' }, 'm2', 0);
  b.result('t2', 'a', { structured: BASH_RESULT('a') });
  b.tick(64_000);
  b.text('m3', 0, 'Done.');
  if (close) b.end(['u1'], { durationMs: 134_000 });
  return b;
}

describe('divider row', () => {
  it('reads the completed copy with the tool calls, and a denied count linking to the denied cell', async () => {
    const store = await storeWith(deniedTurn().events);
    const divider = rowOf(store.rows(), 'divider');
    const jumpTo = vi.spyOn(useTranscriptStore.getState(), 'jumpTo');
    renderRow(divider, { storeKey: store.key });
    const toggle = screen.getByRole('button', { name: /Worked for 2m 14s · 2 tool calls/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('link', { name: '1 denied' }));
    expect(jumpTo).toHaveBeenCalledWith(store.key, cellId.tool(tool('t1')));
    jumpTo.mockRestore();
  });

  it('toggles the work area: its rows join and leave the list, and aria-controls names the list while open', async () => {
    const store = await storeWith(deniedTurn().events);
    const view = renderRow(rowOf(store.rows(), 'divider'), { storeKey: store.key });
    expect(screen.getByRole('button', { name: /Worked for/ }).hasAttribute('aria-controls')).toBe(false);
    const before = store.rows().length;
    fireEvent.click(screen.getByRole('button', { name: /Worked for/ }));
    const expanded = store.rows();
    expect(expanded.length).toBeGreaterThan(before);
    const divider = rowOf(expanded, 'divider');
    expect(divider.expanded).toBe(true);
    view.rerenderRow(divider);
    // The work-area rows are virtual (some are never in the DOM), so the reference is the list, which always is
    // (Transcript.test.tsx asserts the element exists).
    expect(screen.getByRole('button', { name: /Worked for/ }).getAttribute('aria-controls')).toBe('t-list');
    fireEvent.click(screen.getByRole('button', { name: /Worked for/ }));
    expect(store.rows()).toHaveLength(before);
  });

  it('opens the turn summary popover from its trailing control', async () => {
    const store = await storeWith(deniedTurn().events);
    renderRow(rowOf(store.rows(), 'divider'), { storeKey: store.key });
    fireEvent.click(screen.getByRole('button', { name: 'Turn summary' }));
    expect(await screen.findByText(/Worked for 2m 14s on claude-test · 2 tool calls: Ran `ls` · 1 denied \(permission-rule\)/)).toBeDefined();
  });

  describe('while the turn works', () => {
    beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-09-28T10:00:05.000Z'), toFake: ['Date', 'setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('ticks its duration from the last event, by wall time since it arrived', async () => {
      const b = deniedTurn(false);
      const store = await storeWith(b.events);
      const divider = rowOf(store.rows(), 'divider');
      expect(divider.state).toBe('working');
      renderRow(divider, { storeKey: store.key });
      const elapsed = Date.parse(b.events.at(-1)!.at) - Date.parse(divider.startedAt); // 64.9 s of event time
      expect(screen.getByRole('button', { name: /Working for/ }).textContent).toContain(`Working for 1m ${String(Math.floor(elapsed / 1000) - 60).padStart(2, '0')}s`);
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole('button', { name: /Working for/ }).textContent).toContain(`Working for 1m ${String(Math.floor(elapsed / 1000) - 57).padStart(2, '0')}s`);
    });
  });
});
