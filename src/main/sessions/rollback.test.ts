import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { Location, SetupIntent } from '@shared/sessions/intent';
import { runGit } from '../../../test/support/git-fixture';
import { summary } from '../../../test/support/index-fixture';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import { SessionHarness } from '../../../test/support/session-harness';
import { DOWN_RELAY } from '../../../test/support/session-host';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const MESSAGE = { content: 'hello', display: 'hello' };
const REFUSED = { answer: { refused: 'binary_missing' as const, message: 'no engine binary' } };

function intentFile(h: SessionHarness, id: string): SetupIntent | null {
  const path = join(h.userData, 'sessions', 'intents', `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SetupIntent) : null;
}

// Rollback per resource and the retained worktree (C10 execution document, Interfaces "Rollback" and the patch rules),
// over the real worktree service and a scratch repository; the index is real, the engine host is the fake.
describe('rollback per resource', () => {
  let h: SessionHarness;
  let repo: ScratchRepo;
  let hooks: string;
  beforeEach(async () => {
    h = await new SessionHarness().start();
    repo = await ScratchRepo.create({ sentinels: false });
    h.trustDirectory(repo.root);
    hooks = h.dir('hooks');
  });
  afterEach(() => {
    if (existsSync(join(repo.root, '.claude', 'worktrees'))) chmodSync(join(repo.root, '.claude', 'worktrees'), 0o755);
    repo.dispose();
    h.dispose();
  });

  const worktree = (name: string): Location => ({ kind: 'newWorktree', repoRoot: repo.root, name, branch: { kind: 'new', name: `worktree-${name}`, base: 'HEAD' } });
  const managed = (name: string) => join(repo.root, '.claude', 'worktrees', name);
  const create = async (location: Location) => (await h.service.create({ projectId: null, location })).appSessionId;
  // a post-checkout hook, as `git worktree add` runs it, in the repository's own configuration
  const hook = async (body: string) => {
    writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(hooks, 'post-checkout'), 0o755);
    await runGit(repo.root, ['config', 'core.hooksPath', hooks]);
  };

  describe('rollback per resource', () => {
    it('a refused launch removes the worktree, its branch and the record, clears progress.worktree, and a retry creates afresh', async () => {
      const id = await create(worktree('one'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      const failed = await h.settled(id);
      expect(h.setupEvents(id).map((e) => [e.phase, e.detail])).toEqual([
        ['worktree', 'Creating worktree one'],
        ['launching', 'Starting'],
        ['failed', null],
      ]);
      expect(failed.outcome).toMatchObject({
        kind: 'error',
        message: 'binary_missing: no engine binary',
        resources: { worktree: { path: managed('one'), branch: 'worktree-one', createdHere: true, state: 'removed', branchState: 'deleted' }, record: 'removed', transcript: 'none' },
      });
      expect(existsSync(managed('one'))).toBe(false);
      expect(await repo.hasBranch('worktree-one')).toBe(false);
      expect(h.index.sessions.get(id)).toBeNull();
      expect(intentFile(h, id)).toMatchObject({ message: MESSAGE, progress: { worktree: null, lastFailure: { phase: 'launching' } } });
      h.host.script = () => ({});
      await h.service.startSession(id, { message: null, options: {} });
      expect(await h.settled(id, 2)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
      expect(h.host.launches.at(-1)).toMatchObject({ cwd: managed('one') });
      expect(h.index.sessions.get(id)).toMatchObject({ directory: managed('one'), worktree: { path: managed('one'), branch: 'worktree-one' } });
    });

    it('a worktree a hook dirtied is kept (remove_refused, branch kept), a location patch is refused, and a retry reuses it through retry validation', async () => {
      await hook('echo dirt > dirty.txt');
      const id = await create(worktree('dirty'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect((await h.settled(id)).outcome).toMatchObject({
        resources: { worktree: { state: 'remove_refused', detail: 'dirty: 1 uncommitted change', branchState: 'kept' }, record: 'removed' },
      });
      expect(existsSync(managed('dirty'))).toBe(true);
      expect(intentFile(h, id)!.progress.worktree).toMatchObject({ path: managed('dirty'), createdHere: true });
      await expect(h.service.patch(id, { location: { kind: 'directory', path: repo.root } })).rejects.toMatchObject({ reason: 'retained_worktree' });
      h.host.script = () => ({});
      expect(await h.service.startSession(id, { message: null, options: {} })).toMatchObject({ status: 'starting' });
      expect(await h.settled(id, 2)).toMatchObject({ phase: 'ready' });
      expect(h.setupEvents(id).filter((e) => e.phase === 'worktree')).toHaveLength(1); // reused, not created again
      expect(h.host.launches.at(-1)).toMatchObject({ cwd: managed('dirty') });
    });

    it('a retry after the retained checkout’s branch moved by hand answers invalid naming the change', async () => {
      await hook('echo dirt > dirty.txt');
      const id = await create(worktree('moved'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      await h.settled(id);
      await runGit(managed('moved'), ['checkout', '-q', '-b', 'elsewhere']);
      expect(await h.service.startSession(id, { message: null, options: {} })).toMatchObject({ status: 'invalid', field: 'location', message: expect.stringContaining('retained worktree changed') });
    });

    it('a late relay_unreachable keeps the created worktree and the retry with direct reuses it', async () => {
      const id = await create(worktree('relay'));
      let first = true;
      h.host.script = () => {
        if (!first) return {};
        first = false;
        return { answer: { relay: DOWN_RELAY } };
      };
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect(await h.settled(id)).toMatchObject({ phase: 'failed', outcome: { kind: 'relay_unreachable' } });
      expect(existsSync(managed('relay'))).toBe(true);
      expect(h.index.sessions.get(id)).toBeNull();
      await h.service.startSession(id, { message: null, options: { gateway: 'direct' } });
      expect(await h.settled(id, 2)).toMatchObject({ phase: 'ready' });
      expect(h.host.launches.map((l) => [l.cwd, l.gateway])).toEqual([
        [managed('relay'), 'gateway'],
        [managed('relay'), 'direct'],
      ]);
      expect(h.host.calledWith('session.send')).toHaveLength(1);
    });

    it('a hook that commits keeps the branch: rollback removes the clean checkout and reports delete_refused', async () => {
      await hook('git -c user.name=h -c user.email=h@localhost commit -q --allow-empty -m hook');
      const id = await create(worktree('commits'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect((await h.settled(id)).outcome).toMatchObject({ resources: { worktree: { state: 'removed', branchState: 'delete_refused', detail: 'unmerged: 1 commit not on main' } } });
      expect(existsSync(managed('commits'))).toBe(false);
      expect(await repo.hasBranch('worktree-commits')).toBe(true);
      expect(intentFile(h, id)!.progress.worktree).toBeNull();
    });

    it('a hook that commits and dirties: "Discard changes and remove" removes the checkout and keeps the branch (delete_refused)', async () => {
      await hook('git -c user.name=h -c user.email=h@localhost commit -q --allow-empty -m hook && echo dirt > dirty.txt');
      const id = await create(worktree('both'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect((await h.settled(id)).outcome).toMatchObject({ resources: { worktree: { state: 'remove_refused', branchState: 'kept' } } });
      const { worktree: resource, intent } = await h.service.resolveRetainedWorktree(id, 'discard');
      expect(resource).toMatchObject({ state: 'removed', branchState: 'delete_refused' });
      expect(existsSync(managed('both'))).toBe(false);
      expect(await repo.hasBranch('worktree-both')).toBe(true);
      expect(intent.progress.worktree).toBeNull();
    });

    it('"Keep the worktree" turns the location into that existing worktree and a location patch is accepted again', async () => {
      await hook('echo dirt > dirty.txt');
      const id = await create(worktree('keep'));
      h.host.script = () => REFUSED;
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      await h.settled(id);
      const { intent } = await h.service.resolveRetainedWorktree(id, 'keep');
      expect(intent.location).toEqual({ kind: 'existingWorktree', repoRoot: repo.root, path: managed('keep') });
      expect(intent.progress.worktree).toMatchObject({ createdHere: false });
      expect(await h.service.patch(id, { location: { kind: 'directory', path: repo.root } })).toMatchObject({ location: { kind: 'directory' } });
      expect(existsSync(managed('keep'))).toBe(true);
    });

    it('a removal git cannot do is remove_failed with git’s message, and the intent stays', async () => {
      const id = await create(worktree('stuck'));
      h.host.script = () => {
        chmodSync(join(repo.root, '.claude', 'worktrees'), 0o555); // git cannot delete the checkout's directory
        return REFUSED;
      };
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect((await h.settled(id)).outcome).toMatchObject({ resources: { worktree: { state: 'remove_failed', detail: expect.any(String), branchState: 'kept' } } });
      expect(intentFile(h, id)).toMatchObject({ message: MESSAGE, progress: { worktree: { createdHere: true } } });
    });

    it('a launch that wrote a transcript under the pin keeps and binds its record, keeps the worktree, drops the intent, trashes nothing', async () => {
      const id = await create(worktree('kept'));
      let transcript = '';
      h.host.script = (spec) => {
        transcript = h.writeTranscript(spec.cwd, spec.sessionId!);
        return { exit: { error: 'the model is not available' } };
      };
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect(await h.settled(id)).toMatchObject({
        phase: 'failed',
        outcome: { kind: 'error', resources: { record: 'kept', transcript: 'kept', worktree: { state: 'kept', branchState: 'kept' } } },
      });
      expect(existsSync(transcript)).toBe(true);
      expect(existsSync(managed('kept'))).toBe(true);
      expect(intentFile(h, id)).toBeNull();
      expect(h.index.sessions.get(id)!.engineSessionId).toBe(h.host.launches[0]!.sessionId);
    });

    it('with the record rebound by a /clear after the pin, the transcript-keeping rollback leaves that id bound', async () => {
      const id = await create({ kind: 'directory', path: repo.root });
      const cleared = '00000000-0000-4000-8000-00000000c1ea' as SessionId;
      h.host.script = (spec) => {
        h.writeTranscript(spec.cwd, spec.sessionId!);
        return {};
      };
      // once C4 has bound the pin from the ready status, a `/clear` moves the record to the new transcript (C4's rebind)
      h.host.onEvent('session.status', ({ appSessionId, status }) => {
        if (appSessionId !== id || status.process !== 'ready') return;
        h.host.table.set(id, { ...status, engineSessionId: cleared }); // the engine reports the new transcript's id from here
        h.index.sessions.bindEngineId(id as AppSessionId, cleared);
      });
      h.host.send = 'refuse'; // the send fails after ready, so the setup fails with the conversation on disk
      await h.service.startSession(id, { message: MESSAGE, options: {} });
      expect(await h.settled(id)).toMatchObject({ outcome: { resources: { record: 'kept', transcript: 'kept' } } });
      expect(h.index.sessions.get(id)!.engineSessionId).toBe(cleared);
    });
  });

  it('forks to a new worktree: the worktree under the repository root, the fork launched there with the pin, the source untouched', async () => {
    const sid = '00000000-0000-4000-8000-0000000f0f0f' as SessionId;
    const source = h.index.sessions.upsertFromSummary(summary({ sessionId: sid, directory: repo.root })).record;
    const outcome = await h.service.fork(source.appId, { kind: 'newWorktree', name: 'forked', branch: { kind: 'new', name: 'worktree-forked', base: 'HEAD' } }, { message: MESSAGE, rewindTo: null });
    expect(outcome).toMatchObject({ status: 'starting' });
    expect(await h.settled(outcome.appSessionId)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });
    expect(h.setupEvents(outcome.appSessionId)[0]).toMatchObject({ phase: 'worktree', detail: 'Creating worktree forked' });
    expect(h.host.launches[0]).toMatchObject({ appSessionId: outcome.appSessionId, cwd: managed('forked'), resume: { sessionId: sid, fork: true }, inheritGrantsFrom: source.appId });
    expect(h.index.sessions.get(outcome.appSessionId)).toMatchObject({ directory: managed('forked'), worktree: { path: managed('forked'), branch: 'worktree-forked' } });
    expect(h.index.sessions.get(source.appId)).toMatchObject({ engineSessionId: sid, directory: repo.root });
  });

  it('two starts creating one worktree path: the second is refused while the first is in flight', async () => {
    const a = await create(worktree('same'));
    const b = await create(worktree('same'));
    h.host.script = () => ({ ready: false });
    expect(await h.service.startSession(a, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    await h.until(() => existsSync(managed('same')));
    const second = await h.service.startSession(b, { message: MESSAGE, options: {} });
    expect(second).toMatchObject({ status: 'invalid', field: 'location' });
    await h.until(() => h.host.launches.length > 0);
    expect(h.host.launches.map((l) => l.appSessionId)).toEqual([a]); // the refused start launched nothing
  });

  it('patch refuses a new worktree the rules refuse, naming the location: a bad name, a taken path, a branch that exists, is missing or is checked out', async () => {
    const id = await create({ kind: 'directory', path: repo.root });
    const refused = (location: Location) => h.service.patch(id, { location });
    await expect(refused(worktree('-bad'))).rejects.toMatchObject({ reason: 'invalid', field: 'location', message: "location: Worktree name cannot start with '-'" });
    await repo.addManagedWorktree('taken');
    await expect(refused({ ...worktree('taken'), branch: { kind: 'new', name: 'worktree-other', base: 'HEAD' } })).rejects.toMatchObject({ field: 'location', message: 'location: worktree path exists' });
    await expect(refused({ ...worktree('fresh'), branch: { kind: 'new', name: 'main', base: 'HEAD' } })).rejects.toMatchObject({ field: 'location', message: 'location: branch exists' });
    await expect(refused({ ...worktree('fresh'), branch: { kind: 'existing', name: 'nope' } })).rejects.toMatchObject({ field: 'location', message: 'location: branch missing' });
    await expect(refused({ ...worktree('fresh'), branch: { kind: 'existing', name: 'worktree-taken' } })).rejects.toMatchObject({
      field: 'location',
      message: `location: branch checked out at ${managed('taken')}`,
    });
    expect(await refused(worktree('fresh'))).toMatchObject({ location: { kind: 'newWorktree', name: 'fresh' } });
  });

  it('two starts issued together for one new worktree: the second is refused before either adds, and the first’s checkout and branch stay', async () => {
    const a = await create(worktree('race'));
    const b = await create(worktree('race'));
    h.host.script = () => ({ ready: false });
    const [first, second] = await Promise.all([
      h.service.startSession(a, { message: null, options: {} }),
      h.service.startSession(b, { message: MESSAGE, options: {} }),
    ]);
    expect(first).toMatchObject({ status: 'starting' });
    expect(['invalid', 'starting']).toContain((second as { status: string }).status);
    if (second.status === 'invalid') expect(second.field).toBe('location');
    await h.until(() => h.host.launches.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100)); // anything B would have done has had its chance
    expect(existsSync(managed('race'))).toBe(true);
    expect(await repo.hasBranch('worktree-race')).toBe(true);
    expect(h.host.launches.map((l) => l.appSessionId)).toEqual([a]);
    expect(intentFile(h, b)!.progress.worktree).toBeNull();
    expect(h.setupEvents(b)).toEqual([]);
  });

  it('a branch a terminal created between the guards and the add is refused, never read back as this attempt’s, and nothing is deleted', async () => {
    const id = await create(worktree('terminal'));
    const add = h.worktrees.add.bind(h.worktrees);
    h.worktrees.add = async (input) => {
      await runGit(repo.root, ['branch', 'worktree-terminal']); // the owner's terminal, in the window after the guards
      return add(input);
    };
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: 'branch exists', resources: { worktree: null, record: 'none' } } });
    expect(await repo.hasBranch('worktree-terminal')).toBe(true);
    expect(intentFile(h, id)!.progress.worktree).toBeNull();
  });

  it('a failing post-checkout hook fails git’s own add: what it left is read back as this attempt’s and rolled back', async () => {
    await hook('exit 1');
    const id = await create(worktree('hookfail'));
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({
      phase: 'failed',
      outcome: { kind: 'error', resources: { worktree: { path: managed('hookfail'), createdHere: true, state: 'removed', branchState: 'deleted' }, record: 'none' } },
    });
    expect(existsSync(managed('hookfail'))).toBe(false);
    expect(await repo.hasBranch('worktree-hookfail')).toBe(false);
    expect(h.host.launches).toEqual([]);
  });

  it('a start arriving while another start of the same intent is still guarding is refused starting', async () => {
    const id = await create(worktree('guarding'));
    h.host.script = () => ({ ready: false });
    const results = await Promise.allSettled([h.service.startSession(id, { message: null, options: {} }), h.service.startSession(id, { message: null, options: {} })]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { status: 'starting' } });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { reason: 'starting', message: `starting: a start is in flight for ${id}` } });
    await h.until(() => h.host.launches.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.host.launches).toHaveLength(1);
  });

  it('trust follows the key: a decision for the repository does not carry to a plain directory', async () => {
    h.trust.write({}); // nothing trusted
    const id = await create(worktree('trust'));
    await h.service.patch(id, { trust: 'accepted' });
    h.host.script = () => REFUSED;
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    await h.settled(id);
    expect(intentFile(h, id)).toMatchObject({ trust: 'accepted', trustKey: repo.root });
    const plain = h.dir('plain');
    // the failed attempt's checkout was clean and is gone, so the location is editable
    expect(await h.service.patch(id, { location: { kind: 'directory', path: plain } })).toMatchObject({ trust: 'unanswered', trustKey: null, progress: { trustRecorded: false } });
    const launches = h.host.launches.length;
    expect(await h.service.startSession(id, { message: null, options: {} })).toMatchObject({ status: 'needs_trust', trust: { trustKey: plain } });
    expect(h.host.launches).toHaveLength(launches);
  });
});
