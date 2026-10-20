// P2-A M1 (X16; the execution document §5.3 and §6.2's lifecycle table): `session.acquire` over the session service, the
// fake host and C4's real index. Each row asserts availability before and after (derived from the index's record, the
// host's status and the memory the service publishes), the outcome, the number of `session.launch` calls and, where a
// launch happens, that its spec carries the session's cua socket (E13: `runResume` is the only launcher).
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import { DOWN_RELAY } from '../../../test/support/session-host';
import { T0 } from '../../../test/support/builders';
import { availabilityOf } from './availability';
import { parseProcesses } from './pane-holder';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const SOCKET = (id: string) => `/u/browser/cua/${id}.sock`;
const OK_MESSAGE = { content: 'Reply OK', display: 'Reply OK' };
let n = 0;

describe('session.acquire: the lifecycle table', () => {
  let h: SessionHarness;
  beforeEach(async () => {
    h = await new SessionHarness({ browserBackend: SOCKET, exitWaitMs: 300 }).start();
    h.trustDirectory(h.work);
  });
  afterEach(() => h.dispose());

  const recordAt = (dir = h.work, sessionId: SessionId = sessionIdFor(0xac000 + ++n)): SessionRecord => h.index.sessions.upsertFromSummary(summary({ sessionId, directory: dir })).record;
  const availability = (id: AppSessionId) => availabilityOf(h.index.sessions.get(id)!, h.host.table.get(id) ?? null, h.memory.get(id) ?? null);
  const launchesOf = (id: AppSessionId): LaunchSpec[] => h.host.launches.filter((spec) => spec.appSessionId === id);
  const ready = (launched: boolean, joined = false) => ({ status: 'ready', launched, joined });
  // A launch it made, carrying the session's own cua socket.
  const expectOneLaunch = (id: AppSessionId) => {
    expect(launchesOf(id)).toHaveLength(1);
    expect(launchesOf(id)[0]).toMatchObject({ resume: { sessionId: h.index.sessions.get(id)!.engineSessionId }, extraSettings: { env: { CUA_BROWSER_BACKENDS: SOCKET(id) } } });
  };
  const exitedAs = (id: AppSessionId, reason: 'stop' | 'crash' | 'budget' | 'idle') => {
    const live = h.host.table.get(id)!;
    h.host.table.set(id, { ...live, process: 'exited', exit: { code: null, signal: null, reason, at: T0, release: null } });
  };

  it('disk-only, never run: resumable, then launched once and usable', async () => {
    const record = recordAt();
    expect(availability(record.appId)).toBe('resumable');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject(ready(true));
    expectOneLaunch(record.appId);
    expect(availability(record.appId)).toBe('usable');
    expect(h.host.calledWith('session.send'), 'acquisition sends nothing').toEqual([]);
  });

  it.each(['stop', 'crash', 'budget', 'idle'] as const)('a retained exited row (%s) is resumable and launches once', async (reason) => {
    const record = recordAt();
    await h.service.acquire(record.appId, 'resume');
    exitedAs(record.appId, reason);
    expect(availability(record.appId)).toBe('resumable');
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject(ready(true));
    expect(launchesOf(record.appId)).toHaveLength(2);
    expect(launchesOf(record.appId)[1]).toMatchObject({ extraSettings: { env: { CUA_BROWSER_BACKENDS: SOCKET(record.appId) } } });
    expect(availability(record.appId)).toBe('usable');
  });

  it('an evicted row (no status at all) is resumable and launches once', async () => {
    const record = recordAt();
    await h.service.acquire(record.appId, 'resume');
    h.host.table.delete(record.appId);
    expect(availability(record.appId)).toBe('resumable');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject(ready(true));
    expect(launchesOf(record.appId)).toHaveLength(2);
  });

  it('a ready session answers at once and launches nothing', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'ready' });
    expect(availability(record.appId)).toBe('usable');
    expect(await h.service.acquire(record.appId, 'chip')).toMatchObject(ready(false));
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('W7’s contested self (a terminal holder projected, MAWS’s process ready) answers ready and launches nothing', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'ready' });
    h.index.sessions.setHolder(record.engineSessionId!, { kind: 'terminal', pid: 77 });
    expect(availability(record.appId)).toBe('usable');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject(ready(false));
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('a launch already starting is joined: one launch, the joiner answered joined', async () => {
    const record = recordAt();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.host.script = () => ({ onReady: () => gate });
    const first = h.service.acquire(record.appId, 'send');
    await h.until(() => launchesOf(record.appId).length === 1);
    expect(availability(record.appId)).toBe('starting');
    const second = h.service.acquire(record.appId, 'read');
    release();
    expect(await first).toMatchObject(ready(true, false));
    expect(await second).toMatchObject(ready(true, true));
    expectOneLaunch(record.appId);
    expect(availability(record.appId)).toBe('usable');
  });

  it('an exiting process is waited out, then launched once', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'exiting' });
    const acquiring = h.service.acquire(record.appId, 'send');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launchesOf(record.appId)).toEqual([]);
    exitedAs(record.appId, 'stop');
    expect(await acquiring).toMatchObject(ready(true));
    expectOneLaunch(record.appId);
  });

  it('a process still exiting after the bound fails the attempt with no launch, and the next one retries', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'exiting' });
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'failed', message: 'The session is still stopping.' });
    expect(launchesOf(record.appId)).toEqual([]);
    expect(h.memory.get(record.appId)).toMatchObject({ inFlight: false, last: { kind: 'failed', message: 'The session is still stopping.' } });
    exitedAs(record.appId, 'stop');
    expect(availability(record.appId)).toBe('failed');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject(ready(true));
    expect(h.memory.get(record.appId)).toEqual({ inFlight: false, last: null });
  });

  it('a session archived while the attempt waited on its exit is answered archived, launches nothing and stays archived', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'exiting' });
    const acquiring = h.service.acquire(record.appId, 'send');
    await new Promise((resolve) => setTimeout(resolve, 20));
    h.index.sessions.update(record.appId, { archived: true });
    exitedAs(record.appId, 'stop');
    expect(await acquiring).toMatchObject({ status: 'archived' });
    expect(launchesOf(record.appId)).toEqual([]);
    expect(h.index.sessions.get(record.appId)!.archived).toBe(true);
  });

  it('a session deleted while the attempt waited on its exit is refused and launches nothing', async () => {
    const record = recordAt();
    h.host.reserve(record.appId, { cwd: h.work, process: 'exiting' });
    const acquiring = h.service.acquire(record.appId, 'send');
    await new Promise((resolve) => setTimeout(resolve, 20));
    h.index.sessions.remove(record.appId);
    exitedAs(record.appId, 'stop');
    expect(await acquiring).toMatchObject({ status: 'refused', reason: 'unknown_session' });
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('a foreign holder is answered held and nothing launches', async () => {
    const record = recordAt();
    h.host.hold(record.engineSessionId!, { kind: 'terminal', pid: 42 }, h.work);
    h.index.sessions.setHolder(record.engineSessionId!, { kind: 'terminal', pid: 42 });
    expect(availability(record.appId)).toBe('foreign_held');
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'held', holder: { kind: 'terminal', pid: 42 }, attach: null });
    expect(launchesOf(record.appId)).toEqual([]);
    expect(availability(record.appId)).toBe('foreign_held');
  });

  it('an archived session is answered archived; nothing is unarchived and nothing launches', async () => {
    const record = recordAt();
    h.index.sessions.update(record.appId, { archived: true });
    expect(availability(record.appId)).toBe('archived');
    expect(await h.service.acquire(record.appId, 'send')).toEqual({ status: 'archived', appSessionId: record.appId });
    expect(h.index.sessions.get(record.appId)!.archived).toBe(true);
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('a missing directory is answered missing_directory, remembered until the next attempt', async () => {
    const gone = h.dir('gone');
    const record = recordAt(gone);
    rmSync(gone, { recursive: true });
    expect(await h.service.acquire(record.appId, 'send')).toEqual({ status: 'missing_directory', appSessionId: record.appId, directory: gone });
    expect(availability(record.appId)).toBe('missing_directory');
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('an untrusted directory answers needs_trust and retains nothing; the continuation with trust accepted bootstraps, then launches', async () => {
    const untrusted = h.dir('untrusted');
    const record = recordAt(untrusted);
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'needs_trust', trust: { trustKey: untrusted } });
    expect(availability(record.appId)).toBe('needs_trust');
    expect(h.host.launches).toEqual([]);
    expect(await h.service.acquire(record.appId, 'send', { trust: 'accepted' })).toMatchObject(ready(true));
    expect(h.host.launches.map((spec) => spec.appSessionId === record.appId)).toEqual([false, true]); // the bootstrap under its own id, then the session
    expectOneLaunch(record.appId);
    expect(h.host.calledWith('session.send')).toEqual([]);
    expect(availability(record.appId)).toBe('usable');
  });

  it('the relay down at launch answers relay_unreachable with its health', async () => {
    const record = recordAt();
    h.host.script = () => ({ answer: { relay: DOWN_RELAY } });
    expect(await h.service.acquire(record.appId, 'send')).toEqual({ status: 'relay_unreachable', appSessionId: record.appId, health: DOWN_RELAY });
    expect(availability(record.appId)).toBe('resumable');
  });

  // The whole-branch review: the reply and the events travel on separate transports, so the renderer cannot tell an
  // acquisition's streamed end from a record start's by order; the acquisition's run tags its phases instead
  it('an acquisition’s own run streams every phase tagged `acquisition`; a record’s start streams untagged', async () => {
    const acquired = recordAt();
    h.host.script = () => ({ answer: { relay: DOWN_RELAY } });
    await h.service.acquire(acquired.appId, 'send');
    expect(h.setupEvents(acquired.appId).map((e) => [e.phase, e.acquisition])).toEqual([['launching', true], ['failed', true]]);
    const started = recordAt();
    expect(await h.service.startSession(started.appId, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    await h.settled(started.appId);
    expect(h.setupEvents(started.appId).map((e) => [e.phase, e.acquisition])).toEqual([['launching', undefined], ['failed', undefined]]);
  });

  // F-AB (scale review B scalpel-1#1): a record's start that reaches ready is MAWS's last start of it, so the failure
  // an earlier acquisition remembered no longer describes the session once that process exits.
  it('a failed acquisition’s memory is cleared by a record start that reaches ready', async () => {
    const record = recordAt();
    h.host.script = () => ({ exit: { error: 'the model is not available' } });
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'failed' });
    expect(availability(record.appId)).toBe('failed');
    h.host.script = () => ({});
    expect(await h.service.startSession(record.appId, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    await h.settled(record.appId, 2); // the acquisition's failure was the first end
    await vi.waitFor(() => expect(availability(record.appId)).toBe('usable')); // the run's end follows its ready phase
    exitedAs(record.appId, 'stop');
    expect(availability(record.appId)).toBe('resumable');
    expect(h.memory.get(record.appId)).toMatchObject({ inFlight: false, last: null });
  });

  it('a launch that fails answers failed with the engine’s words, and is remembered as failed', async () => {
    const record = recordAt();
    h.host.script = () => ({ exit: { error: 'the model is not available' } });
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'failed', message: expect.stringContaining('the model is not available'), resources: { record: 'kept' } });
    expect(availability(record.appId)).toBe('failed');
  });

  it('an unstarted intent with nothing in flight is refused: acquisition never runs C10’s setup', async () => {
    const { appSessionId } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
    expect(await h.service.acquire(appSessionId, 'read')).toMatchObject({ status: 'refused', reason: 'unknown_session', message: 'an unstarted session starts with its first message' });
    expect(await h.service.acquire('99999999-9999-4999-8999-999999999999' as AppSessionId, 'read')).toMatchObject({ status: 'refused', reason: 'unknown_session' });
    expect(h.host.launches).toEqual([]);
  });

  it('a recovered queue holding entries is not submitted by an acquisition', async () => {
    const record = recordAt();
    const entry = { queueId: 'q1', appSessionId: record.appId, content: 'held', createdAt: T0, state: 'queued' as const, messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    h.host.disk.stores.add(record.appId);
    h.host.disk.queues.set(record.appId, [entry]);
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject(ready(true));
    expect(h.host.disk.queues.get(record.appId)).toEqual([entry]);
    expect(h.host.calledWith('session.send')).toEqual([]);
    expect(h.host.calledWith('session.queue.promote')).toEqual([]);
  });

  // X4's other half (a permission pending at exit stays retired in the acquired launch) is pinned on the real host:
  // src/engine-host/ipc.test.ts, 'a permission pending at exit stays retired after the session is acquired again'
  it('launches with the explicit Resume’s own spec: nothing of the exited launch (its requests) is carried (X4)', async () => {
    const a = recordAt();
    const b = recordAt();
    await h.service.acquire(a.appId, 'read');
    await h.service.startSession(b.appId, { message: null, options: {} });
    await h.settled(b.appId);
    const shape = (spec: LaunchSpec) => ({ ...spec, appSessionId: null, sessionId: null, resume: spec.resume && { ...spec.resume, sessionId: null }, extraSettings: null });
    expect(shape(launchesOf(a.appId)[0]!)).toEqual(shape(launchesOf(b.appId)[0]!));
  });
});

// F-AB's take-over half (tracker 2026-10-10): a take-over of a terminal pane's CLI resumes the session itself (W14), and
// that resume reaching ready is MAWS's last start of the session, so an earlier acquisition's failure no longer
// describes it once the process exits. The CLI is a real child (the take-over ends it with SIGKILL); the pane and the
// process table it is found and paused through are the test's.
describe('session.acquire: a pane take-over’s own resume', () => {
  it('clears the memory of a failed acquisition: after the resumed process exits the session reads resumable', async () => {
    const cli = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    const pid = cli.pid!;
    let state = 'S+';
    let foreground = pid;
    const processes = async () => parseProcesses(`10 1 10 ${foreground} Ss Mon Oct 3 12:00:00 2026\n${pid} 10 ${pid} ${foreground} ${state} Mon Oct 3 12:00:01 2026`);
    const h = await new SessionHarness({ takeOver: { processes } }).start();
    try {
      h.trustDirectory(h.work);
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xaf001), directory: h.work })).record;
      const availability = () => availabilityOf(h.index.sessions.get(record.appId)!, h.host.table.get(record.appId) ?? null, h.memory.get(record.appId) ?? null);
      h.host.script = () => ({ exit: { error: 'the model is not available' } });
      expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'failed' });
      expect(availability()).toBe('failed');
      h.host.script = () => ({});
      h.host.hold(record.engineSessionId!, { kind: 'terminal', pid }, h.work);
      cli.on('exit', () => (h.host.disk.registry.length = 0));
      const pane = { ptyId: 'pane', pid: 10, alive: true, label: 'Terminal' } as PtyInfo;
      h.host.ptyHost = (name, input) => {
        if (name === 'pty.list') return { ptys: [pane] };
        if (name === 'pty.foreground') return { process: 'bash', busy: false };
        if (name === 'pty.write' && (input as { data: string }).data === '\x1a') [state, foreground] = ['T', 10];
        return undefined;
      };
      expect(await h.service.takeOver(record.appId, { kind: 'terminal', pid }, pane.ptyId)).toEqual({ status: 'resumed', warning: null });
      expect(availability()).toBe('usable');
      const live = h.host.table.get(record.appId)!;
      h.host.table.set(record.appId, { ...live, process: 'exited', exit: { code: null, signal: null, reason: 'stop', at: T0, release: null } });
      expect(availability()).toBe('resumable');
      expect(h.memory.get(record.appId)).toMatchObject({ inFlight: false, last: null });
    } finally {
      cli.kill('SIGKILL');
      h.dispose();
    }
  });
});

describe('session.acquire: joins and races', () => {
  let h: SessionHarness;
  let stop: () => Promise<void> = async () => {}; // the take-over's `claude stop`
  beforeEach(async () => {
    stop = async () => {};
    h = await new SessionHarness({ takeOver: { runStop: () => stop(), waitMs: 2_000, pollMs: 5 } }).start();
    h.trustDirectory(h.work);
  });
  afterEach(() => h.dispose());

  const recordAt = (sessionId: SessionId = sessionIdFor(0xad000 + ++n)): SessionRecord => h.index.sessions.upsertFromSummary(summary({ sessionId, directory: h.work })).record;
  const launchesOf = (id: AppSessionId) => h.host.launches.filter((spec) => spec.appSessionId === id);

  it('two acquisitions and a record’s start in one tick launch once; every caller is answered from that one launch', async () => {
    const record = recordAt();
    const answers: Promise<unknown>[] = [h.service.acquire(record.appId, 'read'), h.service.acquire(record.appId, 'read'), h.service.startSession(record.appId, { message: null, options: {} })];
    const [first, second, start] = (await Promise.all(answers)) as [AcquireOutcome, AcquireOutcome, unknown];
    expect(first).toEqual({ status: 'ready', appSessionId: record.appId, launched: true, joined: false });
    expect(second).toEqual({ status: 'ready', appSessionId: record.appId, launched: true, joined: true });
    expect(start).toEqual({ status: 'starting', appSessionId: record.appId });
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  it('a Send joining an explicit Resume (a record’s start in flight) is answered ready, never starting:', async () => {
    const record = recordAt();
    expect(await h.service.startSession(record.appId, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    expect(await h.service.acquire(record.appId, 'send')).toEqual({ status: 'ready', appSessionId: record.appId, launched: true, joined: true });
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  // §5.3's table, amended at M1's review: C11's route switch must not be answered from a launch on another route
  it('a record’s start with different options waits for the acquisition in flight, then runs its own start under its own guards', async () => {
    const record = recordAt();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.host.script = () => ({ onReady: () => gate });
    const acquiring = h.service.acquire(record.appId, 'read');
    await h.until(() => launchesOf(record.appId).length === 1);
    let answered = false;
    const switching = h.service.startSession(record.appId, { message: null, options: { gateway: 'direct' } }).then((outcome) => ((answered = true), outcome));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answered, 'not answered from the launch on the other route').toBe(false);
    release();
    expect(await acquiring).toMatchObject({ status: 'ready', launched: true });
    // its own guards, once the acquisition ended: the session is live now, so the switch is told so (C11 stops a live
    // session before it starts it on the other route), never the joined launch's `starting`
    expect(await switching).toEqual({ status: 'already_live', appSessionId: record.appId });
    expect(launchesOf(record.appId).map((spec) => spec.gateway)).toEqual(['gateway']);
  });

  it('a record’s start with different options that waited starts on its own route when the session is no longer live', async () => {
    const record = recordAt();
    let launch = 0;
    h.host.script = () => (launch++ === 0 ? { exit: { error: 'the model is not available' } } : {}); // the first launch fails
    const acquiring = h.service.acquire(record.appId, 'read');
    const switching = h.service.startSession(record.appId, { message: null, options: { gateway: 'direct' } });
    expect(await acquiring).toMatchObject({ status: 'failed' });
    expect(await switching).toEqual({ status: 'starting', appSessionId: record.appId });
    expect(await h.settled(record.appId, 2)).toMatchObject({ phase: 'ready' });
    expect(launchesOf(record.appId).map((spec) => spec.gateway)).toEqual(['gateway', 'direct']);
  });

  it('a record’s start with the same options as the acquisition in flight joins it', async () => {
    const record = recordAt();
    const acquiring = h.service.acquire(record.appId, 'send', { gateway: 'direct' });
    expect(await h.service.startSession(record.appId, { message: null, options: { gateway: 'direct' } })).toEqual({ status: 'starting', appSessionId: record.appId });
    await acquiring;
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  // W2-A (tracker 2026-10-09, the P2-A whole-branch review's residue): an acquisition that joins a record's start (C11's
  // route switch, the same options) is answered from that run's end in its reply, so the rest of the run streams tagged as
  // its own run's would; the phases before the join went out untagged, and a join never follows the run's end
  it.each([
    ['fails', { ready: false }, { status: 'failed' }, 'failed'],
    ['reaches ready', 'gated', { status: 'ready', launched: true, joined: true }, 'ready'],
  ] as const)('an acquisition joining a record’s start that then %s has the rest of that run stream tagged', async (_, script, answer, end) => {
    const record = recordAt();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.host.script = () => (script === 'gated' ? { onReady: () => gate } : script);
    expect(await h.service.startSession(record.appId, { message: null, options: { gateway: 'direct' } })).toEqual({ status: 'starting', appSessionId: record.appId });
    await h.until(() => h.host.table.get(record.appId)?.process === 'initializing');
    const joined = h.service.acquire(record.appId, 'send', { gateway: 'direct' });
    if (end === 'failed') h.host.exitNow(record.appId);
    release();
    expect(await joined).toMatchObject(answer);
    expect(launchesOf(record.appId)).toHaveLength(1);
    expect(h.setupEvents(record.appId).map((e) => [e.phase, e.acquisition])).toEqual([['launching', undefined], [end, true]]);
  });

  it('a record’s start no acquisition joined streams untagged to its end; an intent’s setup an acquisition joined does too (C10’s card docks from it with the intent’s message)', async () => {
    const record = recordAt();
    await h.service.startSession(record.appId, { message: null, options: {} });
    await h.service.startSession(record.appId, { message: null, options: {} }); // a second record start joins, untagged
    await h.settled(record.appId);
    expect(h.setupEvents(record.appId).every((e) => e.acquisition === undefined)).toBe(true);
    const { appSessionId } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
    const [, acquired] = await Promise.all([h.service.startSession(appSessionId, { message: OK_MESSAGE, options: {} }), h.service.acquire(appSessionId, 'read')]);
    expect(acquired).toMatchObject({ status: 'ready', joined: true });
    expect(h.setupEvents(appSessionId).every((e) => e.acquisition === undefined)).toBe(true);
  });

  it('an intent’s provisional record (a failed or interrupted setup keeps both) is never acquired: refused, nothing launched', async () => {
    const { appSessionId } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
    h.index.sessions.createForLaunch({ appSessionId, directory: h.work, additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null }, firstPrompt: 'first', lineage: null });
    expect(await h.service.acquire(appSessionId, 'read')).toEqual({ status: 'refused', appSessionId, reason: 'unknown_session', message: 'an unstarted session starts with its first message' });
    expect(h.host.launches).toEqual([]);
    expect(h.memory.get(appSessionId), 'nothing registered for it').toBeUndefined();
  });

  it('a record’s start carrying a message is still refused while an acquisition runs (no message is dropped)', async () => {
    const record = recordAt();
    const acquiring = h.service.acquire(record.appId, 'read');
    await expect(h.service.startSession(record.appId, { message: OK_MESSAGE, options: {} })).rejects.toMatchObject({ reason: 'starting' });
    await acquiring;
  });

  it('a take-over is refused while an acquisition runs', async () => {
    const record = recordAt();
    const acquiring = h.service.acquire(record.appId, 'read');
    expect(await h.service.takeOver(record.appId, { kind: 'terminal', pid: 9 })).toMatchObject({ status: 'refused', reason: 'self' });
    await acquiring;
  });

  it('an acquisition with different options waits for the one in flight, then runs its own attempt', async () => {
    const untrusted = h.dir('untrusted');
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xae001), directory: untrusted })).record;
    const plain = h.service.acquire(record.appId, 'read');
    const accepted = h.service.acquire(record.appId, 'send', { trust: 'accepted' });
    expect(await plain).toMatchObject({ status: 'needs_trust' });
    expect(await accepted).toMatchObject({ status: 'ready', launched: true, joined: false });
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  it('a ready status landing between the reservation read and the watch is seen', async () => {
    const record = recordAt();
    const live = h.host.reserve(record.appId, { cwd: h.work, process: 'initializing' });
    let flipped = false;
    h.host.onCall = (name) => {
      if (name !== 'engine.sessions' || flipped) return;
      flipped = true;
      // after the table is read for this call (it answers initializing), the ready status is published
      queueMicrotask(() => {
        const next = { ...live, process: 'ready' as const };
        h.host.table.set(record.appId, next);
        h.host.emitEvent('session.status', { appSessionId: record.appId, status: next });
      });
    };
    expect(await h.service.acquire(record.appId, 'read')).toMatchObject({ status: 'ready', launched: false, joined: false });
    expect(launchesOf(record.appId)).toEqual([]);
  });

  it('an intent’s setup in flight (a new chat’s first launch) is joined, answered ready only after its first message went to the host', async () => {
    const { appSessionId } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.host.script = () => ({ onReady: () => gate });
    expect(await h.service.startSession(appSessionId, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'starting' });
    let sendsAtAnswer = -1;
    const joined = h.service.acquire(appSessionId, 'read').then((outcome) => ((sendsAtAnswer = h.host.calledWith('session.send').length), outcome));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    expect(await joined).toEqual({ status: 'ready', appSessionId, launched: true, joined: true });
    expect(sendsAtAnswer).toBe(1);
    expect(launchesOf(appSessionId)).toHaveLength(1);
  });

  it('a take-over in flight that ends released: the joined Send runs its own attempt and is answered ready', async () => {
    const record = recordAt();
    h.host.hold(record.engineSessionId!, { kind: 'background_job', pid: 7, jobId: 'abcd1234' }, h.work);
    // `claude stop` ends the job a moment later: the registry clears and the take-over answers released
    stop = async () => {
      setTimeout(() => (h.host.disk.registry.length = 0), 30);
    };
    const takingOver = h.service.takeOver(record.appId, { kind: 'background_job', pid: 7, jobId: 'abcd1234' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const acquiring = h.service.acquire(record.appId, 'send');
    expect(await takingOver).toEqual({ status: 'released' });
    expect(await acquiring).toEqual({ status: 'ready', appSessionId: record.appId, launched: true, joined: false });
    expect(launchesOf(record.appId)).toHaveLength(1);
  });

  // The whole-branch review: every lifecycle run registers in its caller's tick, before awaiting readiness, so the one
  // invoked first is the one an acquisition in the same tick meets
  it('a take-over invoked first, while readiness is pending, is the run an acquisition in the same tick waits for', async () => {
    const booting = new SessionHarness({ takeOver: { runStop: async () => void (booting.host.disk.registry.length = 0), waitMs: 2_000, pollMs: 5 } }); // not started
    try {
      booting.trustDirectory(booting.work);
      const record = booting.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xad100), directory: booting.work })).record;
      const holder = { kind: 'background_job' as const, pid: 7, jobId: 'abcd1234' };
      booting.host.hold(record.engineSessionId!, holder, booting.work);
      const [taken, acquired] = await Promise.all([booting.service.takeOver(record.appId, holder), booting.service.acquire(record.appId, 'send')]);
      expect(taken).toEqual({ status: 'released' });
      expect(acquired).toEqual({ status: 'ready', appSessionId: record.appId, launched: true, joined: false });
    } finally {
      booting.dispose();
    }
  });

  it('an intent’s start invoked first is joined by an acquisition in the same tick', async () => {
    const { appSessionId } = await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } });
    const [started, acquired] = await Promise.all([h.service.startSession(appSessionId, { message: OK_MESSAGE, options: {} }), h.service.acquire(appSessionId, 'read')]);
    expect(started).toMatchObject({ status: 'starting' });
    expect(acquired).toEqual({ status: 'ready', appSessionId, launched: true, joined: true });
    expect(launchesOf(appSessionId)).toHaveLength(1);
  });
});
