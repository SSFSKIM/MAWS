import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionHarness } from '../../../test/support/session-harness';
import { sessionIdFor, summary } from '../../../test/support/index-fixture'; // P2-A
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

  // E3: the side namespace's two main commands; a screenshot's refusal and an oversized first message are invalid_input
  it('opens a side thread and sends to main through the router, refusing a bad screenshot as invalid_input naming it', async () => {
    const { summary, sessionIdFor } = await import('../../../test/support/index-fixture');
    h.trustDirectory(h.work);
    h.host.script = () => ({});
    const parent = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x3e3), directory: h.work })).record.appId;
    const anchor = { kind: 'file-line', locator: '/r/x.ts#L1', label: 'x.ts:1', path: '/r/x.ts', line: 1 };
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text: 'why?', screenshot: null } })).toMatchObject({ ok: true, value: { status: 'starting' } });
    const shot = { path: join(h.root, 'nowhere.png'), width: 1, height: 1 };
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text: 'why?', screenshot: shot } })).toMatchObject({
      ok: false, error: { code: 'invalid_input', message: 'screenshot: not found', issues: [{ path: ['from', 'screenshot'] }] },
    });
    expect(await invoke('side.sendToMain', { appSessionId: parent, anchor, text: 'look', screenshot: shot })).toMatchObject({
      ok: false, error: { code: 'invalid_input', message: 'screenshot: not found', issues: [{ path: ['screenshot'] }] },
    });
    const exchanges = Array.from({ length: 11 }, (_, i) => ({ question: `q${i}`, response: 'r'.repeat(100_000) }));
    expect(await invoke('side.thread.open', { appSessionId: parent, from: { kind: 'btw', exchanges, text: null } })).toMatchObject({
      ok: false, error: { code: 'invalid_input', issues: [{ path: ['from'] }] },
    });
    // the parent has no process in this host: its refusal goes back verbatim
    expect(await invoke('side.sendToMain', { appSessionId: parent, anchor, text: 'look', screenshot: null })).toMatchObject({ ok: false, error: { code: 'internal', message: `unknown session ${parent}` } });
  });

  // P2-A (X16): the acquisition through the router; the engine host's own host_unavailable keeps its code, so the
  // supervisor's banner returns for it as for the other launches
  it('acquires a record through the router, and relays the host’s host_unavailable with its code', async () => {
    h.trustDirectory(h.work);
    h.host.script = () => ({});
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x2a01), directory: h.work })).record;
    expect(await invoke('session.acquire', { appSessionId: record.appId, reason: 'send' })).toEqual({ ok: true, value: { status: 'ready', appSessionId: record.appId, launched: true, joined: false } });
    expect(await invoke('session.acquire', { appSessionId: record.appId, reason: 'mount' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const other = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x2a02), directory: h.work })).record;
    h.host.unavailable = true;
    try {
      expect(await invoke('session.acquire', { appSessionId: other.appId, reason: 'send' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    } finally {
      h.host.unavailable = false;
    }
  });

  it('answers an unknown session’s delete as internal', async () => {
    expect(await invoke('session.delete', { appSessionId: '00000000-0000-4000-8000-000000000000', stopIfLive: false })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('unknown app session') } });
  });
});
