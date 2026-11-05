// @vitest-environment happy-dom
// A terminal session's thinking block as it streams (P5 O7 M10, defect C: "Thinking · 0s" never counts up). The lane A
// overlay draws the block from the bridge's chunks, which carry no thinking text, so its row reads the live label with
// the time it has run. That time is the block's own, on this window's clock from when the block was first drawn: never
// the transcript store's clock, which follows the rows on disk (none arrive while a reply streams) and the digest's word
// on the process (`foreign` while the bridge is still starting). Once the block closes (the next block of its message
// starts, or the engine writes its row), it reads its final duration.
import { act, cleanup, screen } from '@testing-library/react';
import type { SessionMessage } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { builder } from '../../transcript/model/test-events';
import type { Row } from '../../transcript/model/rows';
import { renderRow, storeWith } from '../../transcript/view/rows/test-support';
import { LaneAOverlay } from '../stream/overlay';

const msg = (kind: string, body: unknown, n = 1) => ({ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w-1', n, body }) as unknown as SessionMessage;
const step = { turnId: 'turn-1', agentId: null, step: 0 };
const snapshot = (streaming: unknown[] = []) => msg('snapshot', { streaming, usage: null }, 0);
const thinking = (chunkIndex: number, index = 0) => msg('chunk', { ...step, chunkIndex, chunk: { kind: 'thinking', index, text: '' } });
const tool = (chunkIndex: number, index: number) => msg('chunk', { ...step, chunkIndex, chunk: { kind: 'tool', index, id: 'toolu_1', name: 'Bash' } });
const ROW = '0d4c4001-0000-4000-8000-000000000009';

const storeKeys: string[] = [];
let overlay: LaneAOverlay;
let drawn: Row[] = [];
// As the pane's hook draws it (use-overlay.ts): the rows read again on every change.
const watch = () => {
  drawn = [];
  overlay = new LaneAOverlay(() => false, () => (drawn = overlay.rows(null)));
};
beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-09-28T10:00:00.200Z'), toFake: ['Date', 'setInterval', 'clearInterval'] });
  watch();
});
afterEach(() => {
  cleanup();
  overlay.dispose();
  vi.useRealTimers();
  for (const key of storeKeys.splice(0)) useTranscriptStore.getState().drop(key);
});

// The session's transcript as the disk follow gave it: the prompt's rows, stamped from 10:00:00.
async function transcript() {
  const b = builder();
  b.turn('u1');
  const store = await storeWith(b.events);
  storeKeys.push(store.key);
  return store;
}
const thinkingRow = (): Extract<Row, { kind: 'thinking' }> => {
  const row = drawn.find((r) => r.kind === 'thinking');
  if (row?.kind !== 'thinking') throw new Error('no thinking row');
  return row;
};
const label = () => document.querySelector('.transcript-thinking')!.textContent;

describe('a streamed thinking block’s time', () => {
  it('counts up from when the block was drawn while the digest still says no process (the bridge is starting)', async () => {
    const store = await transcript();
    useTranscriptStore.getState().setLive(store.key, false); // the digest's `foreign` until the bridge is live
    vi.setSystemTime(Date.parse('2026-09-28T10:00:02.000Z'));
    overlay.receive({ kind: 'messages', messages: [snapshot(), thinking(0)] });
    renderRow(thinkingRow(), { storeKey: store.key });
    expect(label()).toBe('Thinking · 0s');
    act(() => vi.advanceTimersByTime(6_000)); // no chunk, no row on disk
    expect(label()).toBe('Thinking · 6s');
    act(() => vi.advanceTimersByTime(6_000));
    expect(label()).toBe('Still thinking · 12s');
  });

  it('counts up from when the block was drawn however late the disk rows before it arrived', async () => {
    vi.setSystemTime(Date.parse('2026-09-28T10:00:30.000Z')); // the prompt's rows reached the store 30 s after they were written
    const store = await transcript();
    overlay.receive({ kind: 'messages', messages: [snapshot(), thinking(0)] });
    renderRow(thinkingRow(), { storeKey: store.key });
    act(() => vi.advanceTimersByTime(6_000));
    expect(label()).toBe('Thinking · 6s');
  });

  it('reads its final duration once the next block of its message starts, or once the engine writes its row', async () => {
    const store = await transcript();
    overlay.receive({ kind: 'messages', messages: [snapshot(), thinking(0)] });
    vi.advanceTimersByTime(8_000);
    overlay.receive({ kind: 'messages', messages: [tool(1, 1)] });
    expect(thinkingRow()).toMatchObject({ live: false, durationMs: 8_000 });
    vi.advanceTimersByTime(5_000); // still drawn while the call streams: the time stays the block's
    renderRow(thinkingRow(), { storeKey: store.key });
    expect(label()).toBe('Thought for 8s');

    cleanup();
    overlay.dispose();
    watch();
    overlay.receive({ kind: 'messages', messages: [snapshot(), thinking(0)] });
    vi.advanceTimersByTime(5_000);
    overlay.receive({ kind: 'messages', messages: [msg('block-row', { ...step, uuid: ROW, index: 0 })] });
    expect(thinkingRow()).toMatchObject({ live: false, durationMs: 5_000 });
  });

  it('a block first seen already closed (a pane opened after it) reads Thought, with no time it never saw', async () => {
    const store = await transcript();
    overlay.receive({ kind: 'messages', messages: [snapshot([{ ...step, upTo: 1, blocks: [{ index: 0, kind: 'thinking', text: '', upTo: 0 }, { index: 1, kind: 'tool', text: '', upTo: 1, id: 'toolu_1', name: 'Bash' }] }])] });
    expect(thinkingRow()).toMatchObject({ live: false, durationMs: null });
    renderRow(thinkingRow(), { storeKey: store.key });
    expect(screen.getByText('Thought')).toBeTruthy();
  });
});
