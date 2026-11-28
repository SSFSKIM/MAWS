// The steps a test does to a seeded record (./sheet-records.ts, `rewriteState`), read back by the service's own reader:
// the e2e cases that add and withdraw a question stand on these records being ones MAWS reads.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRecord } from '../../src/services/sheet/reader';
import { asked, closedAnswered, closedDismissed, oneCall, revised, rewriteState, seedRecord, withdrawn } from './sheet-records';

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

  // The question sheet's C3 M6 (the built look, e2e/support/sheet-look.ts): a fixture seeded under another session, its
  // questions made one call's, one rewritten while a draft stands, and the call's three outcomes
  it('a record seeded under another session is that session’s; its questions made one call’s are read so', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sheet-records-'));
    homes.push(home);
    const other = '5eed0000-0000-4000-8000-00000000c3a1';
    expect(seedRecord(home, 'batch', 'before', other)).toBe(other);
    rewriteState(home, other, oneCall('toolu_01Look0001'));
    const model = await modelOf(home, other);
    expect(model.session).toBe(other);
    expect(model.open.map((q) => [q.id, q.callId, q.asker])).toEqual([['q1', 'toolu_01Look0001', 'main'], ['q2', 'toolu_01Look0001', 'main'], ['q3', 'toolu_01Look0001', 'main']]);
  });

  it('a question rewritten is read open at its next revision in its new words; answered and dismissed ones are read closed so', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sheet-records-'));
    homes.push(home);
    const session = seedRecord(home, 'batch');
    rewriteState(home, session, revised('q1', 'Which auth method should the beta use?'));
    const rewritten = await modelOf(home, session);
    expect(rewritten.open.find((q) => q.id === 'q1')).toMatchObject({ revision: 2, question: 'Which auth method should the beta use?', callId: 'toolu_01Auth0001' });
    rewriteState(home, session, closedAnswered('q1', ['OAuth'], 'page-c3a1a001', '2026-11-23T09:10:00.000Z'));
    rewriteState(home, session, closedDismissed('q2', 'page-c3a1d002', '2026-11-23T09:10:00.000Z'));
    const after = await modelOf(home, session);
    expect(after.open.map((q) => q.id)).toEqual(['q3']);
    expect(after.closed.q1).toMatchObject({ how: 'answered', receipt: 'OAuth', places: [1], revision: 2, header: 'Auth method' });
    expect(after.closed.q2).toMatchObject({ how: 'dismissed', revision: 1, asker: { agentId: 'a1b2c3', name: 'reviewer' } });
  });
});
