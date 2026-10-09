// P2-A M3 (G4; the execution document §6.2 M3, the W7 regression): acquisition keeps W7's single-writer rule. A terminal
// that resumes the conversation while MAWS acquires is found by the guards (the trust bootstrap's holder re-check) and
// nothing launches; one that resumes it after MAWS launched contends as W7 defines — MAWS's process stays the session's,
// contested, another surface's acquisition joins that process (no second launch), MAWS yields once it is idle, the
// session is the terminal's (read-only, `foreign_held`) until the terminal exits, and only then does a gesture launch
// again. That MAWS's branch stays pinned in the transcript while contested and refolds at the terminal's exit is the
// host follower's (`src/engine-host/fs/service.test.ts`, "a contested session (W7)"); here main's side of it: the index's
// holder projection, availability, the yield and every launch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import { humanTurn } from '../../../test/support/builders';
import { availabilityOf } from './availability';
import { startYield } from './yield';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const TERMINAL = { kind: 'terminal' as const, pid: 96367 };
let n = 0;

describe('W7 under acquisition: one writer at every point', () => {
  let h: SessionHarness;
  let stopYield: () => void;
  const notices: unknown[] = [];
  beforeEach(async () => {
    h = await new SessionHarness().start();
    h.trustDirectory(h.work);
    notices.length = 0;
    // main's W7 wiring (src/main/index.ts), over the harness's host and index
    stopYield = startYield({ dispatch: h.host.dispatch, onEvent: h.host.onEvent, sessions: h.index.sessions, emit: ((name: string, payload: unknown) => void notices.push({ name, payload })) as never, log: () => {} });
  });
  afterEach(() => {
    stopYield();
    h.dispose();
  });

  const recordAt = (dir = h.work): SessionRecord => h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x7a000 + ++n), directory: dir })).record;
  const availability = (id: AppSessionId) => availabilityOf(h.index.sessions.get(id)!, h.host.table.get(id) ?? null, h.memory.get(id) ?? null);
  const launchesOf = (id: AppSessionId) => h.host.launches.filter((spec) => spec.appSessionId === id);
  const fire = <N extends EventName>(name: N, payload: EventPayload<N>) => h.host.emitEvent(name, payload);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  // the registry's view of the terminal, as C4's holder scan reports it: the row for the guards' fresh read, the change for the index
  const terminalStarts = (record: SessionRecord) => {
    h.host.hold(record.engineSessionId!, TERMINAL, record.directory);
    fire('fs.holderChanged', { sessionId: record.engineSessionId as SessionId, appSessionId: record.appId, holder: TERMINAL, registry: null, job: null });
  };
  const terminalExits = (record: SessionRecord) => {
    h.host.disk.registry.length = 0;
    fire('fs.holderChanged', { sessionId: record.engineSessionId as SessionId, appSessionId: record.appId, holder: { kind: 'none' }, registry: null, job: null });
  };
  const status = (id: AppSessionId) => h.host.table.get(id)!;

  it('a terminal that resumes the session during the trust bootstrap is found by the re-check: held, the session never launched', async () => {
    const untrusted = h.dir('untrusted');
    const record = recordAt(untrusted);
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'needs_trust' });
    // the bootstrap (its own id) takes its seconds; the terminal resumes the conversation meanwhile
    h.host.script = (spec) => ({ onReady: () => void (spec.appSessionId !== record.appId && h.host.hold(record.engineSessionId!, TERMINAL, untrusted)) });
    expect(await h.service.acquire(record.appId, 'send', { trust: 'accepted' })).toMatchObject({ status: 'held', holder: TERMINAL });
    expect(h.host.launches.map((spec) => spec.appSessionId === record.appId)).toEqual([false]); // the bootstrap only
    expect(h.host.calledWith('session.send')).toEqual([]);
    // the registry's change reaches the index: read-only with the holder's actions, and the next gesture is held too
    fire('fs.holderChanged', { sessionId: record.engineSessionId as SessionId, appSessionId: record.appId, holder: TERMINAL, registry: null, job: null });
    expect(availability(record.appId)).toBe('foreign_held');
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'held' });
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('a terminal that resumes it after MAWS launched contends: MAWS stays usable while its turn runs, a joined gesture launches nothing, and the terminal’s exit leaves it MAWS’s', async () => {
    const record = recordAt();
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'ready', launched: true });
    await settle();
    expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'self' });

    // MAWS's turn runs; the terminal resumes the id and writes its sibling branch
    h.host.reserve(record.appId, { ...status(record.appId), turn: humanTurn, keepAlive: ['turn'] });
    fire('session.status', { appSessionId: record.appId, status: status(record.appId) });
    terminalStarts(record);
    expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'self', contestedBy: TERMINAL });
    expect(availability(record.appId)).toBe('usable');
    fire('fs.foreignWrite', { sessionId: record.engineSessionId as SessionId, appSessionId: record.appId, holder: TERMINAL });
    await settle();
    expect(notices).toHaveLength(1); // W7's notice in the session
    expect(h.host.calledWith('session.stop')).toEqual([]); // the turn finishes first

    // another surface's gesture meanwhile (a Load now, a chip) joins MAWS's own process: never a second writer
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'ready', launched: false });
    expect(launchesOf(record.appId)).toHaveLength(1);

    // the terminal exits before MAWS yields: plain self again, usable, still the one launch
    terminalExits(record);
    expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'self' });
    expect(availability(record.appId)).toBe('usable');
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  it('MAWS idle when the terminal writes: it yields, the session is the terminal’s and refuses every gesture, and only the terminal’s exit lets a gesture launch', async () => {
    const record = recordAt();
    await h.service.acquire(record.appId, 'send');
    await settle();
    terminalStarts(record);
    fire('fs.foreignWrite', { sessionId: record.engineSessionId as SessionId, appSessionId: record.appId, holder: TERMINAL });
    await h.until(() => status(record.appId).process === 'exited');
    expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: record.appId, reason: 'stop', ifIdle: true }]);
    await settle();
    expect(h.index.sessions.get(record.appId)!.holder).toEqual(TERMINAL);
    expect(availability(record.appId)).toBe('foreign_held');

    // every gesture while the terminal holds it: held, nothing launched (the guards' fresh registry read)
    for (const reason of ['send', 'chip', 'read'] as const) expect(await h.service.acquire(record.appId, reason)).toMatchObject({ status: 'held', holder: TERMINAL });
    expect(launchesOf(record.appId)).toHaveLength(1);

    // the terminal exits: the session folds back to resumable, and the next gesture launches it once, the only writer
    terminalExits(record);
    expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'none' });
    expect(availability(record.appId)).toBe('resumable');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'ready', launched: true });
    expect(launchesOf(record.appId)).toHaveLength(2);
    expect(availability(record.appId)).toBe('usable');
  });
});
