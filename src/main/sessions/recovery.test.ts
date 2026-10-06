import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { BootstrapNotes } from './intents';
import type { SetupIntent } from '@shared/sessions/intent';
import { SessionHarness } from '../../../test/support/session-harness';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const MESSAGE = { content: 'Reply OK', display: 'Reply OK' };

function intentFile(h: SessionHarness, id: string): SetupIntent | null {
  const path = join(h.userData, 'sessions', 'intents', `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SetupIntent) : null;
}

// Handoff recovery (C10 execution document, Interfaces "Handoff recovery"): the app dies at each point of a first start
// and starts again over the same disk; nothing is sent twice, nothing launches at start, nothing is trashed.
describe('handoff recovery', () => {
  let h: SessionHarness;
  let id: AppSessionId;
  beforeEach(async () => {
    h = await new SessionHarness().start();
    h.trustDirectory(h.work);
    id = (await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } })).appSessionId;
  });
  afterEach(() => h.dispose());

  const pinOf = () => intentFile(h, id)!.progress.engineSessionId as SessionId;
  const start = () => h.service.startSession(id, { message: MESSAGE, options: {} });
  // after `launching`, C4's source has bound the record to the pin from the first status that carried it, as live
  const bound = () => h.until(() => h.index.sessions.get(id)?.engineSessionId === pinOf());

  // what every restart must not do: send the message again, launch anything on its own, trash a transcript
  const afterRestart = async (transcript: string | null) => {
    await h.restart();
    expect(h.host.launches).toEqual([]);
    expect(h.host.calledWith('session.send')).toEqual([]);
    if (transcript !== null) expect(existsSync(transcript)).toBe(true);
  };

  // (b): the message never reached C3; the provisional record goes, the intent stays failed with its message and pin
  const notStarted = async (pin: SessionId) => {
    expect(h.index.sessions.get(id)).toBeNull();
    await h.until(() => h.removed(id)); // session.removed, which C5's retention answers for the intent's tab
    expect(intentFile(h, id)).toMatchObject({
      message: MESSAGE,
      progress: { engineSessionId: pin, lastFailure: { phase: 'launching', message: 'MAWS quit before the session started', resources: { record: 'removed', transcript: 'none', worktree: null } } },
    });
  };
  // (a) with the transcript: the pin binds, the intent goes
  const handedOffBound = (pin: SessionId) => {
    expect(intentFile(h, id)).toBeNull();
    expect(h.index.sessions.get(id)!.engineSessionId).toBe(pin);
  };
  // (a) without it: C3 holds the message; the record is unbound so the next launch is a fresh pinned session
  const handedOffUnbound = async (pin: SessionId) => {
    expect(intentFile(h, id)).toBeNull();
    expect(h.index.sessions.get(id)!.engineSessionId).toBeNull();
    await h.until(() => h.host.calledWith('fs.unbind').length > 0);
    expect(h.host.calledWith('fs.unbind')).toContainEqual({ appSessionId: id });
    expect(h.host.disk.stores.has(id)).toBe(true); // C3's queue and grants untouched
    await h.service.startSession(id, { message: null, options: {} });
    await h.settled(id);
    expect(h.host.launches.at(-1)).toMatchObject({ appSessionId: id, resume: null });
    expect(h.host.launches.at(-1)!.sessionId).not.toBe(pin);
    expect(h.host.calledWith('session.send')).toEqual([]);
  };

  it('before session.launch: nothing reached C3 (queue.list: unknown session); Retry recreates the record under the same id, same pin, sends once', async () => {
    h.host.launchHangs = true;
    await start();
    await h.until(() => h.index.sessions.get(id) !== null && h.host.calls.some((c) => c.name === 'session.launch'));
    const pin = pinOf();
    await afterRestart(null);
    expect(h.host.calledWith('session.queue.list')).toEqual([{ appSessionId: id }]);
    await notStarted(pin);
    await h.service.startSession(id, { message: null, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
    expect(h.host.launches).toHaveLength(1);
    expect(h.host.launches[0]).toMatchObject({ appSessionId: id, sessionId: pin });
    expect(h.host.calledWith('session.send')).toEqual([{ appSessionId: id, content: 'Reply OK' }]);
    expect(h.index.sessions.get(id)!.appId).toBe(id);
  });

  it('after launching, before ready: nothing reached C3', async () => {
    h.host.script = () => ({ ready: false });
    await start();
    await h.until(() => intentFile(h, id)?.progress.launch != null);
    await bound();
    const pin = pinOf();
    await afterRestart(null);
    await notStarted(pin);
  });

  describe.each([false, true])('with the transcript %s', (withTranscript) => {
    const transcriptOf = (pin: SessionId) => (withTranscript ? h.writeTranscript(h.work, pin) : null);

    it('after ready, before session.send', async () => {
      h.host.send = 'hang';
      await start();
      await h.until(() => h.host.calls.some((c) => c.name === 'session.send'));
      await bound();
      const pin = pinOf();
      const transcript = transcriptOf(pin);
      await afterRestart(transcript);
      if (withTranscript) handedOffBound(pin);
      else await notStarted(pin);
    });

    it('after C3 persisted the entry, before its answer', async () => {
      h.host.send = 'persist-then-hang';
      await start();
      await h.until(() => (h.host.disk.queues.get(id) ?? []).length > 0);
      await bound();
      const pin = pinOf();
      const transcript = transcriptOf(pin);
      await afterRestart(transcript);
      if (withTranscript) handedOffBound(pin);
      else await handedOffUnbound(pin);
    });

    it('after the answer, before progress.send', async () => {
      h.hangPut = (intent) => intent.progress.send !== null;
      await start();
      await h.until(() => h.gateReached); // the run is held at the write of progress.send: C3 has answered
      expect((h.host.disk.queues.get(id) ?? []).length).toBeGreaterThan(0);
      await bound();
      const pin = pinOf();
      expect(intentFile(h, id)!.progress.send).toBeNull();
      const transcript = transcriptOf(pin);
      await afterRestart(transcript);
      if (withTranscript) handedOffBound(pin);
      else await handedOffUnbound(pin);
    });

    it('after progress.send, before the intent is removed', async () => {
      h.hangRemove = true;
      await start();
      await h.until(() => h.gateReached); // the run is held at the intent's removal, progress.send on disk
      expect(intentFile(h, id)!.progress.send).not.toBeNull();
      await bound();
      const pin = pinOf();
      const transcript = transcriptOf(pin);
      await afterRestart(transcript);
      if (withTranscript) handedOffBound(pin);
      else await handedOffUnbound(pin);
    });
  });

  it('leaves a /clear rebind bound as it is', async () => {
    h.host.send = 'persist-then-hang';
    await start();
    await h.until(() => (h.host.disk.queues.get(id) ?? []).length > 0);
    await bound();
    const cleared = '00000000-0000-4000-8000-00000000c1ea' as SessionId;
    h.index.sessions.bindEngineId(id, cleared); // C4's rebind: the first message was `/clear`
    await afterRestart(null);
    expect(intentFile(h, id)).toBeNull();
    expect(h.index.sessions.get(id)!.engineSessionId).toBe(cleared);
  });

  it('a failed reconciliation reports the worktree the intent retains', async () => {
    h.host.script = () => ({ ready: false });
    await start();
    await h.until(() => intentFile(h, id)?.progress.launch != null);
    await bound();
    // the intent retains a checkout (as a start into an existing worktree records it)
    const path = join(h.userData, 'sessions', 'intents', `${id}.json`);
    const retained = { path: h.work, branch: 'feature', head: 'a'.repeat(40), createdHere: false };
    writeFileSync(path, JSON.stringify({ ...intentFile(h, id)!, progress: { ...intentFile(h, id)!.progress, worktree: retained } }));
    const original = h.host.afterRestart.bind(h.host);
    h.host.afterRestart = () => {
      const next = original();
      next.queueListError = 'state file is corrupt';
      return next;
    };
    await h.restart();
    expect(intentFile(h, id)!.progress.lastFailure!.resources).toEqual({
      worktree: { path: h.work, branch: 'feature', createdHere: false, state: 'kept', detail: null, branchState: 'none' },
      record: 'kept',
      transcript: 'none',
    });
  });

  // An intent with no record that still holds a message had no way forward after a restart: nothing had failed, and the
  // card it waited behind lived in the renderer only. It is marked failed at start, so its tab shows Retry.
  describe('a start that never reached a record', () => {
    const quitFailure = (phase: string) => ({ phase, message: 'MAWS quit before the session started', resources: { worktree: null, record: 'none', transcript: 'none' } });

    it('quit during the trust bootstrap: failed at trusting with its message; Retry bootstraps, launches and sends once', async () => {
      const untrusted = h.dir('untrusted');
      const other = (await h.service.create({ projectId: null, location: { kind: 'directory', path: untrusted } })).appSessionId;
      h.host.launchHangs = (spec) => spec.appSessionId !== other; // the app dies while the bootstrap launches
      await h.service.startSession(other, { message: MESSAGE, options: { trust: 'accepted' } });
      await h.until(() => intentFile(h, other)?.progress.bootstrap != null && h.host.calls.some((c) => c.name === 'session.launch'));
      await afterRestart(null);
      expect(h.index.sessions.get(other)).toBeNull();
      expect(intentFile(h, other)).toMatchObject({ message: MESSAGE, progress: { bootstrap: null, send: null, lastFailure: quitFailure('trusting') } });
      await h.service.startSession(other, { message: null, options: {} });
      expect(await h.settled(other)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
      expect(h.host.launches.map((l) => l.appSessionId === other)).toEqual([false, true]);
      expect(h.host.calledWith('session.send')).toEqual([{ appSessionId: other, content: 'Reply OK' }]);
    });

    it('quit while the trust card waited: failed with its message; Retry asks for trust again', async () => {
      const untrusted = h.dir('untrusted');
      const other = (await h.service.create({ projectId: null, location: { kind: 'directory', path: untrusted } })).appSessionId;
      expect(await h.service.startSession(other, { message: MESSAGE, options: {} })).toMatchObject({ status: 'needs_trust' });
      await afterRestart(null);
      expect(intentFile(h, other)).toMatchObject({ message: MESSAGE, progress: { lastFailure: quitFailure('worktree') } });
      expect(await h.service.startSession(other, { message: null, options: {} })).toMatchObject({ status: 'needs_trust' });
      expect(intentFile(h, other)!.message).toEqual(MESSAGE);
    });

    it('an intent nobody started, or one already failed, is left as it is', async () => {
      await h.service.patch(id, { draft: { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' } });
      const failed = (await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } })).appSessionId;
      h.host.script = () => ({ answer: { refused: 'binary_missing', message: 'no engine binary' } });
      await h.service.startSession(failed, { message: MESSAGE, options: {} });
      expect(await h.settled(failed)).toMatchObject({ phase: 'failed' });
      const before = [intentFile(h, id), intentFile(h, failed)];
      expect(before[1]).toMatchObject({ message: MESSAGE, progress: { lastFailure: { message: 'binary_missing: no engine binary' } } });
      await afterRestart(null);
      expect([intentFile(h, id), intentFile(h, failed)]).toEqual(before);
    });
  });

  it('a store the host cannot read leaves intent and record as they are, surfaces the error, and Retry reconciles again', async () => {
    h.host.script = () => ({ ready: false });
    await start();
    await h.until(() => intentFile(h, id)?.progress.launch != null);
    await bound();
    const before = h.index.sessions.get(id)!;
    const original = h.host.afterRestart.bind(h.host);
    h.host.afterRestart = () => {
      const next = original();
      next.queueListError = 'state file is corrupt'; // the restarted host cannot read the persisted queue
      return next;
    };
    await h.restart();
    // nothing removed, bound or unbound (the D-16 reset alone touched the holder)
    expect(h.index.sessions.get(id)).toMatchObject({ appId: id, engineSessionId: before.engineSessionId, directory: before.directory });
    expect(intentFile(h, id)).toMatchObject({ message: MESSAGE, progress: { lastFailure: { message: expect.stringContaining('state file is corrupt') } } });
    expect(h.host.launches).toEqual([]);
    await expect(h.service.startSession(id, { message: null, options: {} })).rejects.toThrow('state file is corrupt');
    expect(h.host.launches).toEqual([]);
    h.host.queueListError = null;
    await h.service.startSession(id, { message: null, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(h.host.calledWith('session.send')).toHaveLength(1);
  });
});

// E10 (Design 5, "Startup recovery with kept sessions"): a keep-quit leaves the sessions running on the detached
// supervisor, so a relaunch reads `engine.sessions` before recovering. An intent whose row is live is handed off; a live
// bootstrap row is stopped and forgotten; when the host cannot be read nothing destructive runs until it streams again.
describe('recovery with kept sessions (E10)', () => {
  let h: SessionHarness;
  let id: AppSessionId;
  beforeEach(async () => {
    h = await new SessionHarness().start();
    h.trustDirectory(h.work);
    id = (await h.service.create({ projectId: null, location: { kind: 'directory', path: h.work } })).appSessionId;
  });
  afterEach(() => h.dispose());

  const pinOf = () => intentFile(h, id)!.progress.engineSessionId as SessionId;
  const start = () => h.service.startSession(id, { message: MESSAGE, options: {} });
  const bound = () => h.until(() => h.index.sessions.get(id)?.engineSessionId === pinOf());
  const nothingRelaunchedOrResent = () => {
    expect(h.host.launches).toEqual([]);
    expect(h.host.calledWith('session.send')).toEqual([]);
  };
  // the record stays bound to the row's engine id, the intent goes as handed off, and nothing else touches the row
  const handedOff = (pin: SessionId) => {
    expect(intentFile(h, id)).toBeNull();
    expect(h.events).toContainEqual({ name: 'session.intent.changed', payload: { appSessionId: id, intent: null } });
    expect(h.index.sessions.get(id)).toMatchObject({ appId: id, engineSessionId: pin });
    expect(h.removed(id)).toBe(false);
    expect(h.host.calledWith('fs.unbind')).toEqual([]);
    expect(h.host.calledWith('session.stop')).toEqual([]);
    expect(h.host.forgotten).not.toContain(id);
    expect(h.host.table.get(id)!.process).not.toBe('exited');
  };

  it('a live row whose first message never reached C3 is handed off, not failed and removed', async () => {
    h.host.send = 'hang'; // without a kept row this is "not started": the record removed, the intent failed
    await start();
    await h.until(() => h.host.calls.some((c) => c.name === 'session.send'));
    await bound();
    const pin = pinOf();
    await h.restart({ keep: true });
    nothingRelaunchedOrResent();
    handedOff(pin);
    expect(h.host.calledWith('session.queue.list')).toEqual([]); // the live row settles it: C3's queue is the host's
  });

  it('a live row still initializing is handed off', async () => {
    h.host.script = () => ({ ready: false });
    await start();
    await h.until(() => intentFile(h, id)?.progress.launch != null);
    await bound();
    const pin = pinOf();
    await h.restart({ keep: true });
    nothingRelaunchedOrResent();
    handedOff(pin);
  });

  it('a first message C3 queued on a live row is left to the host', async () => {
    h.host.send = 'persist-then-hang';
    await start();
    await h.until(() => (h.host.disk.queues.get(id) ?? []).length > 0);
    await bound();
    const pin = pinOf();
    await h.restart({ keep: true });
    nothingRelaunchedOrResent();
    handedOff(pin);
    expect(h.host.disk.queues.get(id)).toHaveLength(1);
  });

  it('a row that exited while the app was away recovers as today', async () => {
    h.host.send = 'hang';
    await start();
    await h.until(() => h.host.calls.some((c) => c.name === 'session.send'));
    await bound();
    const pin = pinOf();
    h.host.exitNow(id);
    await h.restart({ keep: true });
    nothingRelaunchedOrResent();
    expect(h.index.sessions.get(id)).toBeNull();
    await h.until(() => h.removed(id));
    expect(intentFile(h, id)).toMatchObject({ message: MESSAGE, progress: { engineSessionId: pin, lastFailure: { phase: 'launching', message: 'MAWS quit before the session started' } } });
  });

  it('a live trust bootstrap is stopped and forgotten, and its intent fails at trusting as a quit leaves it', async () => {
    const untrusted = h.dir('untrusted');
    const other = (await h.service.create({ projectId: null, location: { kind: 'directory', path: untrusted } })).appSessionId;
    h.host.script = (spec) => (spec.appSessionId !== other ? { ready: false } : {}); // the bootstrap stays initializing
    await h.service.startSession(other, { message: MESSAGE, options: { trust: 'accepted' } });
    await h.until(() => intentFile(h, other)?.progress.bootstrap != null && h.host.table.size > 0);
    const bootstrapId = intentFile(h, other)!.progress.bootstrap!.appSessionId;
    await h.until(() => h.host.table.get(bootstrapId)?.process === 'initializing');
    await h.restart({ keep: true });
    expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: bootstrapId, reason: 'stop' }]);
    expect(h.host.forgotten).toEqual([bootstrapId]);
    expect(h.host.table.has(bootstrapId)).toBe(false);
    expect(intentFile(h, other)).toMatchObject({ message: MESSAGE, progress: { bootstrap: null, lastFailure: { phase: 'trusting', message: 'MAWS quit before the session started' } } });
    expect(h.host.launches).toEqual([]);
  });

  it("a resume's noted bootstrap with a live row is stopped and forgotten, its note removed", async () => {
    const notes = new BootstrapNotes(join(h.userData, 'sessions', 'bootstraps'));
    const bootstrapId = '00000000-0000-4000-8000-0000000b0075' as AppSessionId;
    await notes.put({ bootstrapId, appSessionId: id, at: '2026-10-06T00:00:00.000Z' });
    h.host.reserve(bootstrapId, { process: 'ready' });
    await h.restart({ keep: true });
    expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: bootstrapId, reason: 'stop' }]);
    expect(h.host.forgotten).toEqual([bootstrapId]);
    expect(await notes.list()).toEqual([]);
  });

  describe('when engine.sessions cannot be answered (the host is crashed, waiting or held)', () => {
    const notes = () => new BootstrapNotes(join(h.userData, 'sessions', 'bootstraps'));
    const deadBootstrap = '00000000-0000-4000-8000-0000000dead0' as AppSessionId;
    let pin: SessionId;
    let interrupted: AppSessionId;
    beforeEach(async () => {
      h.host.send = 'hang';
      await start();
      await h.until(() => h.host.calls.some((c) => c.name === 'session.send'));
      await bound();
      pin = pinOf();
      // a start the quit cut short before any record (a recovery marks it failed), and a bootstrap a run left noted
      interrupted = (await h.service.create({ projectId: null, location: { kind: 'directory', path: h.dir('later') } })).appSessionId;
      writeFileSync(join(h.userData, 'sessions', 'intents', `${interrupted}.json`), JSON.stringify({ ...intentFile(h, interrupted)!, message: MESSAGE }));
      await notes().put({ bootstrapId: deadBootstrap, appSessionId: interrupted, at: '2026-10-06T00:00:00.000Z' });
    });

    it('nothing is marked, removed or forgotten; the next ready runs recovery, and commands wait for it', async () => {
      const before = [intentFile(h, id), intentFile(h, interrupted)];
      await h.restart({ keep: true, unavailable: true });
      expect([intentFile(h, id), intentFile(h, interrupted)]).toEqual(before);
      expect(h.index.sessions.get(id)).toMatchObject({ appId: id, engineSessionId: pin });
      expect(h.removed(id)).toBe(false);
      expect(await notes().list()).toHaveLength(1);
      expect(h.host.calls.map((c) => c.name)).toEqual(['engine.sessions']); // no forget, no queue read, no stop
      expect((await h.service.listIntents()).map((i) => i.appSessionId).sort()).toEqual([id, interrupted].sort()); // the service answers meanwhile

      h.host.becomeReady();
      const listed = await h.service.listIntents(); // waits for the recovery the ready started
      expect(listed.map((i) => i.appSessionId)).toEqual([interrupted]);
      handedOff(pin);
      expect(intentFile(h, interrupted)).toMatchObject({ message: MESSAGE, progress: { lastFailure: { message: 'MAWS quit before the session started' } } });
      expect(await notes().list()).toEqual([]);
      expect(h.host.calledWith('session.forget')).toEqual([{ appSessionId: deadBootstrap }]);
      nothingRelaunchedOrResent();
    });

    it('a start of an intent recovery has not reached reconciles it first, so it never rolls back a kept session', async () => {
      await h.restart({ keep: true, unavailable: true });
      await expect(h.service.startSession(id, { message: null, options: {} })).rejects.toThrow('reconciliation failed: the engine host is not connected');
      expect(h.index.sessions.get(id)).toMatchObject({ appId: id, engineSessionId: pin }); // no rollback removed it
      expect(h.host.calledWith('session.stop')).toEqual([]);
      expect(h.host.calledWith('session.launch')).toEqual([]);
      h.host.becomeReady();
      await h.service.listIntents();
      handedOff(pin);
    });

    it('a deferred recovery passes over an intent whose start is in flight', async () => {
      await h.restart({ keep: true, unavailable: true });
      h.hangPut = (intent) => intent.appSessionId === interrupted && intent.progress.lastFailure === null; // its start holds at its first write
      void h.service.startSession(interrupted, { message: null, options: {} });
      await h.until(() => h.gateReached);
      h.host.becomeReady();
      await h.service.listIntents();
      handedOff(pin);
      expect(intentFile(h, interrupted)!.progress.lastFailure).toBeNull(); // never marked "MAWS quit before the session started"
    });

    it('a ready while the host still cannot be read defers recovery again; a later ready runs it', async () => {
      await h.restart({ unavailable: true });
      h.host.becomeReady({ reachable: false }); // streaming, but the table read fails again (a stalled request)
      await h.service.listIntents();
      expect(intentFile(h, id)!.progress.lastFailure).toBeNull();
      expect(h.removed(id)).toBe(false);
      h.host.becomeReady();
      await h.service.listIntents();
      expect(h.removed(id)).toBe(true); // no live row on this host: as today, the record goes and the intent fails
      expect(intentFile(h, id)).toMatchObject({ progress: { lastFailure: { message: 'MAWS quit before the session started' } } });
    });
  });
});
