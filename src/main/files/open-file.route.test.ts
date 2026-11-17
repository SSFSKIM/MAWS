// The sender's guard and Open File… through main's real router (UX wave U6e,
// docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, write rule line 2, decision 9, §C; A6; R2, R4),
// registered as the app registers them (src/main/app.ts): `guardCommand(APP_PAGE_ONLY, appPageOnly)` (U6e's two names
// and, since U6f, the three acts of another machine on a file outside a session's folders) and the handler of
// `layout.openFile`, whose grant is main's own call (`invokeOwn`). Electron is faked as
// in the router's suite; the app-window registry and main's page instances are the real modules. The host dispatcher
// and the connection manager are spied, and a second profile's daemon stands behind the manager as a writer of whatever
// reaches it, over a scratch file. The page's side is the renderer's own client (src/renderer/src/ipc/client.ts) over a
// bridge that invokes as the preload does.
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort } from '@shared/client/port';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { HostDispatch, MainContext, RemoteDispatch } from '../ipc/router';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const SECOND_PROFILE = 'OtherProfileRef0000000' as MachineRef; // another profile's daemon on this Mac: a machine reached with no `remote`
const DEV_URL = 'http://localhost:5173/';
const HASH = 'a'.repeat(64);

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown, machine?: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
}));

type Modules = {
  router: typeof import('../ipc/router');
  windows: typeof import('../windows');
  clients: typeof import('../ipc/clients');
  openFile: typeof import('./open-file');
  client: typeof import('../../renderer/src/ipc/client');
};
let m: Modules;
let dispatchToHost: ReturnType<typeof vi.fn<HostDispatch>>;
let remote: ReturnType<typeof vi.fn<RemoteDispatch>>;
let pick: ReturnType<typeof vi.fn<ClientPort['pick']>>;
let opened: { input: unknown; target: MachineRef }[];
let scratch: string;

// A window of the app's origin with its top frame: the app window once registered, else a presentation or the repair
// window (the same origin and preload, outside `appWindows()`).
let ids = 0;
function windowAt(url = DEV_URL) {
  const mainFrame = { url, parent: null };
  const webContents = Object.assign(new EventEmitter(), { id: ++ids, mainFrame, isDestroyed: () => false });
  const win = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  electron.windows.set(webContents, win);
  return { event: { sender: webContents, senderFrame: mainFrame }, win };
}
function appWindow() {
  const made = windowAt();
  m.windows.registerAppWindow(made.win as never);
  return made;
}

const invoke = (event: unknown, name: string, input?: unknown, ...machine: [unknown?]) => {
  const handler = electron.handlers.get(`maws:cmd:${name}`);
  if (!handler) throw new Error(`no ipcMain handler for ${name}`);
  return handler(event, input, ...machine) as Promise<CommandResult<CommandName>>;
};

beforeEach(async () => {
  vi.resetModules();
  electron.handlers.clear();
  electron.windows.clear();
  scratch = mkdtempSync(join(tmpdir(), 'maws-open-file-route-'));
  m = {
    router: await import('../ipc/router'),
    windows: await import('../windows'),
    clients: await import('../ipc/clients'),
    openFile: await import('./open-file'),
    client: await import('../../renderer/src/ipc/client'),
  };
  dispatchToHost = vi.fn<HostDispatch>(async (_owner, name, input) => {
    if (name === 'files.grant') return { ok: true, value: { status: 'granted', path: (input as { path: string }).path } };
    return { ok: true, value: { status: 'ok', hash: HASH } };
  });
  // a second profile's daemon behind the connection manager: it writes whatever save reaches it
  remote = vi.fn<RemoteDispatch>(async (_machine, _name, input) => {
    const { path, content } = input as { path: string; content: string };
    writeFileSync(path, content);
    return { ok: true, value: { status: 'ok', hash: HASH } };
  });
  pick = vi.fn<ClientPort['pick']>(async () => ({ paths: ['/work/notes/roadmap.md'] }));
  opened = [];
  const { router, openFile, clients } = m;
  router.installRouter({ appUrl: DEV_URL, local: LOCAL, dispatchToHost, remote, machine: { kind: 'host' } });
  // as src/main/app.ts registers them
  router.guardCommand(openFile.APP_PAGE_ONLY, openFile.appPageOnly(DEV_URL));
  router.registerMainHandler('layout.openFile', (input, ctx) => {
    opened.push({ input, target: ctx.target });
    return openFile.openChosenFile(input, ctx, {
      port: { pick },
      isAppPage: (client) => openFile.isAppPage(client, DEV_URL),
      grant: (grant) => router.invokeOwn('files.grant', grant, { client: clients.mainClient, target: LOCAL }) as Promise<CommandResult<'files.grant'>>,
    });
  });
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const save = (path: string) => ({ appSessionId: 'app-1', path, content: 'written by a sender the guard refuses', expectedHash: HASH, real: path });

describe('the sender’s guard: files.writeOutside and layout.openFile only for a live page of an app window', () => {
  it('forwards files.writeOutside from the app window’s top frame once, its input unchanged, with the asking page', async () => {
    const { event } = appWindow();
    const input = save('/work/notes/roadmap.md');
    await expect(invoke(event, 'files.writeOutside', input)).resolves.toEqual({ ok: true, value: { status: 'ok', hash: HASH } });
    expect(dispatchToHost).toHaveBeenCalledExactlyOnceWith('machine', 'files.writeOutside', input, expect.objectContaining({ id: `page:${event.sender.id}.1` }));
    expect(remote).not.toHaveBeenCalled();
  });

  it('refuses it forbidden_sender, calling neither dispatcher, from a subframe, a sender that is no window, a page at another origin and a window that is no app window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const top = appWindow();
    const presentation = windowAt();
    const senders = {
      subframe: { sender: top.event.sender, senderFrame: { url: DEV_URL, parent: top.event.senderFrame } },
      'no window': { sender: Object.assign(new EventEmitter(), { id: ++ids, isDestroyed: () => false }), senderFrame: { url: DEV_URL, parent: null } },
      'another origin': (() => {
        const made = windowAt('https://example.com/');
        m.windows.registerAppWindow(made.win as never);
        return made.event;
      })(),
      'no app window': presentation.event,
    };
    for (const [name, event] of Object.entries(senders)) {
      await expect(invoke(event, 'files.writeOutside', save('/work/notes/roadmap.md')), name).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    }
    await expect(invoke(presentation.event, 'files.writeOutside', save('/work/notes/roadmap.md'))).resolves.toEqual({
      ok: false,
      error: { code: 'forbidden_sender', message: 'files.writeOutside may only be invoked by the app window' },
    });
    expect(dispatchToHost).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('refuses it through dispatchLocal and invokeOwn with a client that is no page', async () => {
    const remoteClient = { id: 'remote:1/page:3.1', onGone: () => () => {} } as unknown as MainContext['client'];
    const refused = { ok: false, error: { code: 'forbidden_sender', message: 'files.writeOutside may only be invoked by the app window' } };
    await expect(m.router.dispatchLocal('files.writeOutside', save('/work/notes/roadmap.md'), { client: remoteClient, target: LOCAL })).resolves.toEqual(refused);
    await expect(m.router.invokeOwn('files.writeOutside', save('/work/notes/roadmap.md'), { client: m.clients.mainClient, target: LOCAL })).resolves.toEqual(refused);
    expect(dispatchToHost).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('refuses a window that is no app window aiming at a second profile’s daemon: the link is not called and that daemon writes nothing', async () => {
    const file = join(scratch, 'notes.txt');
    writeFileSync(file, 'as it was\n');
    const presentation = windowAt();
    await expect(invoke(presentation.event, 'files.writeOutside', save(file), SECOND_PROFILE)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(remote).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('as it was\n');
    // the same save from the app window reaches it, so the stand-in is a writer indeed
    await expect(invoke(appWindow().event, 'files.writeOutside', save(file), SECOND_PROFILE)).resolves.toMatchObject({ ok: true });
    expect(remote).toHaveBeenCalledOnce();
    expect(readFileSync(file, 'utf8')).toBe('written by a sender the guard refuses');
  });

  // the review's finding 1: dispatchLocal and invokeOwn have no sender check, so the guard reads the page's origin itself
  it('refuses, through dispatchLocal and invokeOwn, the page an app window navigated to at another origin: no host, link or chooser call', async () => {
    const { event } = appWindow();
    event.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    event.senderFrame.url = 'https://example.com/landing';
    const foreign = { client: m.clients.clientOf(event.sender as never), target: LOCAL };
    for (const send of [m.router.dispatchLocal, m.router.invokeOwn]) {
      await expect(send('files.writeOutside', save('/work/notes/roadmap.md'), foreign)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
      await expect(send('layout.openFile', { appSessionId: 'app-1' }, foreign)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    }
    expect(dispatchToHost).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    // a reload at the app's own URL is a new instance of an app page, which passes
    event.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    event.senderFrame.url = DEV_URL;
    await expect(m.router.dispatchLocal('files.writeOutside', save('/work/notes/roadmap.md'), { client: m.clients.clientOf(event.sender as never), target: LOCAL })).resolves.toMatchObject({ ok: true });
    expect(dispatchToHost).toHaveBeenCalledOnce();
  });

  it('leaves files.write as it was: forwarded from a window that is no app window', async () => {
    const { appSessionId, path, content, expectedHash } = save('/work/project/notes.txt');
    await expect(invoke(windowAt().event, 'files.write', { appSessionId, path, content, expectedHash })).resolves.toEqual({ ok: true, value: { status: 'ok', hash: HASH } });
    expect(dispatchToHost).toHaveBeenCalledExactlyOnceWith('machine', 'files.write', { appSessionId, path, content, expectedHash }, expect.anything());
  });

  it('refuses files.grant from every page, the app window’s included: main alone sends it', async () => {
    await expect(invoke(appWindow().event, 'files.grant', { appSessionId: 'app-1', path: '/work/notes/roadmap.md' })).resolves.toEqual({
      ok: false,
      error: { code: 'forbidden_sender', message: 'files.grant may only be invoked by main' },
    });
    expect(dispatchToHost).not.toHaveBeenCalled();
  });

  it('refuses layout.openFile from a window that is no app window: no chooser, no handler, no grant', async () => {
    await expect(invoke(windowAt().event, 'layout.openFile', { appSessionId: 'app-1' })).resolves.toEqual({
      ok: false,
      error: { code: 'forbidden_sender', message: 'layout.openFile may only be invoked by the app window' },
    });
    expect(opened).toEqual([]);
    expect(pick).not.toHaveBeenCalled();
    expect(dispatchToHost).not.toHaveBeenCalled();
  });
});

// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, the write rule's line 2,
// decision 7; M2's "The guard"): the open, the chooser's listing and the pick of a file outside a session's folders on
// another machine are the app window's alone, as its save is, before anything is forwarded
describe('the sender’s guard: files.readOutside, files.listOutside and files.chooseOutside', () => {
  const NEW: Array<[string, Record<string, unknown>]> = [
    ['files.readOutside', { appSessionId: 'app-1', path: '/srv/elsewhere/notes.txt' }],
    ['files.listOutside', { appSessionId: 'app-1', path: '/srv/elsewhere' }],
    ['files.chooseOutside', { appSessionId: 'app-1', path: '/srv/elsewhere/notes.txt' }],
  ];

  it('are the guard’s, with U6e’s two, as the app registers it', () => {
    expect([...m.openFile.APP_PAGE_ONLY].sort()).toEqual(['files.chooseOutside', 'files.listOutside', 'files.readOutside', 'files.writeOutside', 'layout.openFile']);
    expect(readFileSync(join(import.meta.dirname, '../app.ts'), 'utf8')).toContain('guardCommand(APP_PAGE_ONLY, appPageOnly(appUrl))');
  });

  it('are refused forbidden_sender, calling neither dispatcher, from a subframe, a window that is no app window and through dispatchLocal', async () => {
    const top = appWindow();
    const subframe = { sender: top.event.sender, senderFrame: { url: DEV_URL, parent: top.event.senderFrame } };
    const presentation = windowAt().event;
    const remoteClient = { id: 'remote:1/page:3.1', onGone: () => () => {} } as unknown as MainContext['client'];
    for (const [name, input] of NEW) {
      const refused = { ok: false, error: { code: 'forbidden_sender', message: `${name} may only be invoked by the app window` } };
      await expect(invoke(subframe, name, input), `${name} from a subframe`).resolves.toEqual(refused);
      await expect(invoke(presentation, name, input), `${name} from a window that is no app window`).resolves.toEqual(refused);
      await expect(invoke(presentation, name, input, SECOND_PROFILE), `${name} aimed at another machine`).resolves.toEqual(refused);
      await expect(m.router.dispatchLocal(name as CommandName, input as never, { client: remoteClient, target: LOCAL }), `${name} through dispatchLocal`).resolves.toEqual(refused);
    }
    expect(dispatchToHost).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('are forwarded once, their input unchanged, from the app window’s top frame (the control)', async () => {
    remote.mockImplementation(async () => ({ ok: true, value: { status: 'granted', path: '/srv/elsewhere/notes.txt' } }) as CommandResult<CommandName>);
    for (const [name, input] of NEW) {
      const { event } = appWindow();
      await expect(invoke(event, name, input), name).resolves.toMatchObject({ ok: true });
      expect(dispatchToHost).toHaveBeenLastCalledWith('machine', name, input, expect.objectContaining({ id: `page:${event.sender.id}.1` }));
      await expect(invoke(event, name, input, SECOND_PROFILE), `${name} to another machine`).resolves.toMatchObject({ ok: true });
      expect(remote).toHaveBeenLastCalledWith(SECOND_PROFILE, name, input, expect.anything());
    }
    expect(dispatchToHost).toHaveBeenCalledTimes(NEW.length);
  });
});

describe('layout.openFile from the page’s client, through the router, to its handler', () => {
  // The renderer's client over a bridge that invokes as the preload does, from the given page's top frame.
  const pageClient = (event: unknown) => {
    const bridge = { localMachine: LOCAL, invoke: (name: string, input: unknown, target?: unknown) => invoke(event, name, input, target), on: () => () => {}, pathForFile: () => '' };
    return m.client.createClient(() => bridge as unknown as PreloadBridge);
  };

  it('for a session of this Mac: the handler gets the bare id and the local target, the grant carries the bare id, the page gets the granted path', async () => {
    const { event } = appWindow();
    const ipc = pageClient(event);
    await expect(ipc.invoke('layout.openFile', { appSessionId: addressOf(LOCAL, 'app-1' as AppSessionId) })).resolves.toEqual({ ok: true, value: { status: 'opened', path: '/work/notes/roadmap.md' } });
    expect(opened).toEqual([{ input: { appSessionId: 'app-1' }, target: LOCAL }]);
    expect(pick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: `page:${event.sender.id}.1` }), { kind: 'file', multiple: false });
    expect(dispatchToHost).toHaveBeenCalledExactlyOnceWith('machine', 'files.grant', { appSessionId: 'app-1', path: '/work/notes/roadmap.md' }, m.clients.mainClient);
  });

  it('for a session of another machine: the router answers its own refusal of a client command, and neither the handler nor the port runs', async () => {
    const ipc = pageClient(appWindow().event);
    await expect(ipc.invoke('layout.openFile', { appSessionId: addressOf(SECOND_PROFILE, 'app-1' as AppSessionId) })).resolves.toEqual({
      ok: false,
      error: { code: 'host_unavailable', message: 'layout.openFile: not available for a session on another machine yet' },
    });
    expect(opened).toEqual([]);
    expect(pick).not.toHaveBeenCalled();
    expect(dispatchToHost).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('answers refused unavailable when the daemon does not know files.grant (an older build), and nothing is granted', async () => {
    dispatchToHost.mockImplementation(async (_owner, name) => ({ ok: false, error: { code: 'unknown_command', message: `unknown command ${name}` } }));
    const ipc = pageClient(appWindow().event);
    await expect(ipc.invoke('layout.openFile', { appSessionId: addressOf(LOCAL, 'app-1' as AppSessionId) })).resolves.toEqual({ ok: true, value: { status: 'refused', reason: 'unavailable' } });
  });
});
