import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { cellId, rowId, turnId } from '../model/keys';
import { BASH_RESULT, builder, tool, uuid } from '../model/test-events';
import type { TranscriptSource } from '../source/types';
import { Transcript } from './Transcript';

// happy-dom has no layout: give the scroller a viewport and every row a height so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 2000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
afterEach(cleanup);

let keys = 0;
const sourceOf = (events: SessionEvent[]): TranscriptSource => ({
  key: `transcript-test-${++keys}`,
  subscribe: () => () => {},
  snapshot: () => Promise.resolve(events),
});

// A closed turn whose single, denied Bash call is a standalone cell, and a second turn with an answer.
function deniedThenAnswer() {
  const b = builder();
  b.turn('u1');
  b.toolUse('t1', 'Bash', { command: 'rm -rf x' }, 'm1', 0);
  b.result('t1', 'Probe denial', { isError: true, denial: 'permission-rule' });
  b.text('m2', 0, 'Denied. Stopping.');
  b.end(['u1']);
  b.turn('u2');
  b.toolUse('t2', 'Bash', { command: 'ls' }, 'm3', 0);
  b.result('t2', 'a', { structured: BASH_RESULT('a') });
  b.text('m4', 0, 'Done.');
  b.end(['u2']);
  return b.events;
}

async function mounted(events: SessionEvent[]) {
  const source = sourceOf(events);
  render(<Transcript source={source} variant="session" />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
  return source.key!;
}

describe('Transcript', () => {
  it('a jump to a standalone cell in a collapsed turn opens the turn and focuses the cell', async () => {
    const key = await mounted(deniedThenAnswer());
    const target = cellId.tool(tool('t1'));
    expect(document.querySelector(`[data-cell-id="${target}"]`)).toBeNull(); // the turn is collapsed
    act(() => useTranscriptStore.getState().jumpTo(key, target));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
    const cell = document.querySelector<HTMLElement>(`[data-cell-id="${target}"]`)!;
    expect(cell).not.toBeNull();
    // The cell takes focus through its own focus target (its disclosure until M4 makes the cell focusable), never
    // through the generic row wrapper.
    expect(cell.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.hasAttribute('data-row-id')).toBe(false);
    expect(document.activeElement?.classList.contains('transcript-row')).toBe(false);
  });

  it('an open divider names a mounted element in aria-controls', async () => {
    await mounted(deniedThenAnswer());
    const divider = document.querySelector(`[data-row-id="${rowId.divider(turnId.ofMessage(uuid('u2')))}"]`)!;
    const toggle = divider.querySelector<HTMLElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getAllByRole('button', { expanded: true }).length).toBeGreaterThan(0));
    const open = document.querySelector(`[data-row-id="${rowId.divider(turnId.ofMessage(uuid('u2')))}"] button[aria-expanded]`)!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const controls = open.getAttribute('aria-controls')!.split(' ');
    expect(controls.length).toBeGreaterThan(0);
    for (const id of controls) expect(document.getElementById(id), `#${id} is in the DOM`).not.toBeNull();
  });
});
