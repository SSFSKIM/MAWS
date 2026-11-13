// `scm.*` through the services bus, routed as main's router routes them: every command reaches the service with the session id as sent (a run with its kind),
// refusals arrive as values, a git timeout as `timeout` and anything else as `internal`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName } from '@shared/ipc/schema';
import { record as sessionRecord } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { GitFixture } from '../../../test/support/git-fixture';
import { TrustStoreFixture } from '../../../test/support/trust-store';
import { GitTimeoutError } from '../git/runner';
import { endableClientRef } from '@shared/ipc/client';
import { registerScmHandlers, SCM_HOME_REFUSAL } from './register';
import { ScmService, type ScmServiceDeps } from './service';

const appSessionId = 'a1111111-1111-4111-8111-111111111111';

describe('main answers scm.* on the services bus', () => {
  let service: { [K in Exclude<keyof ScmService, 'dispose' | 'runs'>]: ReturnType<typeof vi.fn> }; // P5 O3-E: runs, the root's settling
  let bus: FakeBus;
  beforeEach(() => {
    service = {
      status: vi.fn(), stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), commit: vi.fn(), planPush: vi.fn(), planPr: vi.fn(), run: vi.fn(),
      cancel: vi.fn(), last: vi.fn(), prState: vi.fn(), coversHomeAt: vi.fn(async () => false),
    };
    bus = fakeBus();
    registerScmHandlers(service as unknown as ScmService, bus);
  });
  const invoke = (name: string, input?: unknown) => bus.invoke(name as CommandName, input);

  // 2026-11-06 (the home-root rule): another machine's request (the endpoint seam's `remote`) on a session whose checkout is
  // the machine's home, or above it, runs nothing; this machine's own client's runs as before, its checkout never asked.
  // UX wave U8c-2 (M3 decision 8): the check is a guard every command is handed for a remote request, which the service
  // awaits on the folder it captured; the handler reads no record of its own.
  it('hands a remote request a guard that refuses a checkout working in the machine’s home, and a local one none', async () => {
    const remote = { client: endableClientRef('endpoint'), remote: true as const };
    const status = { directory: '/r', repository: false, trusted: false, trustKey: '/r', remotes: [], defaultRemote: null, defaultBase: null, gh: { state: 'missing' }, checkedAt: 'now' };
    service.status.mockImplementation(async (_id: string, _options: unknown, guard?: (folder: string) => Promise<void>) => {
      await guard?.('/r'); // as the service awaits it, on the folder it captured
      return status;
    });
    service.stage.mockImplementation(async (_input: unknown, guard?: (folder: string) => Promise<void>) => {
      await guard?.('/r');
      return { refused: 'untrusted', detail: 'x', output: '' };
    });
    service.coversHomeAt.mockResolvedValue(true);
    expect(await bus.invoke('scm.status', { appSessionId }, remote)).toEqual({ ok: false, error: { code: 'internal', message: SCM_HOME_REFUSAL } });
    expect(await bus.invoke('scm.stage', { appSessionId, paths: ['a.txt'] }, remote)).toEqual({ ok: false, error: { code: 'internal', message: SCM_HOME_REFUSAL } });
    expect(service.coversHomeAt).toHaveBeenCalledWith('/r', expect.any(Array));
    for (const name of ['status', 'stage'] as const) expect(service[name].mock.calls.at(-1)!.at(-1), name).toEqual(expect.any(Function));
    service.coversHomeAt.mockClear();
    expect(await invoke('scm.status', { appSessionId })).toMatchObject({ ok: true, value: { directory: '/r' } });
    expect(service.status.mock.calls.at(-1)).toEqual([appSessionId, {}, undefined]);
    expect(service.coversHomeAt).not.toHaveBeenCalled();
    service.coversHomeAt.mockResolvedValue(false);
    expect(await bus.invoke('scm.status', { appSessionId }, remote)).toMatchObject({ ok: true, value: { directory: '/r' } });
  });

  it('passes each command its input and answers a refusal as a value', async () => {
    const refusal = { refused: 'untrusted', detail: 'MAWS runs git here only after you trust the folder in a session', output: '' };
    for (const name of ['stage', 'unstage', 'discard', 'commit'] as const) service[name].mockResolvedValue(refusal);
    const inputs = {
      stage: { appSessionId, paths: ['a.txt'] },
      unstage: { appSessionId, paths: ['a.txt'] },
      discard: { appSessionId, entries: [{ path: 'a.txt', group: 'unstaged' }] },
      commit: { appSessionId, message: 'x', noVerify: false },
    };
    for (const [name, input] of Object.entries(inputs)) {
      expect(await invoke(`scm.${name}`, input), name).toEqual({ ok: true, value: refusal });
      expect(service[name as keyof typeof inputs]).toHaveBeenCalledWith(input, undefined);
    }
    service.status.mockResolvedValue({
      directory: '/r', repository: false, trusted: false, trustKey: '/r', remotes: [], defaultRemote: null, defaultBase: null, gh: { state: 'missing' }, checkedAt: 'now',
    });
    expect(await invoke('scm.status', { appSessionId })).toMatchObject({ ok: true, value: { directory: '/r' } });
    expect(service.status).toHaveBeenCalledWith(appSessionId, {}, undefined);
  });

  it('binds the plans, the runs by kind, cancel, the latest run and PR state', async () => {
    const token = '11111111-1111-4111-8111-111111111111';
    const expired = { refused: 'plan_expired', detail: 'This confirmation is no longer valid; review the command again', output: '' };
    service.planPush.mockResolvedValue(expired);
    service.planPr.mockResolvedValue(expired);
    service.run.mockResolvedValue({ started: true, token });
    service.cancel.mockResolvedValue(undefined);
    service.last.mockResolvedValue(null);
    service.prState.mockResolvedValue({ checkedAt: 'now', branch: null, gh: { state: 'missing' }, pr: null, error: 'untrusted' });

    expect(await invoke('scm.push.plan', { appSessionId, remote: 'origin' })).toEqual({ ok: true, value: expired });
    expect(service.planPush).toHaveBeenCalledWith({ appSessionId, remote: 'origin' }, undefined);
    const pr = { appSessionId, title: 'T', body: '', base: 'main', draft: true };
    expect(await invoke('scm.pr.plan', pr)).toEqual({ ok: true, value: expired });
    expect(service.planPr).toHaveBeenCalledWith(pr, undefined);
    expect(await invoke('scm.push', { appSessionId, token })).toEqual({ ok: true, value: { started: true, token } });
    expect(service.run).toHaveBeenLastCalledWith({ appSessionId, token }, 'push', undefined);
    expect(await invoke('scm.pr.create', { appSessionId, token })).toEqual({ ok: true, value: { started: true, token } });
    expect(service.run).toHaveBeenLastCalledWith({ appSessionId, token }, 'pr', undefined);
    expect(await invoke('scm.remote.cancel', { appSessionId, token })).toEqual({ ok: true, value: undefined });
    expect(service.cancel).toHaveBeenCalledWith({ appSessionId, token }, undefined);
    expect(await invoke('scm.remote.last', { appSessionId })).toEqual({ ok: true, value: null });
    expect(service.last).toHaveBeenCalledWith(appSessionId, undefined);
    expect(await invoke('scm.pr.state', { appSessionId, refresh: true })).toMatchObject({ ok: true, value: { error: 'untrusted' } });
    expect(service.prState).toHaveBeenCalledWith({ appSessionId, refresh: true }, undefined);
    // a token is a uuid: anything else never reaches the service
    expect(await invoke('scm.push', { appSessionId, token: 'push origin main' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(service.run).toHaveBeenCalledTimes(2);
  });

  it('answers timeout for a git timeout and internal for anything else', async () => {
    service.commit.mockRejectedValue(new GitTimeoutError('git commit timed out after 60 s in /r'));
    expect(await invoke('scm.commit', { appSessionId, message: 'x', noVerify: false })).toEqual({ ok: false, error: { code: 'timeout', message: 'git commit timed out after 60 s in /r' } });
    service.stage.mockRejectedValue(new Error(`unknown app session: ${appSessionId}`));
    expect(await invoke('scm.stage', { appSessionId, paths: ['a'] })).toEqual({ ok: false, error: { code: 'internal', message: `unknown app session: ${appSessionId}` } });
    expect(await invoke('scm.stage', { appSessionId, paths: [] })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

// UX wave U8c-2, M3 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, decision 8): for a request from
// another machine the home rule is judged on the folder the request then uses, from one read of the record, so a record
// whose working folder changes while the check is under way cannot send git to a folder the check never judged.
describe('a remote request’s home check and its git calls name one folder', () => {
  let repo: GitFixture;
  let trust: TrustStoreFixture;
  afterEach(() => {
    repo.dispose();
    trust.dispose();
  });

  it('runs a read at the folder the home check judged, though the record’s working folder is replaced while the check is held', async () => {
    repo = await GitFixture.create();
    trust = new TrustStoreFixture();
    const [first, second] = [await repo.addWorktree('first'), await repo.addWorktree('second')];
    trust.write({ [first]: { hasTrustDialogAccepted: true }, [second]: { hasTrustDialogAccepted: true } });
    const id = appSessionId as AppSessionId;
    const view = fakeSpineView();
    const movedTo = (folder: string) => view.putRecord(sessionRecord(id, { directory: repo.root, worktree: null, agentFolder: { checkout: folder, cwd: folder, branch: null, linked: true } }));
    movedTo(first);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reachedCheck = new Promise<void>((resolve) => (reached = resolve));
    const asked: string[] = [];
    const read: ScmServiceDeps['read'] = async (directory, args) => {
      asked.push(directory);
      const command = args.join(' ');
      if (command === 'rev-parse --path-format=absolute --show-toplevel') {
        reached(); // the home check's read of git's top level
        await held;
        return `${directory}\n`;
      }
      if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`;
      if (command === 'remote -v') return '';
      throw new Error(`unexpected read: git ${command}`);
    };
    const service = new ScmService({
      view, read, pushRead: () => read, status: vi.fn(), mutate: vi.fn(), refresh: vi.fn(),
      captured: async () => ({ HOME: repo.home, CLAUDE_CONFIG_DIR: trust.configHome }), env: {}, emit: () => {},
    });
    const bus = fakeBus();
    registerScmHandlers(service, bus, () => ['/nonexistent-home-of-this-suite']);
    const answer = bus.invoke('scm.status', { appSessionId }, { client: endableClientRef('endpoint'), remote: true });
    await reachedCheck;
    movedTo(second);
    release();
    expect(await answer).toMatchObject({ ok: true, value: { directory: first } });
    expect(asked.filter((directory) => directory !== first)).toEqual([]);
  });
});
