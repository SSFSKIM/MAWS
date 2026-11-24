// The steps a test does to a seeded record (./sheet-records.ts, `rewriteState`), read back by the service's own reader:
// the e2e cases that add and withdraw a question stand on these records being ones MAWS reads.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRecord } from '../../src/services/sheet/reader';
import { asked, rewriteState, seedRecord, withdrawn } from './sheet-records';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const modelOf = async (home: string, session: string) => {
  const read = await readRecord(home, session);
  if (read === null || !('model' in read)) throw new Error(`not read: ${JSON.stringify(read)}`);
  return read.model;
};

describe('a seeded record rewritten by a test’s step', () => {
  it('a question asked is read open under the next id; one withdrawn is read closed as withdrawn', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sheet-records-'));
    homes.push(home);
    const session = seedRecord(home, 'batch');
    const before = await modelOf(home, session);
    rewriteState(home, session, asked('Which colour for the badge?', '2026-11-23T09:05:00.000Z', 'toolu_01Badge0004'));
    const added = await modelOf(home, session);
    expect(added.seq).toBe(before.seq + 1);
    expect(added.open.map((q) => [q.id, q.question])).toEqual([...before.open.map((q) => [q.id, q.question]), ['q4', 'Which colour for the badge?']]);
    rewriteState(home, session, withdrawn('q2', '2026-11-23T09:06:00.000Z'));
    const after = await modelOf(home, session);
    expect(after.open.map((q) => q.id)).toEqual(['q1', 'q3', 'q4']);
    expect(after.closed.q2).toMatchObject({ how: 'withdrawn', asker: { agentId: 'a1b2c3', name: 'reviewer' }, revision: 1 });
  });
});
