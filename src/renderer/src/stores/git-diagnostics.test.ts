import { describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import { createGitDiagnosticsStore, describeGit, describeGitFile } from './git-diagnostics';

const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  repoRoot: '/repo',
  gitDir: '/repo/.git',
  commonDir: '/repo/.git',
  isWorktree: false,
  branch: 'main',
  head: 'abcdef0123456789abcdef0123456789abcdef01',
  upstream: 'origin/main',
  remoteUrl: 'git@github.com:o/r.git',
  ahead: 2,
  behind: 1,
  dirty: true,
  files: [
    { path: 'src/a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'notes.txt', oldPath: null, index: '?', worktree: '?', untracked: true },
  ],
  stashCount: 0,
  checkedAt: '2026-09-28T10:00:00.000Z',
  ...over,
});

function fakeClient(answers: Partial<Record<CommandName, (input: unknown) => CommandResult<CommandName> | Promise<CommandResult<CommandName>>>> = {}) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const client = {
    invoke: vi.fn(async (name: CommandName, input: unknown) => (await answers[name]?.(input)) ?? ({ ok: true, value: undefined } as CommandResult<CommandName>)),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    invoke: client.invoke,
    calls: (name: CommandName) => client.invoke.mock.calls.filter(([n]) => n === name).map(([, input]) => input),
    event: <N extends EventName>(name: N, payload: EventPayload<N>) => listeners.get(name)?.forEach((l) => l(payload)),
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

const ok = (value: unknown) => ({ ok: true, value }) as CommandResult<CommandName>;

describe('git diagnostics', () => {
  it('watches the selected directory, shows its status, and takes git.changed for the same root only', async () => {
    const fake = fakeClient({ 'git.watch': () => ok(status()) });
    const store = createGitDiagnosticsStore(fake.client);
    const disconnect = store.getState().connect();
    await store.getState().select('/repo/src');
    expect(fake.calls('git.watch')).toEqual([{ directory: '/repo/src' }]);
    expect(store.getState()).toMatchObject({ directory: '/repo/src', status: status(), error: null });

    const fresh = status({ files: [...status().files, { path: '.c4-accept', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    fake.event('git.changed', { repoRoot: '/elsewhere', status: status({ repoRoot: '/elsewhere' }), reason: 'worktree' });
    expect(store.getState().status).toEqual(status());
    fake.event('git.changed', { repoRoot: '/repo', status: fresh, reason: 'worktree' });
    expect(store.getState().status).toEqual(fresh);

    disconnect();
    expect(fake.calls('git.unwatch')).toEqual([{ directory: '/repo/src' }]);
    expect(fake.listening()).toBe(0);
  });

  it('releases the previous directory when another is selected or the selection is cleared', async () => {
    const fake = fakeClient({ 'git.watch': (input) => ok(status({ repoRoot: (input as { directory: string }).directory })) });
    const store = createGitDiagnosticsStore(fake.client);
    store.getState().connect();
    await store.getState().select('/a');
    await store.getState().select('/b');
    await store.getState().select(null);
    expect(fake.calls('git.watch')).toEqual([{ directory: '/a' }, { directory: '/b' }]);
    expect(fake.calls('git.unwatch')).toEqual([{ directory: '/a' }, { directory: '/b' }]);
    expect(store.getState()).toMatchObject({ directory: null, status: null });
  });

  it('unwatches a watch that answers after the selection moved on, and keeps the newer selection', async () => {
    let answerA: (r: CommandResult<CommandName>) => void = () => {};
    const fake = fakeClient({
      'git.watch': (input) =>
        (input as { directory: string }).directory === '/a' ? new Promise((resolve) => (answerA = resolve)) : ok(status({ repoRoot: '/b' })),
    });
    const store = createGitDiagnosticsStore(fake.client);
    store.getState().connect();
    const first = store.getState().select('/a');
    await store.getState().select('/b');
    answerA(ok(status({ repoRoot: '/a' })));
    await first;
    expect(store.getState()).toMatchObject({ directory: '/b', status: { repoRoot: '/b' } });
    expect(fake.calls('git.unwatch')).toEqual([{ directory: '/a' }]); // the stale watch, balanced; /a was never shown
  });

  it('shows why a watch failed, and needs no unwatch for it', async () => {
    const fake = fakeClient({ 'git.watch': () => ({ ok: false, error: { code: 'internal', message: 'not a git repository' } }) });
    const store = createGitDiagnosticsStore(fake.client);
    store.getState().connect();
    await store.getState().select('/tmp');
    expect(store.getState()).toMatchObject({ directory: '/tmp', status: null, error: 'not a git repository' });
    await store.getState().select(null);
    expect(fake.calls('git.unwatch')).toEqual([]);
  });

  it('describes branch, ahead/behind and the dirty count, and each file by its XY code', () => {
    expect(describeGit(status())).toBe('main · ahead 2 / behind 1 · dirty · 2 files');
    expect(describeGit(status({ upstream: null, ahead: 0, behind: 0, dirty: false, files: [] }))).toBe('main · no upstream · clean');
    expect(describeGit(status({ branch: null, files: [status().files[0]] }))).toBe('detached abcdef0 · ahead 2 / behind 1 · dirty · 1 file');
    expect(describeGitFile(status().files[0])).toBe('.M src/a.ts');
    expect(describeGitFile(status().files[1])).toBe('?? notes.txt');
    expect(describeGitFile({ path: 'new.ts', oldPath: 'old.ts', index: 'R', worktree: '.', untracked: false })).toBe('R. old.ts → new.ts');
  });
});
