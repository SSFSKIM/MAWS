import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { GitFixture } from '../../../test/support/git-fixture';
import { registerGitHandlers } from './register';
import type { ExecFileFn } from './runner';
import { GitService } from './service';

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

// The asking page, as main's router hands a handler its ClientRef (src/main/ipc/clients.ts): a reload ends this
// document's ref and the page asks with the next generation's.
describe('main answers git.* on the services bus', () => {
  let repo: GitFixture;
  let dispose: () => void;
  let bus: FakeBus;
  let page: EndableClientRef;
  beforeEach(async () => {
    bus = fakeBus();
    page = endableClientRef('page:7.1');
    repo = await GitFixture.create();
  });
  afterEach(() => {
    dispose();
    repo.dispose();
    vi.restoreAllMocks();
  });

  async function install(options: { execFile?: ExecFileFn } = {}) {
    const service = new GitService({ env: repo.serviceEnv(), ...options });
    dispose = () => service.dispose();
    registerGitHandlers(service, bus);
    return service;
  }
  const invoke = (name: CommandName, input?: unknown) => bus.invoke(name, input, page) as Promise<Result>;

  it('answers status, branches, diff and log, and watch then unwatch', async () => {
    await install();
    await repo.write('README.md', 'hello\nworld\n');
    expect(await invoke('git.status', { directory: repo.root })).toMatchObject({ ok: true, value: { repoRoot: repo.root, branch: 'main', dirty: true } });
    expect(await invoke('git.branches', { directory: repo.root })).toMatchObject({ ok: true, value: { current: 'main' } });
    expect(await invoke('git.diff', { directory: repo.root, scope: 'worktree' })).toMatchObject({ ok: true, value: { files: [{ path: 'README.md', insertions: 1 }] } });
    expect(await invoke('git.log', { directory: repo.root, limit: 1 })).toMatchObject({ ok: true, value: { commits: [{ subject: 'initial', parents: [] }] } });
    expect(await invoke('git.watch', { directory: repo.root })).toMatchObject({ ok: true, value: { repoRoot: repo.root } });
    expect(await invoke('git.unwatch', { directory: repo.root })).toEqual({ ok: true, value: undefined });
    expect(await invoke('git.unwatch', { directory: '/never/watched' })).toEqual({ ok: true, value: undefined });
  });

  it('holds watches for the requesting client and releases them when its page navigates or closes', async () => {
    const service = await install();
    const release = vi.spyOn(service, 'release');
    const watch = vi.spyOn(service, 'watch');
    await invoke('git.watch', { directory: repo.root });
    await invoke('git.watch', { directory: repo.root });
    expect(watch.mock.calls.map((call) => call[1])).toEqual(['page:7.1', 'page:7.1']);
    page.end(); // a reload: the new page watches afresh
    page = endableClientRef('page:7.2');
    expect(release).toHaveBeenCalledWith('page:7.1');
    expect(release).toHaveBeenCalledTimes(1); // followed once, however many watches
    await invoke('git.watch', { directory: repo.root });
    expect(watch.mock.calls[2][1]).toBe('page:7.2');
    page.end(); // the page closes
    expect(release).toHaveBeenLastCalledWith('page:7.2');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('fails internal "not a git repository" outside a repository, and invalid_input for a limit out of range', async () => {
    await install();
    expect(await invoke('git.status', { directory: '/tmp' })).toEqual({ ok: false, error: { code: 'internal', message: 'not a git repository' } });
    expect(await invoke('git.watch', { directory: '/tmp' })).toEqual({ ok: false, error: { code: 'internal', message: 'not a git repository' } });
    expect(await invoke('git.log', { directory: repo.root, limit: 501 })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('answers timeout when git is killed at its deadline', async () => {
    const hung: ExecFileFn = (_file, _args, _options, callback) => {
      queueMicrotask(() => callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' as const, code: null }), '', ''));
    };
    await install({ execFile: hung });
    expect(await invoke('git.status', { directory: repo.root })).toEqual({
      ok: false,
      error: { code: 'timeout', message: `git rev-parse timed out after 10 s in ${repo.root}` },
    });
  });
});
