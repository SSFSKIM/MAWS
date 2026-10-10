// The live specs' wait for a submitted turn (P2-F F-E, E scalpel-1#4; e2e/support/live-turns.ts): a turn is over when
// the prompts written since the gesture have each ended at the engine, never because a status sample looked idle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { promptsEnded, writtenPrompts } from '../../e2e/support/live-turns';

// A recorded launch: one prompt written (seq 9), queued, started, then completed (seq 32) after its result.
const FIXTURE = join(__dirname, '../../spikes/protocol-probe/fixtures/pass3/p2-to-human-off.jsonl');
const rows = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow);
const upTo = (seq: number) => rows.filter((r) => r.seq <= seq);

describe('writtenPrompts', () => {
  it('lists each prompt written with how its command ended at the engine', () => {
    expect(writtenPrompts(rows)).toEqual([{ uuid: '0ff5d8c9-daf9-4aa7-810a-4c26b5993eec', at: '2026-10-09T07:05:00.660Z', ended: 'completed' }]);
    expect(writtenPrompts(upTo(28)).map((p) => p.ended)).toEqual([null]); // its result is in, the command not yet completed
  });
});

describe('promptsEnded', () => {
  it('holds only once a prompt was written after the count and every one since has ended', () => {
    expect(promptsEnded(writtenPrompts(upTo(8)), 0), 'nothing written yet: the setup, an idle-looking status').toBe(false);
    expect(promptsEnded(writtenPrompts(upTo(12)), 0), 'written and started').toBe(false);
    expect(promptsEnded(writtenPrompts(upTo(28)), 0), 'the result in, the command still open').toBe(false);
    expect(promptsEnded(writtenPrompts(rows), 0)).toBe(true);
    expect(promptsEnded(writtenPrompts(rows), 1), 'the earlier prompt’s end is not the next one’s').toBe(false);
  });

  it('reads a cancelled prompt as ended and waits on any prompt since the count still open', () => {
    const prompt = (uuid: string, ended: 'completed' | 'cancelled' | null) => ({ uuid, at: '', ended });
    expect(promptsEnded([prompt('a', 'completed'), prompt('b', 'cancelled')], 1)).toBe(true);
    expect(promptsEnded([prompt('a', 'completed'), prompt('b', 'completed'), prompt('c', null)], 1)).toBe(false);
    expect(promptsEnded([prompt('a', null), prompt('b', 'completed')], 1), 'only the prompts since the count').toBe(true);
  });
});
