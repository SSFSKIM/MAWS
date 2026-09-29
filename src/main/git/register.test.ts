import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import type { ExecFileFn } from './runner';

// Electron is faked as in the router's own test: one recorded ipcMain handler per channel, one app window.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => void electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
}));

const APP_URL = 'http://localhost:5173/';
const mainFrame = { url: APP_URL, parent: null };
const sender = { mainFrame };
const event = { sender, senderFrame: mainFrame };

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

describe('main answers git.* through the router', () => {
  let repo: GitFixture;
  let dispose: () => void;
  beforeEach(async () => {
    vi.resetModules();
    electron.handlers.clear();
    electron.windows.clear();
    electron.windows.set(sender, { webContents: sender });
    repo = await GitFixture.create();
  });
  afterEach(() => {
    dispose();
    repo.dispose();
    vi.restoreAllMocks();
  });

  async function install(options: { execFile?: ExecFileFn } = {}) {
    const { GitService } = await import('./service');
    const { registerGitHandlers } = await import('./register');
    const { installRouter } = await import('../ipc/router');
    const service = new GitService(options);
    dispose = () => service.dispose();
    registerGitHandlers(service);
    installRouter({ appUrl: APP_URL });
  }
  const invoke = (name: string, input?: unknown) => electron.handlers.get(`maws:cmd:${name}`)!(event, input) as Promise<Result>;

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

  it('fails internal "not a git repository" outside a repository, and invalid_input for a limit out of range', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {}); // the router logs a handler's throw
    await install();
    expect(await invoke('git.status', { directory: '/tmp' })).toEqual({ ok: false, error: { code: 'internal', message: 'not a git repository' } });
    expect(await invoke('git.watch', { directory: '/tmp' })).toEqual({ ok: false, error: { code: 'internal', message: 'not a git repository' } });
    expect(await invoke('git.log', { directory: repo.root, limit: 501 })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(logged).toHaveBeenCalled();
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
