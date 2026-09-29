import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
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
