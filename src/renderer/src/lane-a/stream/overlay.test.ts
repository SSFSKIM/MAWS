// The lane A streaming overlay (P5 O9 M5, "Streaming without the trap"): a local terminal session's reply drawn as it is
// written, from the pane's own watch, beside the disk transcript and never in its store. A block is drawn until the row
// its `block-row` named is in the store, its unnamed blocks kept, settled, at its `step-end`, a named block whose row never lands
// dropped 5 s after its step ended, and everything dropped when the watch ends; a reset's fresh snapshot resumes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from 'desk-hub/protocol';
import type { RowId, TurnId } from '../../transcript/model/rows';
import { turnId } from '../../transcript/model/keys';
import { applyEvents, createState } from '../../transcript/model/reduce';
import { builder, uuid } from '../../transcript/model/test-events';
import { LaneAOverlay, NAMED_ROW_WAIT_MS, placeCuts, type Cut } from './overlay';

const msg = (kind: string, body: unknown, n = 1) => ({ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w-1', n, body }) as unknown as SessionMessage;
const step = { turnId: 'turn-1', agentId: null, step: 0 };
const snapshot = (streaming: unknown[] = []) => msg('snapshot', { streaming, usage: null }, 0);
const chunk = (chunkIndex: number, index: number, text: string, kind = 'text') => msg('chunk', { ...step, chunkIndex, chunk: { kind, index, text } });
const ROW = '0d4c4001-0000-4000-8000-000000000009';

let landed: Set<string>;
let changes: number;
let cuts: Cut[];
const kept = () => cuts.flatMap((cut) => cut.rows);
let overlay: LaneAOverlay;
const texts = () => overlay.rows(null).map((row) => (row.kind === 'assistant_text' ? row.markdown : row.kind));

beforeEach(() => {
  landed = new Set();
  changes = 0;
  cuts = [];
  overlay = new LaneAOverlay(
    (uuid) => landed.has(uuid),
    () => {
      changes += 1;
    },
    { keep: (cut) => cuts.push(cut) },
  );
});
afterEach(() => {
  overlay.dispose();
  vi.useRealTimers();
});

describe('LaneAOverlay', () => {
  it('draws the reply as its chunks arrive, then leaves once the row its block-row named lands', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Once'), chunk(1, 0, ' upon')] });
    expect(texts()).toEqual(['Once upon']);
    expect(changes).toBe(1); // one redraw per batch
    overlay.receive({ kind: 'messages', messages: [msg('block-row', { ...step, uuid: ROW, index: 0 })] });
    expect(texts()).toEqual(['Once upon']); // still drawn: its row is not in the store yet
    landed.add(ROW);
    expect(overlay.settleLanded()).toBe(true);
    expect(texts()).toEqual([]);
  });

  it('draws what a pane opened mid-reply finds in its snapshot, under the turn it is given', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot([{ ...step, upTo: 1, blocks: [{ index: 0, kind: 'text', text: 'Half a', upTo: 1 }] }]), chunk(2, 0, ' story')] });
    const [row] = overlay.rows('t-7' as TurnId);
    expect(row).toMatchObject({ kind: 'assistant_text', markdown: 'Half a story', live: true, turnId: 't-7' });
  });

  // P5 O9 (the M8 sitting): the engine writes no row for what a step streamed before an interrupt cut it, so at its
  // step-end that text leaves the stream and is kept, settled, with the bridge's time of that end (`placeCuts` finds its
  // disk turn by it): no streaming text is left behind, none is lost. The M10 sitting: it is marked cut off, since the
  // session kept none of it (the next turn won't see it), never drawn as the reply.
  it('keeps an unnamed block’s text at its step-end, settled, with the time its step ended: an interrupted reply leaves no streaming text and loses none', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Abandoned'), chunk(1, 0, ' halfway')] });
    overlay.receive({ kind: 'messages', messages: [msg('step-end', { ...step, t: 1_000 })] });
    expect(texts()).toEqual([]);
    expect(cuts).toEqual([{ at: 1_000, rows: [expect.objectContaining({ kind: 'assistant_text', markdown: 'Abandoned halfway', live: false, turnId: null, cut: true })] }]);
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Again'), msg('step-end', step)] }); // a step-end with no time
    expect(cuts[1]).toEqual({ at: null, rows: [expect.objectContaining({ markdown: 'Again' })] });
  });

  it('keeps a message tool’s cut message, and nothing of a named block, a thinking block or another tool’s input', () => {
    const tool = (chunkIndex: number, index: number, name: string, id: string) => msg('chunk', { ...step, chunkIndex, chunk: { kind: 'tool', index, id, name } });
    const input = (chunkIndex: number, index: number, json: string) => msg('chunk', { ...step, chunkIndex, chunk: { kind: 'input', index, json } });
    overlay.receive({
      kind: 'messages',
      messages: [snapshot(), chunk(0, 0, '', 'thinking'), msg('block-row', { ...step, uuid: ROW, index: 0 }), tool(1, 1, 'mcp__to-human__message', 'toolu_1'), input(2, 1, '{"text": "1\\n2'), input(3, 1, '\\n3'), tool(4, 2, 'Bash', 'toolu_2'), input(5, 2, '{"command": "ls')],
    });
    expect(overlay.rows(null).map((row) => row.kind)).toEqual(['thinking', 'to_human']);
    overlay.receive({ kind: 'messages', messages: [msg('step-end', step)] });
    expect(kept()).toEqual([expect.objectContaining({ kind: 'assistant_text', markdown: '1\n2\n3', cut: true })]); // never sent: no message row
    expect(overlay.rows(null).map((row) => row.kind)).toEqual(['thinking']); // the named block waits for its row
  });

  it('keeps nothing of a step whose blocks were all named', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Whole'), msg('block-row', { ...step, uuid: ROW, index: 0 }), msg('step-end', step)] });
    expect(kept()).toEqual([]);
  });

  it('drops a named block whose row has not landed 5 s after its step ended', () => {
    vi.useFakeTimers();
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Named'), msg('block-row', { ...step, uuid: ROW, index: 0 }), msg('step-end', step)] });
    expect(texts()).toEqual(['Named']);
    vi.advanceTimersByTime(NAMED_ROW_WAIT_MS - 1);
    expect(texts()).toEqual(['Named']);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it('settles a block whose row is already in the store when it is named', () => {
    landed.add(ROW);
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Fast'), msg('block-row', { ...step, uuid: ROW, index: 0 })] });
    expect(texts()).toEqual([]);
  });

  it('drops a named block 5 s after a reset whose fresh snapshot no longer streams its step, its row never landing', () => {
    vi.useFakeTimers();
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Named'), msg('block-row', { ...step, uuid: ROW, index: 0 })] });
    overlay.receive({ kind: 'reset' });
    overlay.receive({ kind: 'messages', messages: [snapshot()] }); // the step ended while the stream was down
    expect(texts()).toEqual(['Named']);
    vi.advanceTimersByTime(NAMED_ROW_WAIT_MS - 1);
    expect(texts()).toEqual(['Named']);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it('settles such a block early when its row lands, and leaves a step the fresh snapshot still streams', () => {
    vi.useFakeTimers();
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Named'), msg('block-row', { ...step, uuid: ROW, index: 0 })] });
    overlay.receive({ kind: 'reset' });
    overlay.receive({ kind: 'messages', messages: [snapshot()] });
    landed.add(ROW);
    expect(overlay.settleLanded()).toBe(true);
    expect(texts()).toEqual([]);

    const next = { ...step, step: 1 }; // the turn's next request
    overlay.receive({ kind: 'messages', messages: [msg('chunk', { ...next, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Still' } }), msg('block-row', { ...next, uuid: 'row-2', index: 0 })] });
    overlay.receive({ kind: 'reset' });
    overlay.receive({ kind: 'messages', messages: [snapshot([{ ...next, upTo: 0, blocks: [{ index: 0, kind: 'text', text: 'Still', upTo: 0, uuid: 'row-2' }] }])] });
    vi.advanceTimersByTime(NAMED_ROW_WAIT_MS * 2);
    expect(texts()).toEqual(['Still']); // its step streams on: no step-end yet, so no expiry
  });

  it('draws nothing when the watch ends, and resumes from a reset’s fresh snapshot', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot(), chunk(0, 0, 'Before')] });
    overlay.receive({ kind: 'reset' });
    overlay.receive({ kind: 'messages', messages: [snapshot([{ ...step, upTo: 3, blocks: [{ index: 0, kind: 'text', text: 'Before and after', upTo: 3 }] }])] });
    expect(texts()).toEqual(['Before and after']);
    overlay.receive({ kind: 'ended', reason: 'gone' });
    expect(texts()).toEqual([]);
  });

  it('draws only the main loop’s blocks', () => {
    overlay.receive({ kind: 'messages', messages: [snapshot(), msg('chunk', { turnId: 'turn-1', agentId: 'a-1', step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'sub' } })] });
    expect(texts()).toEqual([]);
  });
});

// A cut's disk turn (the fix wave's review): the turn the engine was running at the bridge's time of the cut, which is
// the latest turn the store holds that started at or before it, known only once the store holds a turn started after
// it. Until then the turn running at the cut may still be on its way from disk (or is the latest), so the rows wait,
// last, in no turn, rather than being frozen under whichever turn was latest.
describe('placeCuts', () => {
  const T = (s: number) => Date.parse(`2026-09-28T10:00:${String(s).padStart(2, '0')}.000Z`);
  function state(...starts: number[]) {
    const b = builder();
    starts.forEach((at, i) => {
      b.tick(at - b.at);
      b.turn(`u${i}`, `prompt ${i}`);
    });
    return applyEvents(createState(null, null), b.events);
  }
  const cut = (at: number | null, id = 'k1'): Cut => ({ at, rows: [{ id: id as RowId, turnId: null, at: '2026-09-28T10:00:00.000Z', kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: id, live: false, phase: 'answer', model: null }] });
  const placed = (s: ReturnType<typeof state> | undefined, ...cuts: Cut[]) => placeCuts(s, cuts).map((row) => [row.id, row.turnId]);

  it('places a cut in the turn running at its time once a later turn is in the store: a replay spanning turns keeps it there', () => {
    expect(placed(state(T(0), T(10), T(20)), cut(T(5)), cut(T(15), 'k2'))).toEqual([
      ['k1', turnId.ofMessage(uuid('u0'))],
      ['k2', turnId.ofMessage(uuid('u1'))],
    ]);
  });

  it('leaves a cut in no turn while no later turn is in the store, whatever turn is latest: its own may still be hydrating', () => {
    expect(placed(state(T(0)), cut(T(5)))).toEqual([['k1', null]]); // its turn, or a later one not read yet
    expect(placed(state(), cut(T(5)))).toEqual([['k1', null]]);
    expect(placed(undefined, cut(T(5)))).toEqual([['k1', null]]);
    expect(placed(state(T(0), T(10)), cut(null))).toEqual([['k1', null]]); // no time: never guessed
  });
});

