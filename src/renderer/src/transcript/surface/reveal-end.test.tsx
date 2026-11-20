// @vitest-environment happy-dom
// UX wave U2b, M5 (the execution document, R6; decision 15): a jump's target is revealed (its rows ask no site, so they
// draw MAWS's own), and the reveal ends when the row that holds the target has entered the list's mounted range and left
// it. A jump to a row not yet mounted keeps its reveal until then; a jump to a call inside a run ends when the run's row
// leaves, and survives the run's row changing its id (a live run of one becomes its call's own row when the turn
// closes). Every text is invented.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { at } from '../../../../../test/support/machine';
import { useTranscriptStore } from '../../stores/transcript';
import { builder } from '../model/test-events';
import type { Row } from '../model/rows';
import type { TranscriptSource } from '../source/types';
import { Transcript } from '../view/Transcript';

const ROW = 40;
const VIEWPORT = 400;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return VIEWPORT;
      if (this.hasAttribute('data-index')) return ROW;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
afterEach(() => {
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
});

let keys = 0;
// Many closed turns, so the list mounts a window of them; `live` adds a last turn left open with one running call
function history(live: boolean) {
  const b = builder();
  for (let i = 0; i < 60; i += 1) {
    b.turn(`u${i}`, `Prompt ${i}`);
    b.text(`m${i}`, 0, `Reply ${i}`);
    b.end([`u${i}`]);
  }
  if (live) {
    b.turn('uL', 'Run the last command');
    b.toolUse('tL', 'Bash', { command: 'make last' });
    b.result('tL', 'ok');
  }
  return b;
}
async function mount(events: SessionEvent[]) {
  const key = at(`App-reveal-${++keys}` as AppSessionId);
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = { key, subscribe: (l) => { listener = l; return () => (listener = null); }, snapshot: () => Promise.resolve(events) };
  render(<Transcript source={source} variant="session" browserActivity={false} />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
  const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
  let top = 0;
  const height = () => parseFloat((scroller.firstElementChild as HTMLElement).style.height) || 0; // the list's own total
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = value) });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: height });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  scroller.scrollTo = ((options?: ScrollToOptions | number, y?: number) => { top = (typeof options === 'number' ? y : options?.top) ?? top; }) as typeof scroller.scrollTo;
  const moveTo = (offset: number) => act(() => { top = offset; fireEvent.scroll(scroller); });
  return {
    key,
    moveTo,
    bottom: () => moveTo(Math.max(0, height() - VIEWPORT)),
    push: (batch: SessionEvent[]) => act(() => listener?.(batch)),
    revealed: () => useTranscriptStore.getState().entries[key]!.state.ui.revealed,
    rows: () => useTranscriptStore.getState().rows(key),
  };
}
const mounted = (id: string) => document.querySelector(`[data-row-id="${CSS.escape(id)}"]`) !== null;

describe('the end of a jump’s reveal (R6)', () => {
  it('a jump to a row not yet mounted keeps its reveal until the row has been mounted, and ends it once the row has left', async () => {
    const v = await mount(history(false).events);
    v.bottom();
    const target = v.rows().find((row): row is Extract<Row, { kind: 'assistant_text' }> => row.kind === 'assistant_text' && row.markdown === 'Reply 2')
      ?? v.rows().find((row) => row.kind === 'divider' && row.turnId === 'turn:u2')!;
    expect(mounted(target.id)).toBe(false);
    act(() => useTranscriptStore.getState().jumpTo(v.key, target.id));
    const revealed = v.revealed();
    expect(revealed).toBeDefined();
    v.bottom(); // the list moves while the target has not been mounted: the reveal holds
    expect(v.revealed()).toBe(revealed);
    v.moveTo(0);
    await waitFor(() => expect(mounted(v.rows().find((row) => row.id === revealed || row.turnId === 'turn:u2')!.id)).toBe(true));
    expect(v.revealed()).toBe(revealed);
    v.bottom();
    await waitFor(() => expect(v.revealed()).toBeUndefined());
  });

  it('a jump to a call inside a run ends when the run’s row leaves, and survives the run’s row changing its id', async () => {
    const b = history(true);
    const v = await mount(b.events);
    v.bottom();
    const run = v.rows().find((row) => row.kind === 'group' && row.cells.some((cell) => cell.toolUseId === 'tL'))!;
    const call = (run as Extract<Row, { kind: 'group' }>).cells.find((cell) => cell.toolUseId === 'tL')!;
    // the reader keeps the turn open past its close (an open turn reads as expanded until the reader collapses it: the
    // first toggle collapses it, the second records it as expanded)
    for (let i = 0; i < 2; i += 1) act(() => useTranscriptStore.getState().toggleTurn(v.key, run.turnId!));
    v.bottom();
    await waitFor(() => expect(mounted(run.id)).toBe(true));
    act(() => useTranscriptStore.getState().jumpTo(v.key, call.id));
    expect(v.revealed()).toBe(call.id);
    const sent = b.events.length;
    b.end(['uL']);
    v.push(b.events.slice(sent)); // the turn closes: the run of one is its call's own row now
    const holder = v.rows().find((row) => row.id === call.id || (row.kind === 'group' && row.cells.some((cell) => cell.id === call.id)))!;
    expect(holder.id).not.toBe(run.id);
    v.bottom();
    await waitFor(() => expect(mounted(holder.id)).toBe(true));
    expect(v.revealed()).toBe(call.id);
    v.moveTo(0);
    await waitFor(() => expect(v.revealed()).toBeUndefined());
  });
});
