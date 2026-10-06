// `scm.*` through the router: every command reaches the service with the session id as sent (a run with its kind),
// refusals arrive as values, a git timeout as `timeout` and anything else as `internal`.
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScmService } from './service';

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
const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame });
const event = { sender, senderFrame: mainFrame };
const appSessionId = 'a1111111-1111-4111-8111-111111111111';

describe('main answers scm.* through the router', () => {
  let service: { [K in Exclude<keyof ScmService, 'dispose'>]: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    vi.resetModules();
    electron.handlers.clear();
    electron.windows.clear();
    electron.windows.set(sender, { webContents: sender });
    service = {
      status: vi.fn(), stage: vi.fn(), unstage: vi.fn(), discard: vi.fn(), commit: vi.fn(), planPush: vi.fn(), planPr: vi.fn(), run: vi.fn(),
      cancel: vi.fn(), last: vi.fn(), prState: vi.fn(),
    };
    const { registerScmHandlers } = await import('./register');
    const { installRouter } = await import('../ipc/router');
    registerScmHandlers(service as unknown as ScmService);
    installRouter({ appUrl: APP_URL });
  });
  const invoke = (name: string, input?: unknown) => electron.handlers.get(`maws:cmd:${name}`)!(event, input);

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
      expect(service[name as keyof typeof inputs]).toHaveBeenCalledWith(input);
    }
    service.status.mockResolvedValue({
      directory: '/r', repository: false, trusted: false, trustKey: '/r', remotes: [], defaultRemote: null, defaultBase: null, gh: { state: 'missing' }, checkedAt: 'now',
    });
    expect(await invoke('scm.status', { appSessionId })).toMatchObject({ ok: true, value: { directory: '/r' } });
    expect(service.status).toHaveBeenCalledWith(appSessionId);
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
    expect(service.planPush).toHaveBeenCalledWith({ appSessionId, remote: 'origin' });
    const pr = { appSessionId, title: 'T', body: '', base: 'main', draft: true };
    expect(await invoke('scm.pr.plan', pr)).toEqual({ ok: true, value: expired });
    expect(service.planPr).toHaveBeenCalledWith(pr);
    expect(await invoke('scm.push', { appSessionId, token })).toEqual({ ok: true, value: { started: true, token } });
    expect(service.run).toHaveBeenLastCalledWith({ appSessionId, token }, 'push');
    expect(await invoke('scm.pr.create', { appSessionId, token })).toEqual({ ok: true, value: { started: true, token } });
    expect(service.run).toHaveBeenLastCalledWith({ appSessionId, token }, 'pr');
    expect(await invoke('scm.remote.cancel', { appSessionId, token })).toEqual({ ok: true, value: undefined });
    expect(service.cancel).toHaveBeenCalledWith({ appSessionId, token });
    expect(await invoke('scm.remote.last', { appSessionId })).toEqual({ ok: true, value: null });
    expect(service.last).toHaveBeenCalledWith(appSessionId);
    expect(await invoke('scm.pr.state', { appSessionId, refresh: true })).toMatchObject({ ok: true, value: { error: 'untrusted' } });
    expect(service.prState).toHaveBeenCalledWith({ appSessionId, refresh: true });
    // a token is a uuid: anything else never reaches the service
    expect(await invoke('scm.push', { appSessionId, token: 'push origin main' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(service.run).toHaveBeenCalledTimes(2);
  });

  it('answers timeout for a git timeout and internal for anything else', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GitTimeoutError } = await import('../git/runner'); // the module instance the router's handlers were loaded with
    service.commit.mockRejectedValue(new GitTimeoutError('git commit timed out after 60 s in /r'));
    expect(await invoke('scm.commit', { appSessionId, message: 'x', noVerify: false })).toEqual({ ok: false, error: { code: 'timeout', message: 'git commit timed out after 60 s in /r' } });
    service.stage.mockRejectedValue(new Error(`unknown app session: ${appSessionId}`));
    expect(await invoke('scm.stage', { appSessionId, paths: ['a'] })).toEqual({ ok: false, error: { code: 'internal', message: `unknown app session: ${appSessionId}` } });
    expect(await invoke('scm.stage', { appSessionId, paths: [] })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    logged.mockRestore();
  });
});
