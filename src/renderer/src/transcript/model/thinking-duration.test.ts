// P5 O7 M10's follow-up (C at the re-check): a thinking block's figure is what MAWS measured, from the block's own start.
// The path the owner saw: a session MAWS runs (lane B), claude-opus-5-5, its frames as the engine streamed them and their
// recorded times, through the engine host's normaliser (`journalToEvents`), the reducer and derive. On opus-5-5 a
// thinking block's text arrives in one burst just before its end, seconds after its `content_block_start`: measured
// from the first delta it read "Thought for 0s".
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { emptyDigest, foldEvents } from '../../../../services/sessions/digest';
import { journalToEvents } from '../dev/journal';
import { thinkingLabel } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';

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

  it('a block with no text yet is drawn live from its start, a plain label, and has no row once it closes (W1)', () => {
    const rows = journal('p4-r7-loss-stages');
    expect(rowsUpTo(rows, 194).at(-1), 'its start drawn: a live row with no text, a plain label').toMatchObject({ kind: 'thinking', live: true, text: '', at: rows.find((row) => row.seq === 194)!.at });
    expect(thinkingLabels(rowsUpTo(rows, 198))).toEqual(['Thought']); // the textless block closed: only the first block's row stays
  });

  it('moves nothing else: the block sits where it did, before the answer, and the session reads Thinking from its start', () => {
    const rows = journal('p4-tool-summaries-thinking-edits');
    const tail = rowsUpTo(rows).filter((row) => row.kind === 'thinking' || row.kind === 'assistant_text').slice(-2);
    expect(tail.map((row) => row.kind)).toEqual(['thinking', 'assistant_text']);
    const stages = journal('p4-r7-loss-stages');
    const activity = (seq: number) => foldEvents(emptyDigest('a' as AppSessionId), new Set(), journalToEvents(stages.filter((row) => row.seq <= seq))).activity;
    expect(activity(193), 'its message started, after a tool’s result').toBe('Working');
    expect(activity(194), 'at the block’s start (seq 194), not its first words (seq 195, 2.46 s on)').toBe('Thinking');
  });
});
