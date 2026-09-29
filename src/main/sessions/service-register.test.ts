import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionHarness } from '../../../test/support/session-harness';
import { commandChannel } from '@shared/ipc/schema';

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
const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame });
const event = { sender, senderFrame: mainFrame };

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string; issues?: unknown } };

// The session service through main's router, as the renderer's `window.maws.invoke` reaches it.
describe('main answers the session service commands through the router', () => {
  let h: SessionHarness;
  const invoke = (name: string, input: unknown) => electron.handlers.get(commandChannel(name as never))!(event, input) as Promise<Result>;

  beforeAll(async () => {
    electron.windows.set(sender, { webContents: sender });
    h = await new SessionHarness().start();
    const { registerSessionServiceHandlers } = await import('./service-register');
    const { installRouter } = await import('../ipc/router');
    registerSessionServiceHandlers(h.service);
    installRouter({ appUrl: APP_URL });
  });
  afterAll(() => h.dispose());

  it('creates, lists, patches and starts; an invalid patch is invalid_input naming the field', async () => {
    const created = await invoke('session.create', { projectId: null, location: { kind: 'directory', path: h.work } });
    expect(created.ok).toBe(true);
    const id = (created.value as { appSessionId: string }).appSessionId;
    expect(await invoke('session.intent.list', undefined)).toMatchObject({ ok: true, value: { intents: [{ appSessionId: id }] } });
    const bad = await invoke('session.intent.patch', { appSessionId: id, patch: { location: { kind: 'directory', path: join(h.root, 'missing') } } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('location: directory not found'), issues: [{ path: ['patch', 'location'] }] } });
    expect(await invoke('session.start', { appSessionId: id, message: null, options: {} })).toMatchObject({ ok: true, value: { status: 'needs_trust' } });
    expect(await invoke('session.trust.check', { directory: h.work })).toMatchObject({ ok: true, value: { trustKey: h.work, trusted: false } });
  });

  it('refuses a patch while a start is in flight as internal `starting`', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({ ready: false });
    const id = ((await invoke('session.create', { projectId: null, location: { kind: 'directory', path: h.work } })).value as { appSessionId: string }).appSessionId;
    expect(await invoke('session.start', { appSessionId: id, message: null, options: {} })).toMatchObject({ ok: true, value: { status: 'starting' } });
    expect(await invoke('session.intent.patch', { appSessionId: id, patch: { model: 'opus' } })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringMatching(/^starting/) } });
  });

  it('answers an unknown session’s delete as internal', async () => {
    expect(await invoke('session.delete', { appSessionId: '00000000-0000-4000-8000-000000000000', stopIfLive: false })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('unknown app session') } });
  });
});
