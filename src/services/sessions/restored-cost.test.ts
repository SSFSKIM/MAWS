// The restored figure read back from a session's transcript (restored-cost.ts), over transcripts the probe recorded on
// the engine (pass 3's jsonl snapshots) and small edits of them for the cases no run recorded.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framesOf, loadJournal, snapshotRecords } from '../../../test/support/fixtures';
import { readRestoredCost } from './restored-cost';

const dir = mkdtempSync(join(tmpdir(), 'maws-restored-cost-'));
let files = 0;
const transcript = (records: readonly unknown[]): string => {
  const path = join(dir, `t-${files++}.jsonl`);
  writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
  return path;
};
const isCostState = (record: { type: string }) => record.type === 'cost-state';
const resultTotals = (name: string) =>
  framesOf(loadJournal('pass3', name), 'in').flatMap(({ frame }) => ((frame as { type?: string }).type === 'result' ? [(frame as { total_cost_usd: number }).total_cost_usd] : []));

// p1-side-thread-live-fork ran a session's first process (it recorded 0.0031984 at exit); p1-side-thread-live-resume
// resumed it, and its process recorded 0.00593705 (0.0031984 restored, plus its own turn) after its own records.
const SIDE = 'aadd13c2-9cb1-4d9b-8b1f-3ff7c7d95599';
const resumed = snapshotRecords(loadJournal('pass3', 'p1-side-thread-live-resume'), 'side-thread-child-after-resume');
// what the disk holds when the resumed process is killed (SIGKILL) before it can record its total: no last cost-state
const killed = resumed.slice(0, resumed.findLastIndex(isCostState));

describe('readRestoredCost', () => {
  it('reads the last cost-state the session recorded: the figure a resumed process restores', async () => {
    expect(resumed.filter(isCostState).map((record) => record.totalCostUSD)).toEqual([0.0031983999999999997, 0.005937049999999999]);
    expect(await readRestoredCost(transcript(resumed), SIDE)).toBe(0.005937049999999999);
  });

  it('after a process killed before it recorded its total, the older cost-state is the last: the one its successor restores', async () => {
    expect(await readRestoredCost(transcript(killed), SIDE)).toBe(0.0031983999999999997);
  });

  it('scans back across chunk edges, a line cut by an edge included, and stops at the bound', async () => {
    const path = transcript(killed);
    for (const chunk of [7, 64, 1000, 4096]) expect(await readRestoredCost(path, SIDE, undefined, undefined, chunk)).toBe(0.0031983999999999997);
    // the bound in bytes from the end: a cost-state line it does not wholly hold cannot be read, and the scan cannot say
    // (null) rather than read 0; one byte more than the line and the newline before it, and it is read
    const at = killed.findLastIndex(isCostState);
    const after = Buffer.byteLength(killed.slice(at + 1).map((record) => `${JSON.stringify(record)}\n`).join(''));
    const line = Buffer.byteLength(`${JSON.stringify(killed[at])}\n`);
    expect(await readRestoredCost(path, SIDE, undefined, after + line - 1, 256)).toBeNull();
    expect(await readRestoredCost(path, SIDE, undefined, after + line + 1, 256)).toBe(0.0031983999999999997);
  });

  it('takes only a whole cost-state record of the session: not another session’s, not a line that merely names one', async () => {
    const others = [
      ...killed,
      { type: 'cost-state', sessionId: 'another-session', totalCostUSD: 9 },
      { type: 'user', sessionId: SIDE, uuid: 'u-q', message: { role: 'user', content: 'what is a "cost-state" record?' } },
      { type: 'cost-state', sessionId: SIDE, totalCostUSD: 'n/a' },
    ];
    expect(await readRestoredCost(transcript(others), SIDE)).toBe(0.0031983999999999997);
  });

  it('a transcript that holds none restored nothing (0); a missing one cannot say (null)', async () => {
    expect(await readRestoredCost(transcript(resumed.filter((record) => !isCostState(record))), SIDE)).toBe(0);
    expect(await readRestoredCost(join(dir, 'missing.jsonl'), SIDE)).toBeNull();
  });

  // Why a fork's restored part is not read here (the tracker row's fork half): p1-fork-session-flag forked
  // p1-fork-start's session, whose process ended at 0.0286328, and the fork's first total, 0.0312723, carries it (its own
  // turn costs the rest). The fork's own transcript copies the source's messages but none of its cost-state: while the
  // fork's first process runs it holds none, and the one it writes at exit already sums the source's figure with its own.
  it('a fork’s own transcript carries none of its source’s cost-state (p1-fork-session-flag)', async () => {
    const FORK = 'bfdf4123-a931-4896-abd3-1f99c542f54e';
    const fork = snapshotRecords(loadJournal('pass3', 'p1-fork-session-flag'), 'fork-child');
    expect(resultTotals('p1-fork-start')).toEqual([0.028632750000000002]);
    expect(resultTotals('p1-fork-session-flag')).toEqual([0.0312723]);
    expect(fork.filter(isCostState).map((record) => [record.sessionId, record.totalCostUSD])).toEqual([[FORK, 0.0312723]]);
    expect(await readRestoredCost(transcript(fork.slice(0, fork.findLastIndex(isCostState))), FORK)).toBe(0);
  });
});
