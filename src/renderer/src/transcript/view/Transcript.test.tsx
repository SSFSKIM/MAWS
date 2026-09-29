import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { cellId, rowId, turnId } from '../model/keys';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { BASH_RESULT, builder, request, tool, uuid } from '../model/test-events';
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

  it('the denied count of a collapsed turn opens its work area and focuses the standalone denied cell itself', async () => {
    const key = await mounted(deniedThenAnswer());
    const turn = turnId.ofMessage(uuid('u1'));
    const divider = document.querySelector(`[data-row-id="${rowId.divider(turn)}"]`)!;
    expect(divider.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(divider as HTMLElement).getByRole('link', { name: '1 denied' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
    const target = cellId.tool(tool('t1'));
    const cell = document.querySelector<HTMLElement>(`[data-cell-id="${target}"]`)!;
    expect(document.activeElement).toBe(cell);
    expect(cell.closest('[data-kind]')?.getAttribute('data-kind')).toBe('cell');
    expect(document.querySelector(`[data-row-id="${rowId.divider(turn)}"] button[aria-expanded]`)?.getAttribute('aria-expanded')).toBe('true');
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

  it('a history that failed to load says why and offers Retry, which hydrates it', async () => {
    let attempts = 0;
    const source: TranscriptSource = {
      key: `transcript-test-${++keys}`,
      subscribe: () => () => {},
      snapshot: () => (++attempts === 1 ? Promise.reject(new Error('engine-host is not running')) : Promise.resolve(deniedThenAnswer())),
    };
    render(<Transcript source={source} variant="session" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load this transcript · engine-host is not running');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!].phase).toBe('live'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(2);
  });

  it('docks C7’s card through renderRequest in a pending request’s slot', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('q1', 'AskUserQuestion', { questions: [] });
    b.emit('question.requested', { requestId: request('r1'), toolUseId: tool('q1'), questions: [] });
    const source = sourceOf(b.events);
    render(<Transcript source={source} variant="session" renderRequest={(slot) => <div data-card="">{`Card ${slot.requestKind}`}</div>} />);
    await waitFor(() => expect(document.querySelector('[data-card]')?.textContent).toBe('Card question'));
    expect(document.querySelector('[data-kind="request_slot"]')?.textContent).toBe('Card question');
  });

  it('pass2/rewind: Show reveals the hidden branch muted and not in context, Hide removes it, and the boundary stays put', async () => {
    const key = await mounted(journalToEvents(loadJournal('pass2', 'rewind')));
    const boundaryId = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'boundary')!.id;
    const place = () => {
      const element = document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!;
      return { transform: element.style.transform, index: useTranscriptStore.getState().rows(key).findIndex((row) => row.id === boundaryId) };
    };
    const before = place();
    expect(document.querySelectorAll('[data-muted]')).toHaveLength(0);
    const boundary = document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!;
    fireEvent.click(within(boundary).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]').length).toBeGreaterThan(0));
    const muted = [...document.querySelectorAll<HTMLElement>('[data-muted]')];
    expect(muted.map((row) => row.dataset.kind)).toEqual(['user', 'assistant_text']);
    expect(muted[0].textContent).toContain('Not in context');
    expect(place()).toEqual(before);
    fireEvent.click(within(document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]')).toHaveLength(0));
    expect(place()).toEqual(before);
  });

  // A turn the owner did not start opens with its divider (no user row), a peer turn as much as an engine turn.
  it('a revealed peer turn without a user row says Not in context on its divider', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.turn('u2');
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    b.emit('turn.started', { userMessageUuid: null, origin: null });
    b.text('m3', 0, 'Peer again');
    b.end([], { origin: 'peer' });
    b.emit('boundary.rewind', { targetMessageUuid: uuid('u2'), precedingAssistantUuid: uuid('m1-u0'), prefillText: 'prompt u2' });
    const key = await mounted(b.events);
    const boundaryId = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'boundary')!.id;
    fireEvent.click(within(document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]').length).toBeGreaterThan(0));
    const labelled = [...document.querySelectorAll<HTMLElement>('[data-muted]')].filter((row) => row.textContent?.includes('Not in context')).map((row) => row.dataset.kind);
    expect(labelled).toEqual(['user', 'divider']);
  });
});
