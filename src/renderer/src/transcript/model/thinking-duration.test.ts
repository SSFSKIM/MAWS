// P5 O7 M10's follow-up (C at the re-check): a thinking block's figure is what MAWS measured, from the block's own start.
// The path the owner saw: a session MAWS runs (lane B), claude-opus-5-5, its frames as the engine streamed them and their
// recorded times, through the engine host's normaliser (`journalToEvents`), the reducer and derive. On opus-5-5 a
// thinking block's text arrives in one burst just before its end, seconds after its `content_block_start`: measured
// from the first delta it read "Thought for 0s".
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { journalToEvents } from '../dev/journal';
import { thinkingLabel } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { api, builder } from './test-events';

const journal = (name: string): JournalRow[] => readFileSync(resolve(`spikes/protocol-probe/fixtures/p4/${name}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
// every thinking block's label as drawn: a row's, or a cell's inside its turn's group
const thinkingLabels = (rows: Row[]): string[] => rows.flatMap((row) =>
  row.kind === 'thinking' ? [row.live ? 'live' : thinkingLabel(false, row.durationMs)] : row.kind === 'group' ? row.cells.filter((cell) => cell.toolName === 'thinking').map((cell) => cell.label) : []);
const rowsUpTo = (rows: JournalRow[], seq = Infinity) => rowsOf(withAllExpanded(applyEvents(createState(null, null), journalToEvents(rows.filter((row) => row.seq <= seq)))));
const drawn = (rows: JournalRow[]) => thinkingLabels(rowsUpTo(rows));

describe('a thinking block’s duration on a session MAWS runs (claude-opus-5-5)', () => {
  it('runs from the block’s start: 2.97 s from `content_block_start` (seq 108) to its whole block (seq 153), the text a burst in its last 23 ms', () => {
    expect(drawn(journal('p4-tool-summaries-thinking-edits'))).toEqual(['Thought for 2s']);
  });

  it('shows no figure under a second: no block reads "0s"', () => {
    // seq 93 to 126, 2 ms; the second block (seq 194 to 197, 2.46 s) has no text, so no row (W1)
    expect(drawn(journal('p4-r7-loss-stages'))).toEqual(['Thought']);
  });

  // UX wave U2 (decision 19, ticket 479): the block follows a call, so it is that call's run's last cell while it streams; once
  // it closes it travels on with its recorded number and has no row of its own, and at the run's close it leaves none
  it('a block with no text yet is drawn live from its start inside the run it follows, and has no row once it closes (W1)', () => {
    const rows = journal('p4-r7-loss-stages');
    const streaming = rowsUpTo(rows, 194).at(-1)!;
    expect(streaming.kind).toBe('group');
    expect(streaming.kind === 'group' && streaming.cells.at(-1), 'its start drawn: a live thought with no text').toMatchObject({ toolName: 'thinking', status: 'running', startedAt: rows.find((row) => row.seq === 194)!.at, detail: { text: '' } });
    const closed = rowsUpTo(rows, 198);
    expect(closed.some((row) => row.kind === 'thinking'), 'no row of its own').toBe(false);
    const run = closed.at(-1)!;
    expect(run.kind === 'group' && run.cells.at(-1)?.detail).toEqual({ kind: 'thinking', text: '', durationMs: 2_460, recordedMs: 2_460 });
    expect(thinkingLabels(rowsUpTo(rows)), 'at the run’s close it leaves no row (W1)').toEqual(['Thought']);
  });

  // UX wave U2 (X1, decision 2): where the engine recorded the block's duration (`thinking_duration_ms`, engine 2.1.287
  // on), the row carries that number and its figure is it; MAWS's own measurement stands in only where none came
  it('reads the engine’s recorded number where the frame carries one: 2,953 ms (seq 153), 2 ms and 2,460 ms (p4-r7-loss-stages)', () => {
    // UX wave U2 (O-29): a thought before a bookkeeping call is a cell of that call's run, so it is read in either form
    const thoughts = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'thinking' ? [{ live: row.live, recordedMs: row.recordedMs, durationMs: row.durationMs }]
      : row.kind === 'group' ? row.cells.flatMap((cell) => (cell.detail.kind === 'thinking' ? [{ live: cell.status === 'running', recordedMs: cell.detail.recordedMs, durationMs: cell.detail.durationMs }] : [])) : []));
    expect(thoughts(rowsUpTo(journal('p4-tool-summaries-thinking-edits'))).map((row) => [row.recordedMs, row.durationMs])).toEqual([[2953, 2953]]);
    expect(thoughts(rowsUpTo(journal('p4-r7-loss-stages'))).map((row) => [row.recordedMs, row.durationMs])).toEqual([[2, 2]]); // the textless one has no row (W1)
    const live = thoughts(rowsUpTo(journal('p4-r7-loss-stages'), 194)).at(-1)!;
    expect([live.live, live.recordedMs], 'a block still streaming has no recorded number yet').toEqual([true, null]);
  });

  it('a block that streamed, completed on an event with no number, keeps the measured time and has no recorded one', () => {
    const b = builder();
    b.turn('u1');
    b.emit('assistant.block.delta', { apiMessageId: api('msg_1'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null, toolUseId: null, toolName: null });
    b.tick(7_900);
    b.thinking('msg_1', 0, 'Comparing the two fixture layouts.');
    const row = rowsOf(withAllExpanded(applyEvents(createState(null, null), b.events))).find((r) => r.kind === 'thinking');
    expect(row).toMatchObject({ recordedMs: null, durationMs: 8_000 });
  });

  it('moves nothing else: the block sits where it did, before the answer', () => {
    const rows = journal('p4-tool-summaries-thinking-edits');
    const tail = rowsUpTo(rows).filter((row) => row.kind === 'thinking' || row.kind === 'assistant_text').slice(-2);
    expect(tail.map((row) => row.kind)).toEqual(['thinking', 'assistant_text']);
  });
});
