// P2-A M3 (G5; the execution document §6.2 M3, the resource regression's main half): hundreds of indexed sessions cost
// zero processes. (a) An app restart over an index of 200 records — exited rows the detached supervisor kept (stopped,
// crashed, released by the budget or the idle clock, some with a persisted queue), discovered sessions never run, and
// unstarted tabs (setup intents) — hydrates the read model and launches nothing: zero `session.launch`, zero
// acquisitions, zero starts, every digest carrying an availability that offers a start and none that says one runs.
// (d) A no-prompt acquisition and its stop leave the session's last activity where it was: the transcript the engine
// touches then (M0's U1: mtime at launch, a `mode` and a `cost-state` record appended at the stop, neither with a uuid)
// is summarised with the same `lastRecordAt`, so the index does not advance it and the digest seed does not move.
import { appendFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import type { SessionId } from '@shared/graph/ids';
import type { QueueEntry } from '@shared/engine/session-state-store';
import { resolveStorePaths } from '../../engine-host/fs/paths';
import { Discovery } from '../../engine-host/fs/discovery';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import { T0 } from '../../../test/support/builders';
import { hostEventSource } from '.';
import { SessionReadModel } from './read-model';
import { SessionService } from './service';

const RECORDS = 200;
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('G5: many indexed sessions start zero engines', () => {
  let h: SessionHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
    vi.restoreAllMocks();
  });

  it('an app restart over 200 records, kept exited rows and unstarted tabs hydrates every digest and launches nothing', async () => {
    const model = new SessionReadModel('index');
    h = await new SessionHarness({ readModel: model }).start();
    h.trustDirectory(h.work);

    // the history: 200 sessions in the index, the first 40 run by MAWS before the quit and left as exited rows of every
    // kind (a stop, a crash, the budget's release, the idle clock), every fourth of them with messages in its queue
    const records = Array.from({ length: RECORDS }, (_, i) => h!.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x5000 + i), directory: h!.work })).record);
    const reasons = ['stop', 'crash', 'budget', 'idle'] as const;
    for (const [i, record] of records.slice(0, 40).entries()) {
      h.host.reserve(record.appId, { cwd: h.work, engineSessionId: record.engineSessionId, process: 'exited', exit: { code: null, signal: null, reason: reasons[i % 4], at: T0, release: null } });
      if (i % 4 === 0) {
        const entry: QueueEntry = { queueId: `q-${i}`, appSessionId: record.appId, content: 'held', createdAt: T0, state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
        h.host.disk.queues.set(record.appId, [entry]);
      }
    }
    // three unstarted tabs (C10's setup intents survive the restart; their first message starts them, nothing else)
    const intents = await Promise.all([0, 1, 2].map(async () => (await h!.service.create({ projectId: null, location: { kind: 'directory', path: h!.work } })).appSessionId));

    // every product launch path, counted across the restart
    const acquire = vi.spyOn(SessionService.prototype, 'acquire');
    const start = vi.spyOn(SessionService.prototype, 'startSession');
    const takeOver = vi.spyOn(SessionService.prototype, 'takeOver');

    // the quit and the relaunch onto the supervisor that kept its rows; the read model hydrates from the index and from
    // the host's resync (every kept row's status, as the supervisor runs it between its connect and its `ready` line)
    await h.restart({ keep: true });
    let resync: ((dispatch: SessionHarness['host']['dispatch'], signal: AbortSignal) => Promise<void>) | null = null;
    const host = h.host;
    model.register(hostEventSource({ onEvent: host.onEvent, onState: () => () => {}, setResync: (_owner: string, run: unknown) => void (resync = run as never) } as never, () => {}));
    await resync!(host.dispatch, new AbortController().signal);
    await settle();

    expect(host.calledWith('session.launch')).toEqual([]);
    expect(host.launches).toEqual([]);
    expect(host.calledWith('session.send')).toEqual([]);
    expect(host.calledWith('session.steer')).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(takeOver).not.toHaveBeenCalled();
    expect(h.memory.size).toBe(0); // no acquisition ever began

    // every record hydrated with an availability; none starting or usable, the kept rows' queues untouched
    const digests = new Map(model.digests().map((d) => [d.appSessionId, d]));
    for (const record of records) expect(digests.get(record.appId)?.availability, record.appId).toBe('resumable');
    expect(model.digests().filter((d) => d.availability === 'starting' || d.availability === 'usable')).toEqual([]);
    expect([...host.disk.queues.values()].flat().map((e) => e.state)).toEqual(Array(10).fill('queued'));
    expect(await Promise.all(intents.map(async (id) => {
      const intent = await h!.service.getIntent(id);
      return intent === null ? 'gone' : intent.message;
    }))).toEqual([null, null, null]);
  });
});

// The setup turn of M0's scratch session as its transcript holds it (the probe's journal
// `pass3/p2-no-prompt-resume-setup.jsonl`: the user frame replayed at seq 34 and the assistant frame at seq 38, each with
// its uuid and timestamp), and the two records the engine appended at the no-prompt resume's stop (findings §5:
// `type:"mode"`, `mode:"normal"`, and `type:"cost-state"`, the session id unchanged, the setup's cost kept; no uuid).
const SETUP = 'pass3/p2-no-prompt-resume-setup.jsonl';
function transcriptOfSetup(cwd: string): { sessionId: SessionId; lines: string; lastAt: string } {
  const frames = readFileSync(join(__dirname, '../../../spikes/protocol-probe/fixtures', SETUP), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { direction: string; frame: Record<string, unknown> });
  const turn = frames.filter((f) => f.direction === 'in' && (f.frame.type === 'user' || f.frame.type === 'assistant') && typeof f.frame.uuid === 'string').map((f) => f.frame);
  expect(turn.map((f) => f.type)).toEqual(['user', 'assistant']);
  const sessionId = turn[0].session_id as SessionId;
  let parentUuid: string | null = null;
  const records = turn.map((f) => {
    const record = { parentUuid, isSidechain: false, userType: 'external', cwd, sessionId, version: '2.1.295', type: f.type, message: f.message, uuid: f.uuid, timestamp: f.timestamp, entrypoint: 'sdk-ts' };
    parentUuid = f.uuid as string;
    return record;
  });
  return { sessionId, lines: records.map((r) => JSON.stringify(r)).join('\n') + '\n', lastAt: turn[1].timestamp as string };
}
const STOP_RECORDS = (sessionId: SessionId) =>
  [
    { type: 'mode', mode: 'normal', sessionId },
    { type: 'cost-state', sessionId, totalCostUSD: 0.0024006, totalAPIDuration: 1421, totalAPIDurationWithoutRetries: 1397, totalDuration: 59450, modelUsage: {} },
  ]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n';

describe('G5: an acquisition with no prompt does not move the session’s last activity', () => {
  let h: SessionHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });

  it('a no-prompt acquisition and its stop leave lastRecordAt, the index’s advance and the digest seed where they were', async () => {
    const model = new SessionReadModel('index');
    h = await new SessionHarness({ readModel: model }).start();
    h.trustDirectory(h.work);
    const { sessionId, lines, lastAt } = transcriptOfSetup(h.work);
    const path = h.writeTranscript(h.work, sessionId, lines);
    const discovery = new Discovery(resolveStorePaths({ CLAUDE_CONFIG_DIR: h.trust.configHome }));
    const before = (await discovery.summarizeOne(path))!;
    expect(before.lastRecordAt).toBe(lastAt);
    const record = h.index.sessions.upsertFromSummary(before).record;
    await settle();
    const seed = model.digests().find((d) => d.appSessionId === record.appId)!;
    expect(seed.lastTurnEndedAt).toBe(lastAt);

    // the acquisition (the engine touches the file's mtime at launch, its bytes identical), then the stop appends the two
    // metadata records; nothing else is written: no prompt was sent
    h.host.script = () => ({ onReady: () => utimesSync(path, new Date(), new Date()) });
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'ready', launched: true });
    expect(h.host.calledWith('session.send')).toEqual([]);
    await h.host.dispatch('engine-host', 'session.stop', { appSessionId: record.appId, reason: 'stop' });
    appendFileSync(path, STOP_RECORDS(sessionId));

    const after = (await discovery.summarizeOne(path))!;
    expect(after.size).toBeGreaterThan(before.size); // the file did change
    expect(after.lastRecordAt).toBe(before.lastRecordAt);
    expect(after.leafUuid).toBe(before.leafUuid);
    const upsert = h.index.sessions.upsertFromSummary(after);
    expect(upsert.advanced).toBe(false); // the index's own "something new happened" (the unread rule)
    expect(h.index.sessions.summaryOf(record.appId)?.lastRecordAt).toBe(lastAt);
    await settle();
    expect(model.digests().find((d) => d.appSessionId === record.appId)?.lastTurnEndedAt).toBe(lastAt);
  });

  it('control: a record with a uuid appended after the stop does advance it (the rule this pins is lastRecordAt’s, not a frozen file)', async () => {
    h = await new SessionHarness().start();
    const { sessionId, lines } = transcriptOfSetup(h.work);
    const path = h.writeTranscript(h.work, sessionId, lines);
    const discovery = new Discovery(resolveStorePaths({ CLAUDE_CONFIG_DIR: h.trust.configHome }));
    h.index.sessions.upsertFromSummary((await discovery.summarizeOne(path))!);
    appendFileSync(path, JSON.stringify({ parentUuid: null, type: 'user', uuid: '99999999-9999-4999-8999-999999999999', timestamp: '2026-10-09T08:00:00.000Z', sessionId, message: { role: 'user', content: 'later' } }) + '\n');
    const after = (await discovery.summarizeOne(path))!;
    expect(after.lastRecordAt).toBe('2026-10-09T08:00:00.000Z');
    expect(h.index.sessions.upsertFromSummary(after).advanced).toBe(true);
  });
});
