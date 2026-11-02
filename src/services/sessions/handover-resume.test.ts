// P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, D58 and D58a): an adopted engine whose re-initialize
// after the handover failed is ended through the ladder, its exit carrying `cause: handover-reinit-failed`; the session
// service resumes it at once, as resume.ts retries `no_output` once: one resume per failed launch, and a resume that
// itself fails is told as any other, never retried. Over the session service, the fake host and C4's real index.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { HANDOVER_REINIT_FAILED, type ExitCause } from '@shared/graph/enums';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import { T0 } from '../../../test/support/builders';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CAUSE = { kind: HANDOVER_REINIT_FAILED, detail: 're-initialize after the handover failed: the engine’s output closed before it answered' } as const;
let n = 0;

describe('the resume of an adopted session whose re-initialize failed', () => {
  let h: SessionHarness;
  beforeEach(async () => {
    h = await new SessionHarness({ exitWaitMs: 300 }).start();
    h.trustDirectory(h.work);
  });
  afterEach(() => h.dispose());

  const recordAt = (sessionId: SessionId = sessionIdFor(0xd58a0 + ++n)): SessionRecord => h.index.sessions.upsertFromSummary(summary({ sessionId, directory: h.work })).record;
  const launchesOf = (id: AppSessionId) => h.host.launches.filter((spec) => spec.appSessionId === id);
  // the adopted launch, ready under the successor, then ended (the host's status, as session.ts reports the exit)
  const adoptedThenEnded = (id: AppSessionId, cause?: ExitCause) => {
    const adopted = h.host.reserve(id, { cwd: h.work, process: 'ready', launchId: 'L-adopted', engineSessionId: h.index.sessions.get(id)!.engineSessionId });
    const exited: EngineSessionStatus = { ...adopted, process: 'exited', exit: { code: null, signal: 'SIGTERM', reason: 'crash', at: T0, release: null, ...(cause && { cause }) } };
    h.host.table.set(id, exited);
    h.host.emitEvent('session.status', { appSessionId: id, status: exited });
    return exited;
  };

  it('is resumed once, at once: one launch, resuming the conversation', async () => {
    const record = recordAt();
    adoptedThenEnded(record.appId, CAUSE);
    await h.until(() => launchesOf(record.appId).length === 1);
    expect(launchesOf(record.appId)[0]).toMatchObject({ resume: { sessionId: record.engineSessionId } });
    await h.until(() => h.host.table.get(record.appId)?.process === 'ready' && h.memory.get(record.appId)?.inFlight === false); // the acquisition ended
    expect(h.memory.get(record.appId)).toMatchObject({ inFlight: false, last: null });
  });

  it('gives up at the bound: a resume that fails is not retried, and the same exit told again resumes nothing more', async () => {
    const record = recordAt();
    h.host.script = () => ({ exit: { error: 'the engine refused to start' } });
    const exited = adoptedThenEnded(record.appId, CAUSE);
    await h.until(() => launchesOf(record.appId).length === 1);
    await h.until(() => h.host.table.get(record.appId)?.process === 'exited');
    h.host.emitEvent('session.status', { appSessionId: record.appId, status: exited }); // the adopted launch's exit again
    await sleep(200);
    expect(launchesOf(record.appId)).toHaveLength(1);
    expect(h.memory.get(record.appId)?.last).toMatchObject({ kind: 'failed' }); // told as any failed resume
  });

  it('an exit without the cause (a crash of its own) is left to the owner', async () => {
    const record = recordAt();
    adoptedThenEnded(record.appId);
    await sleep(200);
    expect(launchesOf(record.appId)).toEqual([]);
  });
});
