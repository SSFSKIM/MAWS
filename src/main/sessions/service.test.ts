import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { validateEventPayload } from '@shared/ipc/validate';
import { SessionHarness } from '../../../test/support/session-harness';
import { DOWN_RELAY } from '../../../test/support/session-host';

// The service is Electron-free (its handlers are service-register.ts's).
vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const OK_MESSAGE = { content: 'Reply OK', display: 'Reply OK' };
const DRAFT = { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' };

function intentFile(h: SessionHarness, id: string): SetupIntent | null {
  const path = join(h.userData, 'sessions', 'intents', `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SetupIntent) : null;
}

describe('session service', () => {
  let h: SessionHarness;
  beforeEach(async () => {
    h = await new SessionHarness().start();
  });
  afterEach(() => h.dispose());

  const create = async (path = h.work) => (await h.service.create({ projectId: null, location: { kind: 'directory', path } })).appSessionId;

  describe('intents', () => {
    it('create persists an intent file, publishes it, and makes no record and no launch', async () => {
      const { appSessionId, intent } = await h.service.create({ projectId: null, location: null });
      expect(intentFile(h, appSessionId)).toEqual(intent);
      expect(intent).toMatchObject({ kind: 'create', gateway: 'gateway', trust: 'unanswered', trustKey: null, message: null, draft: null, model: null, permissionMode: null });
      expect(h.index.sessions.get(appSessionId)).toBeNull();
      expect(h.host.launches).toEqual([]);
      expect(h.events.some((e) => e.name === 'session.intent.changed')).toBe(true);
    });

    it('create defaults the location to the project directory', async () => {
      const project = h.index.projects.add(h.work);
      const { intent } = await h.service.create({ projectId: project.id, location: null });
      expect(intent.location).toEqual({ kind: 'directory', path: h.work });
    });

    it('patch checks the location and additional directories and refuses each with the field named', async () => {
      const id = await create();
      await expect(h.service.patch(id, { location: { kind: 'directory', path: join(h.root, 'missing') } })).rejects.toMatchObject({ reason: 'invalid', field: 'location' });
      await expect(h.service.patch(id, { additionalDirectories: [join(h.root, 'missing')] })).rejects.toMatchObject({ reason: 'invalid', field: 'additionalDirectories' });
      await expect(h.service.patch(id, { additionalDirectories: [h.work] })).rejects.toThrow('is the session directory');
      const other = h.dir('other');
      await expect(h.service.patch(id, { additionalDirectories: [other, other] })).rejects.toThrow('listed twice');
      const patched = await h.service.patch(id, { additionalDirectories: [other], model: 'sonnet', draft: DRAFT });
      expect(patched).toMatchObject({ additionalDirectories: [other], model: 'sonnet', draft: DRAFT });
    });

    it('patch binds a trust decision to the key it answered', async () => {
      const id = await create();
      expect(await h.service.patch(id, { trust: 'accepted' })).toMatchObject({ trust: 'accepted', trustKey: h.work });
      const other = h.dir('other');
      expect(await h.service.patch(id, { location: { kind: 'directory', path: other } })).toMatchObject({ trust: 'unanswered', trustKey: null });
    });
  });

  describe('session service setup table', () => {
    it('answers needs_trust for an unanswered decision on an untrusted key, creates nothing, and keeps the message', async () => {
      const id = await create();
      const outcome = await h.service.startSession(id, { message: OK_MESSAGE, options: {} });
      expect(outcome).toMatchObject({ status: 'needs_trust', appSessionId: id, trust: { trustKey: h.work, trusted: false } });
      expect(h.host.launches).toEqual([]);
      expect(h.index.sessions.get(id)).toBeNull();
      expect(intentFile(h, id)?.message).toEqual(OK_MESSAGE);
    });

    it('declined launches once, unattested, under the intent id with the pin; the message goes once at ready; the intent goes after the handoff', async () => {
      const id = await create();
      await h.service.patch(id, { draft: DRAFT });
      expect(await h.service.startSession(id, { message: OK_MESSAGE, options: { trust: 'declined' } })).toEqual({ status: 'starting', appSessionId: id });
      const pin = intentFile(h, id)!.progress.engineSessionId;
      expect(pin).not.toBeNull();
      expect(await h.settled(id)).toMatchObject({ phase: 'ready', outcome: { kind: 'ready', engineSessionId: pin, firstTurn: 'sent' } });
      expect(h.host.launches).toHaveLength(1);
      expect(h.host.launches[0]).toMatchObject({ appSessionId: id, sessionId: pin, trust: null, resume: null, inheritGrantsFrom: null, cwd: h.work });
      expect(h.host.calledWith('session.send')).toEqual([{ appSessionId: id, content: 'Reply OK' }]);
      expect(intentFile(h, id)).toBeNull();
      const record = h.index.sessions.get(id)!;
      expect(record).toMatchObject({ appId: id, engineSessionId: pin, directory: h.work });
      expect(h.setupEvents(id).map((e) => e.phase)).toEqual(['launching', 'ready']);
      expect(h.events.filter((e) => e.name === 'session.intent.changed').at(-1)?.payload).toEqual({ appSessionId: id, intent: null });
      expect(await h.service.startSession(id, { message: null, options: {} })).toEqual({ status: 'already_live', appSessionId: id });
    });

    it('accepted runs the trust bootstrap under an id of its own, recorded before its launch, forgotten at release; then the real launch attests', async () => {
      const id = await create();
      let noted: SetupIntent['progress']['bootstrap'] = null;
      let tableDuringBootstrap: string[] = [];
      h.host.script = (spec) => {
        if (spec.appSessionId === id) return {};
        noted = intentFile(h, id)!.progress.bootstrap;
        return { onReady: () => void (tableDuringBootstrap = [...h.host.table.values()].map((s) => s.cwd)) };
      };
      await h.service.startSession(id, { message: OK_MESSAGE, options: { trust: 'accepted' } });
      expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
      const [bootstrap, real] = h.host.launches;
      expect(bootstrap).toMatchObject({ trust: { accepted: true, directory: h.work }, sessionId: null, resume: null, model: null, permissionMode: null });
      expect(bootstrap!.appSessionId).not.toBe(id);
      expect(noted).toMatchObject({ appSessionId: bootstrap!.appSessionId });
      expect(h.host.forgotten).toContain(bootstrap!.appSessionId);
      expect(h.host.calledWith('session.stop')).toContainEqual({ appSessionId: bootstrap!.appSessionId, reason: 'stop' });
      expect(real).toMatchObject({ appSessionId: id, trust: { accepted: true, directory: h.work }, sessionId: intentFile(h, id)?.progress.engineSessionId ?? expect.any(String) });
      expect(h.setupEvents(id).filter((e) => e.phase === 'trusting').map((e) => e.detail)).toEqual([
        `Trusting ${h.work}`,
        expect.stringMatching(new RegExp(`^Trust recorded for ${h.work} \\(bootstrap [0-9a-f-]{36}\\)$`)),
      ]);
      // the index never heard of the bootstrap; the process table knew its cwd
      expect(h.index.sessions.get(bootstrap!.appSessionId as AppSessionId)).toBeNull();
      expect(h.index.sessions.list().map((r) => r.appId)).toEqual([id]);
      expect(tableDuringBootstrap).toContain(h.work);
    });

    it('fails with the intent retained when the bootstrap does not record trust', async () => {
      const id = await create();
      h.host.script = (spec) => (spec.appSessionId !== id ? { recorded: false } : {});
      await h.service.startSession(id, { message: OK_MESSAGE, options: { trust: 'accepted' } });
      expect(await h.settled(id)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: `the engine did not record trust for ${h.work}` } });
      expect(h.host.launches).toHaveLength(1);
      expect(intentFile(h, id)).toMatchObject({ message: OK_MESSAGE, progress: { bootstrap: null, trustRecorded: false, lastFailure: { phase: 'trusting' } } });
    });

    it('fails and keeps the bootstrap id noted when its stop is not confirmed', async () => {
      const id = await create();
      h.host.stopExits = false;
      await h.service.startSession(id, { message: null, options: { trust: 'accepted' } });
      expect(await h.settled(id)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: expect.stringContaining('did not stop') } });
      expect(intentFile(h, id)!.progress.bootstrap).toMatchObject({ appSessionId: h.host.launches[0]!.appSessionId });
    });

    it('the home directory attests per launch with no bootstrap and succeeds though the engine records nothing', async () => {
      const id = await create(h.home);
      h.host.script = () => ({ recorded: false });
      await h.service.startSession(id, { message: null, options: { trust: 'accepted' } });
      expect(await h.settled(id)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'none' } });
      expect(h.host.launches).toHaveLength(1);
      expect(h.host.launches[0]).toMatchObject({ appSessionId: id, trust: { accepted: true, directory: h.home } });
      expect(h.setupEvents(id).some((e) => e.phase === 'trusting')).toBe(false);
    });

    it('a trusted key needs no card and attests nothing', async () => {
      h.trustDirectory(h.work);
      const id = await create();
      await h.service.startSession(id, { message: null, options: {} });
      await h.settled(id);
      expect(h.host.launches).toHaveLength(1);
      expect(h.host.launches[0]!.trust).toBeNull();
    });

    it('answers relay_unreachable before creating anything, keeps the message, and the continuation runs direct with it once', async () => {
      h.trustDirectory(h.work);
      const id = await create();
      h.host.relay = DOWN_RELAY;
      expect(await h.service.startSession(id, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'relay_unreachable', health: { ok: false } });
      expect(h.host.launches).toEqual([]);
      expect(intentFile(h, id)?.message).toEqual(OK_MESSAGE);
      expect(await h.service.startSession(id, { message: null, options: { gateway: 'direct' } })).toMatchObject({ status: 'starting' });
      await h.settled(id);
      expect(h.host.launches).toHaveLength(1);
      expect(h.host.launches[0]!.gateway).toBe('direct');
      expect(h.host.calledWith('session.send')).toHaveLength(1);
    });

    it("falls back to direct for a Claude model when settings say so, with the session's notice", async () => {
      h.dispose();
      h = await new SessionHarness({ settings: () => ({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'direct' }, engine: { subagentModel: null } }) }).start();
      h.trustDirectory(h.work);
      h.host.relay = DOWN_RELAY;
      const id = await create();
      expect(await h.service.startSession(id, { message: null, options: {} })).toMatchObject({ status: 'starting' });
      await h.settled(id);
      expect(h.host.launches[0]!.gateway).toBe('direct');
      const notices = h.events.filter((e) => e.name === 'session.eventBatch');
      expect(JSON.stringify(notices)).toContain('relay:direct_fallback');
      for (const notice of notices) expect(validateEventPayload('session.eventBatch', notice.payload).ok).toBe(true); // what main's emit sends
      // a gateway model cannot be served direct: the relay card, as under `ask`
      const gatewayModel = await create();
      await h.service.patch(gatewayModel, { model: 'claude/astra' });
      expect(await h.service.startSession(gatewayModel, { message: null, options: {} })).toMatchObject({ status: 'relay_unreachable' });
    });

    it('a launch with no status for the watchdog’s span is stopped and rolled back', async () => {
      h.dispose();
      h = await new SessionHarness({ watchdogMs: 50 }).start();
      h.trustDirectory(h.work);
      h.host.script = () => ({ ready: false });
      const id = await create();
      await h.service.startSession(id, { message: OK_MESSAGE, options: {} });
      expect(await h.settled(id)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: 'no answer from the engine host', resources: { record: 'removed' } } });
      expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: id, reason: 'stop' }]);
      expect(intentFile(h, id)?.message).toEqual(OK_MESSAGE);
    });

    it('the index records the launch under the intent id: record, spec, intent and fs.bind name one id', async () => {
      h.trustDirectory(h.work);
      const id = await create();
      await h.service.startSession(id, { message: null, options: {} });
      await h.settled(id);
      const pin = h.host.launches[0]!.sessionId;
      await h.until(() => h.host.calledWith('fs.bind').length > 0);
      expect(h.host.calledWith('fs.bind')).toEqual([{ bindings: [{ sessionId: pin, appSessionId: id }] }]);
      expect(h.index.sessions.get(id)!.engineSessionId).toBe(pin);
    });

    it('maps the engine refusing a --bg holder to held with the short id and its attach command', async () => {
      h.trustDirectory(h.work);
      const id = await create();
      h.host.script = () => ({ exit: { error: 'Error: Session x is running as a background session (e6dcd828). Run `claude attach e6dcd828` to open it' } });
      await h.service.startSession(id, { message: OK_MESSAGE, options: {} });
      expect(await h.settled(id)).toMatchObject({
        phase: 'failed',
        outcome: { kind: 'held', holder: { kind: 'background_job', jobId: 'e6dcd828' }, attach: { jobId: 'e6dcd828', command: "'/opt/engine/2.1.283' attach e6dcd828" } },
      });
      expect(h.index.sessions.get(id)).toBeNull(); // rolled back
      expect(intentFile(h, id)?.message).toEqual(OK_MESSAGE);
    });
  });

  describe('hand-back on rejection and release', () => {
    it('a rejected guard clears the message and leaves the draft; release does the same on request and refuses while starting', async () => {
      const id = await create();
      await h.service.patch(id, { draft: DRAFT, additionalDirectories: [h.dir('extra')] });
      h.trustDirectory(h.work);
      // the extra directory disappears: the start is rejected, the editor keeps its text
      rmSync(join(h.root, 'extra'), { recursive: true });
      expect(await h.service.startSession(id, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'invalid', field: 'additionalDirectories' });
      expect(intentFile(h, id)).toMatchObject({ message: null, draft: DRAFT });
      await h.service.patch(id, { additionalDirectories: [] });
      const missing = await create(h.dir('gone'));
      rmSync(join(h.root, 'gone'), { recursive: true });
      expect(await h.service.startSession(missing, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'missing_directory', directory: join(h.root, 'gone') });
      expect(intentFile(h, missing)?.message).toBeNull();
      // release: needs_trust keeps the message; the hand-back clears it
      const untrusted = await create(h.dir('untrusted'));
      await h.service.startSession(untrusted, { message: OK_MESSAGE, options: {} });
      expect(intentFile(h, untrusted)?.message).toEqual(OK_MESSAGE);
      expect((await h.service.release(untrusted))?.message).toBeNull();
      // while a start is in flight: refused, naming why
      h.host.script = () => ({ ready: false });
      await h.service.startSession(id, { message: OK_MESSAGE, options: {} });
      const inFlight = { reason: 'starting', message: `starting: a start is in flight for ${id}` };
      await expect(h.service.release(id)).rejects.toMatchObject(inFlight);
      await expect(h.service.patch(id, { model: 'opus' })).rejects.toMatchObject(inFlight);
      await expect(h.service.startSession(id, { message: null, options: {} })).rejects.toMatchObject(inFlight);
    });

    it('a guard that cannot answer hands the message back before its error propagates', async () => {
      h.trustDirectory(h.work);
      const id = await create();
      await h.service.patch(id, { draft: DRAFT });
      h.host.relayError = 'relay check failed: EPIPE';
      await expect(h.service.startSession(id, { message: OK_MESSAGE, options: {} })).rejects.toThrow('relay check failed: EPIPE');
      expect(intentFile(h, id)).toMatchObject({ message: null, draft: DRAFT });
      expect(h.events.filter((e) => e.name === 'session.intent.changed').at(-1)?.payload).toMatchObject({ appSessionId: id, intent: { message: null } });
      expect(h.host.launches).toEqual([]);
    });

    it('discard removes the intent and forgets its journal when no record stands on it', async () => {
      const id = await create();
      expect(await h.service.discard(id)).toEqual({ leftover: null });
      expect(intentFile(h, id)).toBeNull();
      expect(h.host.forgotten).toEqual([id]);
      expect(await h.service.discard(id)).toEqual({ leftover: null });
    });
  });

  describe('start guards (a record: resume)', () => {
    const SID = sessionIdFor(0xabc);
    const recordAt = (dir: string, sessionId: SessionId = SID) => h.index.sessions.upsertFromSummary(summary({ sessionId, directory: dir })).record;

    it('answers archived, already_live, held, missing_directory, needs_trust in that precedence', async () => {
      const record = recordAt(h.work);
      h.index.sessions.update(record.appId, { archived: true });
      h.host.reserve(record.appId, { cwd: h.work });
      h.host.hold(SID, { kind: 'terminal', pid: 42 }, h.work);
      const start = () => h.service.startSession(record.appId, { message: null, options: {} });
      expect(await start()).toMatchObject({ status: 'archived' });
      h.index.sessions.update(record.appId, { archived: false });
      expect(await start()).toMatchObject({ status: 'already_live' });
      h.host.table.clear();
      expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'none' }); // the projection says none; the fresh read says held
      expect(await start()).toMatchObject({ status: 'held', holder: { kind: 'terminal', pid: 42 }, attach: null });
      h.host.disk.registry.length = 0;
      h.host.hold(SID, { kind: 'background_job', pid: 43, jobId: 'abcd1234' }, h.work);
      expect(await start()).toMatchObject({ status: 'held', attach: { jobId: 'abcd1234', command: "'/opt/engine/2.1.283' attach abcd1234" } });
      h.host.disk.registry.length = 0;
      const gone = recordAt(h.dir('gone'), sessionIdFor(0xabd));
      rmSync(join(h.root, 'gone'), { recursive: true });
      expect(await h.service.startSession(gone.appId, { message: null, options: {} })).toMatchObject({ status: 'missing_directory' });
      expect(await start()).toMatchObject({ status: 'needs_trust', trust: { trustKey: h.work } });
      expect(h.host.launches).toEqual([]);
    });

    it('refuses the guarded start with the registry’s own message when the registry cannot be read, and keeps no message', async () => {
      const record = recordAt(h.work);
      h.host.registryError = 'holder registry unreadable: EACCES';
      await expect(h.service.startSession(record.appId, { message: OK_MESSAGE, options: {} })).rejects.toThrow('holder registry unreadable: EACCES');
      h.host.registryError = null;
      await h.service.startSession(record.appId, { message: null, options: { trust: 'declined' } });
      expect(await h.settled(record.appId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'none' } });
      expect(h.host.calledWith('session.send')).toEqual([]);
    });

    it('a resume’s message retained behind the trust card is handed back by release, and the next plain resume sends nothing', async () => {
      const record = recordAt(h.work);
      expect(await h.service.startSession(record.appId, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'needs_trust' });
      expect(await h.service.release(record.appId)).toBeNull();
      await h.service.startSession(record.appId, { message: null, options: { trust: 'declined' } });
      expect(await h.settled(record.appId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'none' } });
      expect(h.host.calledWith('session.send')).toEqual([]);
      // an id with neither an intent nor a retained message
      await expect(h.service.release(record.appId)).rejects.toMatchObject({ reason: 'unknown_intent' });
    });

    // M5, acceptance item 13: the registry had no record yet when the guards read it, so the resume launched; the engine
    // refuses a second writer to a `--bg` session, and that refusal is the same `held` a fresh read would have answered
    it('a resume the engine refuses for a background job the fresh read missed fails held with the attach command; the record stays', async () => {
      h.trustDirectory(h.work);
      const record = recordAt(h.work);
      h.host.script = () => ({ exit: { error: 'Error: Session x is running as a background session (e6dcd828). Run `claude attach e6dcd828` to open it' } });
      expect(await h.service.startSession(record.appId, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'starting' });
      expect(await h.settled(record.appId)).toEqual({
        appSessionId: record.appId,
        phase: 'failed',
        detail: null,
        outcome: { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: 'e6dcd828' }, attach: { jobId: 'e6dcd828', command: "'/opt/engine/2.1.283' attach e6dcd828" } },
      });
      expect(h.host.launches).toHaveLength(1);
      expect(h.host.calledWith('session.send'), 'the message never reached the engine').toEqual([]);
      expect(h.index.sessions.get(record.appId)).toMatchObject({ appId: record.appId, engineSessionId: SID, archived: false });
    });

    it('a resume that fails after ready stops its process before telling the failure', async () => {
      h.trustDirectory(h.work);
      const record = recordAt(h.work);
      h.host.send = 'refuse';
      await h.service.startSession(record.appId, { message: OK_MESSAGE, options: {} });
      expect(await h.settled(record.appId)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: 'send refused', resources: { record: 'kept' } } });
      expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: record.appId, reason: 'stop' }]);
      expect(h.host.table.get(record.appId)!.process).toBe('exited');
    });

    it('resumes with resume.fork false, the record’s directories and model, attesting the key; unfollows once before the launch', async () => {
      const extra = h.dir('extra');
      // a session MAWS launched with an additional directory (`--add-dir` is not persisted by the engine: the record is)
      const created = h.index.sessions.createForLaunch({
        directory: h.work, additionalDirectories: [extra], worktree: null, model: { requested: 'opus', resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null },
      });
      if (!created.ok) throw new Error('no record');
      const record = h.index.sessions.bindEngineId(created.record.appId, SID);
      h.host.script = () => ({});
      expect(await h.service.startSession(record.appId, { message: OK_MESSAGE, options: { trust: 'accepted' } })).toMatchObject({ status: 'starting' });
      expect(await h.settled(record.appId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
      const real = h.host.launches.find((l) => l.appSessionId === record.appId)!;
      expect(real).toMatchObject({ resume: { sessionId: SID, fork: false }, sessionId: null, model: 'opus', cwd: h.work, additionalDirectories: [extra], trust: { accepted: true, directory: h.work }, inheritGrantsFrom: null });
      const bootstrap = h.host.launches.find((l) => l.appSessionId !== record.appId)!;
      expect(bootstrap.resume).toBeNull();
      const order = h.host.calls.map((c) => c.name).filter((n) => n === 'fs.unfollow' || n === 'session.launch');
      expect(order).toEqual(['session.launch', 'fs.unfollow', 'session.launch']); // the bootstrap, the handover, the resume
      expect(h.host.calledWith('fs.unfollow')).toEqual([{ appSessionId: record.appId, agentId: null }]);
      // the bootstrap touched nothing of the conversation's record
      expect(h.index.sessions.get(record.appId)).toMatchObject({ engineSessionId: SID, model: { requested: 'opus' } });
      expect(readdirSync(join(h.userData, 'sessions', 'bootstraps'))).toEqual([]);
    });

    it('a record with no engine id resumes as a fresh pinned session with no unfollow', async () => {
      h.trustDirectory(h.work);
      const created = h.index.sessions.createForLaunch({
        directory: h.work, additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null },
      });
      if (!created.ok) throw new Error('no record');
      await h.service.startSession(created.record.appId, { message: null, options: {} });
      await h.settled(created.record.appId);
      expect(h.host.launches[0]).toMatchObject({ resume: null, sessionId: null });
      expect(h.host.calledWith('fs.unfollow')).toEqual([]);
    });

    it('a resume’s bootstrap never touches the record, even when the app quits between the bootstrap and the real launch', async () => {
      const record = recordAt(h.work);
      h.index.transaction(() => h.index.sessions.applyEngineStatus(record.appId, { model: { requested: 'opus', resolved: 'claude-opus' }, effort: 'high', permissionMode: { requested: 'plan', effective: 'plan', refusal: null } }));
      const before = h.index.sessions.get(record.appId)!;
      h.host.launchHangs = (spec) => spec.appSessionId === record.appId; // the app dies at the real launch
      await h.service.startSession(record.appId, { message: null, options: { trust: 'accepted' } });
      await h.until(() => h.host.forgotten.length === 1);
      await h.restart();
      const after = h.index.sessions.get(record.appId)!;
      for (const key of ['engineSessionId', 'model', 'effort', 'permissionMode', 'directory'] as const) expect(after[key]).toEqual(before[key]);
      expect(readdirSync(join(h.userData, 'sessions', 'bootstraps'))).toEqual([]);
    });

    it('a failed unfollow fails the resume before anything launches', async () => {
      h.trustDirectory(h.work);
      const record = recordAt(h.work);
      h.host.unfollowError = 'unknown app session';
      await h.service.startSession(record.appId, { message: null, options: {} });
      expect(await h.settled(record.appId)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: expect.stringContaining('unknown app session') } });
      expect(h.host.launches).toEqual([]);
    });
  });

  describe('fork without a copy', () => {
    const SID = sessionIdFor(0xf0);
    const source = () => {
      h.trustDirectory(h.work);
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: SID, directory: h.work, customTitle: 'Plan' })).record;
      h.writeTranscript(h.work, SID);
      return record;
    };
    const projectFiles = () => readdirSync(join(h.trust.configHome, 'projects'), { recursive: true }).map(String).sort();

    it('forks in place with a pinned id, the source’s grants and no file copied, then renames it after the source', async () => {
      const src = source();
      const before = projectFiles();
      const outcome = await h.service.fork(src.appId, { kind: 'inPlace' }, { message: null, rewindTo: null });
      expect(outcome).toMatchObject({ status: 'starting' });
      const forkId = outcome.appSessionId;
      expect(forkId).not.toBe(src.appId);
      expect(await h.settled(forkId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'none' } });
      expect(projectFiles()).toEqual(before);
      const spec = h.host.launches[0]!;
      expect(spec).toMatchObject({ appSessionId: forkId, cwd: h.work, resume: { sessionId: SID, fork: true }, inheritGrantsFrom: src.appId });
      expect(spec.sessionId).not.toBeNull();
      expect(spec.sessionId).not.toBe(SID);
      expect(h.index.sessions.get(forkId)!.engineSessionId).toBe(spec.sessionId);
      expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: forkId, title: 'Plan (fork)' }]);
      expect(h.index.sessions.get(src.appId)!.engineSessionId).toBe(SID);
      expect(intentFile(h, forkId)).toBeNull(); // the intent went at ready
    });

    it('refuses busy while the source has a turn open, and no_engine_session for a record without an id', async () => {
      const src = source();
      h.host.reserve(src.appId, { cwd: h.work, turn: { id: 'x', origin: 'human', startedAt: '', acceptedAt: null, userMessageUuids: [] } as never });
      expect(await h.service.fork(src.appId, { kind: 'inPlace' }, { message: null, rewindTo: null })).toMatchObject({ status: 'refused', reason: 'busy' });
      h.index.sessions.unbindEngineId(src.appId);
      expect(await h.service.fork(src.appId, { kind: 'inPlace' }, { message: null, rewindTo: null })).toMatchObject({ status: 'refused', reason: 'no_engine_session' });
      expect(h.host.launches).toEqual([]);
    });

    // a fork its own start rejects (or whose guard throws) opens no tab, so its intent must not outlive the answer
    it('a fork whose start is rejected or throws leaves no intent behind, and says so', async () => {
      const src = source();
      const forkIntentIds = () => readdirSync(join(h.userData, 'sessions', 'intents')).filter((f) => f.endsWith('.json'));
      const dropped = () => h.events.filter((e) => e.name === 'session.intent.changed' && (e.payload as { intent: unknown }).intent === null).map((e) => (e.payload as { appSessionId: string }).appSessionId);
      rmSync(h.work, { recursive: true }); // the source's directory is gone: the fork's guard answers missing_directory
      const missing = await h.service.fork(src.appId, { kind: 'inPlace' }, { message: OK_MESSAGE, rewindTo: null });
      expect(missing).toMatchObject({ status: 'missing_directory' });
      expect(forkIntentIds()).toEqual([]);
      expect(await h.service.listIntents()).toEqual([]);
      expect(dropped()).toEqual([missing.appSessionId]);
      mkdirSync(h.work);
      h.host.relayError = 'relay check failed'; // a guard that cannot answer throws
      await expect(h.service.fork(src.appId, { kind: 'inPlace' }, { message: OK_MESSAGE, rewindTo: null })).rejects.toThrow('relay check failed');
      expect(forkIntentIds()).toEqual([]);
      expect(await h.service.listIntents()).toEqual([]);
      expect(dropped()).toHaveLength(2);
      expect(h.host.launches).toEqual([]);
    });

    it('rewinds first when asked, and rolls back without touching the source when the rewind is refused', async () => {
      const src = source();
      const rewindTo = 'u-1' as never;
      const ok = await h.service.fork(src.appId, { kind: 'inPlace' }, { message: OK_MESSAGE, rewindTo });
      await h.settled(ok.appSessionId);
      const calls = h.host.calls.map((c) => c.name);
      expect(calls.indexOf('session.rewind')).toBeLessThan(calls.indexOf('session.send'));
      h.host.rewound = false;
      const refused = await h.service.fork(src.appId, { kind: 'inPlace' }, { message: OK_MESSAGE, rewindTo });
      expect(await h.settled(refused.appSessionId)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', resources: { record: 'removed', transcript: 'none' } } });
      expect(h.index.sessions.get(refused.appSessionId)).toBeNull();
      expect(h.index.sessions.get(src.appId)).toMatchObject({ engineSessionId: SID, archived: false });
      expect(intentFile(h, refused.appSessionId)).toMatchObject({ kind: 'fork', message: OK_MESSAGE });
    });

    it('on relay_unreachable from C3 the retry re-runs the same fork with only the gateway changed and sends once', async () => {
      const src = source();
      let first = true;
      h.host.script = () => {
        if (first) {
          first = false;
          return { answer: { relay: DOWN_RELAY } };
        }
        return {};
      };
      const outcome = await h.service.fork(src.appId, { kind: 'inPlace' }, { message: OK_MESSAGE, rewindTo: null });
      expect(await h.settled(outcome.appSessionId)).toMatchObject({ phase: 'failed', outcome: { kind: 'relay_unreachable' } });
      expect(h.index.sessions.get(outcome.appSessionId)).toBeNull();
      await h.service.startSession(outcome.appSessionId, { message: null, options: { gateway: 'direct' } });
      await h.settled(outcome.appSessionId, 2);
      const [a, b] = h.host.launches;
      expect(b).toMatchObject({ ...a, gateway: 'direct' });
      expect(h.host.calledWith('session.send')).toHaveLength(1);
    });
  });

  describe('archive', () => {
    const SID = sessionIdFor(0xa1);
    it('refuses held, stops only a live session, sets archived and keeps the store file', async () => {
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: SID, directory: h.work })).record;
      h.host.hold(SID, { kind: 'terminal', pid: 9 }, h.work);
      expect(await h.service.archive(record.appId)).toEqual({ status: 'held', holder: { kind: 'terminal', pid: 9 } });
      h.host.disk.registry.length = 0;
      expect(await h.service.archive(record.appId)).toEqual({ archived: true });
      expect(h.host.calledWith('session.stop')).toEqual([]);
      h.index.sessions.update(record.appId, { archived: false });
      h.host.reserve(record.appId, { cwd: h.work });
      h.host.disk.stores.add(record.appId);
      expect(await h.service.archive(record.appId)).toEqual({ archived: true });
      expect(h.host.calledWith('session.stop')).toEqual([{ appSessionId: record.appId, reason: 'archive' }]);
      expect(h.index.sessions.get(record.appId)!.archived).toBe(true);
      expect(h.host.disk.stores.has(record.appId)).toBe(true);
    });

    it('onlyIfIdle archives an idle session and skips, never stops, one that resumed after the snapshot', async () => {
      h.trustDirectory(h.work);
      const idle = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xa2), directory: h.work })).record;
      const resumed = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0xa3), directory: h.work })).record;
      await h.service.startSession(resumed.appId, { message: null, options: {} });
      await h.settled(resumed.appId);
      expect(await h.service.archive(idle.appId, { onlyIfIdle: true })).toEqual({ archived: true });
      expect(await h.service.archive(resumed.appId, { onlyIfIdle: true })).toEqual({ status: 'skipped_live', holder: { kind: 'self' } });
      expect(h.host.calledWith('session.stop')).toEqual([]);
      expect(h.index.sessions.get(resumed.appId)!.archived).toBe(false);
    });
  });

  describe('delete manifest', () => {
    const SID = sessionIdFor(0xde);
    const conversation = () => {
      const transcript = h.writeTranscript(h.work, SID);
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: SID, directory: h.work, transcriptPath: transcript, slug: '-work' })).record;
      const dir = join(transcript, '..');
      mkdirSync(join(dir, SID, 'subagents'), { recursive: true });
      writeFileSync(join(dir, `${SID}.ccr-tip.json`), '{}');
      writeFileSync(join(dir, `${SID}-20260928T120000.cast`), '');
      return { record, dir, transcript };
    };

    it('refuses held and live, and moves nothing when the stop is not confirmed', async () => {
      const { record, transcript } = conversation();
      h.host.hold(SID, { kind: 'background_job', pid: 1, jobId: 'abcd1234' }, h.work);
      expect(await h.service.remove(record.appId, true)).toMatchObject({ status: 'held' });
      h.host.disk.registry.length = 0;
      h.host.reserve(record.appId, { cwd: h.work });
      expect(await h.service.remove(record.appId, false)).toEqual({ status: 'live' });
      h.host.stopExits = false;
      expect(await h.service.remove(record.appId, true)).toMatchObject({ status: 'stop_unconfirmed' });
      expect(existsSync(transcript)).toBe(true);
      expect(h.trashed).toEqual([]);
    });

    it('moves recordings, siblings, the sidecar and the transcript last; forgets C3’s files and removes the record', async () => {
      const { record, dir } = conversation();
      h.host.disk.stores.add(record.appId);
      expect(await h.service.remove(record.appId, false)).toEqual({
        status: 'deleted',
        trashed: [join(dir, `${SID}-20260928T120000.cast`), join(dir, `${SID}.ccr-tip.json`), join(dir, SID), join(dir, `${SID}.jsonl`)],
      });
      expect(h.index.sessions.get(record.appId)).toBeNull();
      expect(h.host.disk.stores.has(record.appId)).toBe(false);
      expect(existsSync(join(h.userData, 'sessions', 'deletions', `${record.appId}.json`))).toBe(false);
    });

    it('answers partial naming the failed path with the transcript untouched and the record kept, and completes on retry', async () => {
      const { record, dir, transcript } = conversation();
      h.trashFails = (path) => (path === join(dir, `${SID}.ccr-tip.json`) ? 'EPERM' : null);
      expect(await h.service.remove(record.appId, false)).toEqual({ status: 'partial', trashed: [join(dir, `${SID}-20260928T120000.cast`)], failed: { path: join(dir, `${SID}.ccr-tip.json`), error: 'EPERM' } });
      expect(existsSync(transcript)).toBe(true);
      expect(h.index.sessions.get(record.appId)).not.toBeNull();
      expect(existsSync(join(h.userData, 'sessions', 'deletions', `${record.appId}.json`))).toBe(true);
      h.trashFails = null;
      expect(await h.service.remove(record.appId, false)).toMatchObject({ status: 'deleted', trashed: [join(dir, `${SID}.ccr-tip.json`), join(dir, SID), transcript] });
      expect(h.index.sessions.get(record.appId)).toBeNull();
    });

    it('previews what a delete would move: the transcript, its subagent transcripts and its recordings, moving nothing', async () => {
      const { record, dir, transcript } = conversation();
      writeFileSync(join(dir, SID, 'subagents', 'agent-a1.jsonl'), '');
      writeFileSync(join(dir, SID, 'subagents', 'agent-a2.jsonl'), '');
      writeFileSync(join(dir, SID, 'subagents', 'agent-a2.meta.json'), '{}');
      expect(await h.service.previewDeletion(record.appId)).toEqual({ transcript, subagents: 2, recordings: 1, paths: 4 });
      expect(h.trashed).toEqual([]);
      expect(existsSync(join(h.userData, 'sessions', 'deletions', `${record.appId}.json`))).toBe(false);
    });

    it('lists an interrupted deletion for the session tab, and Keep drops its manifest and leaves the conversation', async () => {
      const { record, dir, transcript } = conversation();
      expect(await h.service.listDeletions()).toEqual([]);
      h.trashFails = (path) => (path === join(dir, `${SID}.ccr-tip.json`) ? 'EPERM' : null);
      await h.service.remove(record.appId, false);
      expect(await h.service.listDeletions()).toEqual([
        {
          appSessionId: record.appId,
          engineSessionId: SID,
          paths: [join(dir, `${SID}-20260928T120000.cast`), join(dir, `${SID}.ccr-tip.json`), join(dir, SID), transcript],
          trashed: [join(dir, `${SID}-20260928T120000.cast`)],
          createdAt: expect.any(String),
        },
      ]);
      await h.service.keepDeletion(record.appId);
      expect(await h.service.listDeletions()).toEqual([]);
      expect(existsSync(transcript)).toBe(true);
      expect(h.index.sessions.get(record.appId)).not.toBeNull();
    });

    it('ignores the archive fs.sessionRemoved makes between the transcript move and the removal', async () => {
      const { record, transcript } = conversation();
      h.trashFails = (path) => {
        if (path === transcript) h.host.emitEvent('fs.sessionRemoved', { sessionId: SID, appSessionId: record.appId });
        return null;
      };
      expect(await h.service.remove(record.appId, false)).toMatchObject({ status: 'deleted' });
      expect(h.index.sessions.get(record.appId)).toBeNull();
    });
  });

  describe('rename routing', () => {
    it('renames a ready session through the engine and an exited one through the override', async () => {
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x7e), directory: h.work })).record;
      expect(await h.service.rename(record.appId, '  Named here  ')).toMatchObject({ via: 'override', record: { title: { text: 'Named here', source: 'user' } } });
      h.host.reserve(record.appId, { cwd: h.work, process: 'ready' });
      expect(await h.service.rename(record.appId, 'Live name')).toMatchObject({ via: 'engine' });
      expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: record.appId, title: 'Live name' }]);
    });
  });

  describe('D-16 reset', () => {
    it('clears every self holder at start, before anything else answers', async () => {
      const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x16), directory: h.work })).record;
      h.index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' } });
      await h.restart();
      expect(h.index.sessions.get(record.appId)!.holder).toEqual({ kind: 'none' });
    });

    it('forgets every bootstrap id a previous run left, in an intent or a resume note, and launches nothing', async () => {
      const id = await create();
      h.host.stopExits = false;
      await h.service.startSession(id, { message: null, options: { trust: 'accepted' } });
      await h.settled(id);
      const bootstrapId = intentFile(h, id)!.progress.bootstrap!.appSessionId;
      mkdirSync(join(h.userData, 'sessions', 'bootstraps'), { recursive: true });
      writeFileSync(join(h.userData, 'sessions', 'bootstraps', '99999999-9999-4999-8999-999999999999.json'), JSON.stringify({ bootstrapId: '99999999-9999-4999-8999-999999999999', appSessionId: id, at: '' }));
      await h.restart();
      expect(h.host.forgotten.sort()).toEqual([bootstrapId, '99999999-9999-4999-8999-999999999999'].sort());
      expect(intentFile(h, id)!.progress.bootstrap).toBeNull();
      expect(readdirSync(join(h.userData, 'sessions', 'bootstraps'))).toEqual([]);
      expect(h.host.launches).toEqual([]);
    });
  });

  describe('trust and reveal', () => {
    it('reads trust with the engine’s environment, and reveals only known places', async () => {
      h.trustDirectory(h.work);
      const link = join(h.root, 'link');
      symlinkSync(h.work, link);
      expect(await h.service.trustCheck(link)).toMatchObject({ trustKey: h.work, trusted: true, configPath: join(h.trust.configHome, '.claude.json') });
      h.index.projects.add(h.work);
      await expect(h.service.revealPath(h.work)).resolves.toBeUndefined();
      await expect(h.service.revealPath(h.root)).rejects.toThrow('not a project');
    });
  });
});
