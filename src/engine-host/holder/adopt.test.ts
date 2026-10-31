// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): which live session hosts a
// start adopts. Each through the launcher's adopt, in parallel; a host of another protocol major left running and counted
// as failed; of two hosts naming one session the newest adopted and the other left, counted; a host holding no engine
// handed to the adopt (which releases it) and not counted when that ends it; a failed adoption counted with its reason.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { adoptable, adoptAll } from './adopt';
import type { RosterEntry } from './roster';

const entry = (holderId: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  protocol: 1, holderId, pid: 4242, procStart: 'start', startedAt: '2026-10-31T10:00:00.000Z', socket: `/x/${holderId}.sock`,
  binary: '/x/maws-session-host', appSessionId: `app-${holderId}`, engineSessionId: 'eng', state: 'running', child: { pid: 4243, procStart: 'child' }, fence: 1, exit: null, ...over,
});

describe('adoptable', () => {
  it('takes this major\'s hosts, the newest per session, and the hosts holding no engine; leaves the rest with their reason', () => {
    const older = entry('older001', { appSessionId: 'app-shared', startedAt: '2026-10-31T09:00:00.000Z' });
    const newer = entry('newer001', { appSessionId: 'app-shared', startedAt: '2026-10-31T10:00:00.000Z' });
    const empty = entry('empty001', { appSessionId: 'app-shared', child: null, state: 'ready', startedAt: '2026-10-31T11:00:00.000Z' });
    const major = entry('major002', { protocol: 2 });
    const { take, leave } = adoptable([older, newer, empty, major]);
    expect(take.map((e) => e.holderId).sort()).toEqual(['empty001', 'newer001']);
    expect(leave.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([
      ['older001', 'a newer session host (newer001) holds its session; left running'],
      ['major002', 'it speaks session host protocol 2, not 1; left running'],
    ]);
  });
});

describe('adoptAll', () => {
  it('adopts in parallel; counts a failure and a host left, never a host released for holding no engine', async () => {
    const started: string[] = [];
    const lines: string[] = [];
    const outcome = await adoptAll([entry('good0001'), entry('bad00001'), entry('empty001', { child: null }), entry('major002', { protocol: 2 })], {
      adopt: async (e) => {
        started.push(e.holderId);
        await new Promise((done) => setTimeout(done, 10));
        if (e.holderId === 'good0001') return e.appSessionId as AppSessionId;
        throw new Error(e.child === null ? 'it holds no engine (running); released' : 'the session has no stored launch spec');
      },
      log: (line) => void lines.push(line),
    });
    expect(started).toEqual(['empty001', 'good0001', 'bad00001']); // all begun before any ended
    expect(outcome.adopted).toEqual(['app-good0001']);
    expect(outcome.failed.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([
      ['major002', 'it speaks session host protocol 2, not 1; left running'],
      ['bad00001', 'the session has no stored launch spec'],
    ]);
    expect(lines).toContain('session host bad00001 (pid 4242) not adopted: the session has no stored launch spec');
  });
});
