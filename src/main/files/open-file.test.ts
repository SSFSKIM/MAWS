// Open File…'s handler and the guard's predicate (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md,
// §C, decisions 3 and 9; the sequences C1 to C4). The client port is faked, so no panel is raised; each pick and each
// grant is a promise the case releases. The predicate runs over main's real page instances (`clientOf`) and app-window
// registry (`registerAppWindow`), with fake web contents and windows.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort, PickAnswer } from '@shared/client/port';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import type { CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { clientOf, mainClient } from '../ipc/clients';
import { registerAppWindow } from '../windows';
import { appPageOnly, isAppPage, openChosenFile, type OpenFileDeps } from './open-file';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const SESSION = 'app-1' as AppSessionId;
const CHOSEN = '/work/notes/link-to-roadmap.md';
const REAL = '/work/notes/plans/roadmap.md';

// A promise the case settles by hand.
function held<T>() {
  let settle!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => ((settle = resolve), (fail = reject)));
  return { promise, settle, fail };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type Grant = OpenFileDeps['grant'];
const granted = (path = REAL): CommandResult<'files.grant'> => ({ ok: true, value: { status: 'granted', path } });

function depsOf(options: { pick?: ClientPort['pick']; grant?: Grant; page?: () => boolean } = {}) {
  const pick = vi.fn<ClientPort['pick']>(options.pick ?? (async () => ({ paths: [CHOSEN] })));
  const grant = vi.fn<Grant>(options.grant ?? (async () => granted()));
  const page = vi.fn<(client: ClientRef) => boolean>(options.page ?? (() => true));
  const deps: OpenFileDeps = { port: { pick }, isAppPage: page, grant };
  return { deps, pick, grant, page };
}

let clients = 0;
const asker = () => ({ client: endableClientRef(`page:${++clients}.1`), target: LOCAL });

describe('layout.openFile: the chooser, then the grant', () => {
  it('asks the port for one file on the asker, grants the chosen path for the bare session id, and answers the granted real path', async () => {
    const { deps, pick, grant } = depsOf();
    const ctx = asker();
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'opened', path: REAL });
    expect(pick).toHaveBeenCalledExactlyOnceWith(ctx.client, { kind: 'file', multiple: false }); // no filter, no starting folder
    expect(grant).toHaveBeenCalledExactlyOnceWith({ appSessionId: SESSION, path: CHOSEN });
  });

  it('answers cancelled, granting nothing, for a cancelled pick, a pick with no client to ask and a pick with no path', async () => {
    for (const answer of [{ cancelled: true }, { noClient: true }, { paths: [] }] as PickAnswer[]) {
      const { deps, grant } = depsOf({ pick: async () => answer });
      await expect(openChosenFile({ appSessionId: SESSION }, asker(), deps), JSON.stringify(answer)).resolves.toEqual({ status: 'cancelled' });
      expect(grant).not.toHaveBeenCalled();
    }
  });

  it('answers refused unavailable for a pick that throws, granting nothing, and the asker may ask again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const { deps, grant, pick } = depsOf({
      pick: async () => {
        if (fail) throw new Error('the panel failed');
        return { paths: [CHOSEN] };
      },
    });
    const ctx = asker();
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'refused', reason: 'unavailable' });
    expect(grant).not.toHaveBeenCalled();
    fail = false;
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'opened', path: REAL });
    expect(pick).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  // C1
  it('C1: the asker stopped being an app page while the chooser was open (a reload, a closed window): cancelled, and no grant is sent', async () => {
    const choice = held<PickAnswer>();
    let live = true;
    const { deps, grant, page } = depsOf({ pick: () => choice.promise, page: () => live });
    const ctx = asker();
    const answering = openChosenFile({ appSessionId: SESSION }, ctx, deps);
    await tick();
    live = false;
    choice.settle({ paths: [CHOSEN] });
    await expect(answering).resolves.toEqual({ status: 'cancelled' });
    expect(page).toHaveBeenCalledWith(ctx.client);
    expect(grant).not.toHaveBeenCalled();
  });

  // C2
  it('C2: a second ask of the same page while its chooser is open answers cancelled at once; one chooser; another page has its own', async () => {
    const choice = held<PickAnswer>();
    const { deps, pick, grant } = depsOf({ pick: () => choice.promise });
    const ctx = asker();
    const first = openChosenFile({ appSessionId: SESSION }, ctx, deps);
    await tick();
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'cancelled' });
    expect(pick).toHaveBeenCalledOnce();
    const other = asker();
    const second = openChosenFile({ appSessionId: SESSION }, other, deps);
    await tick();
    expect(pick.mock.calls.map(([client]) => client)).toEqual([ctx.client, other.client]);
    choice.settle({ paths: [CHOSEN] });
    await expect(first).resolves.toEqual({ status: 'opened', path: REAL });
    await expect(second).resolves.toEqual({ status: 'opened', path: REAL });
    expect(grant).toHaveBeenCalledTimes(2);
    // the chooser closed: the same page asks again
    pick.mockImplementation(async () => ({ cancelled: true }));
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'cancelled' });
    expect(pick).toHaveBeenCalledTimes(3);
  });

  it('C2: the page asks again at once while its grant is still in flight: cancelled, one grant', async () => {
    const answer = held<CommandResult<'files.grant'>>();
    const { deps, pick, grant } = depsOf({ grant: () => answer.promise });
    const ctx = asker();
    const first = openChosenFile({ appSessionId: SESSION }, ctx, deps);
    await tick();
    expect(grant).toHaveBeenCalledOnce();
    await expect(openChosenFile({ appSessionId: SESSION }, ctx, deps)).resolves.toEqual({ status: 'cancelled' });
    answer.settle(granted());
    await expect(first).resolves.toEqual({ status: 'opened', path: REAL });
    expect([pick.mock.calls.length, grant.mock.calls.length]).toEqual([1, 1]);
  });

  // C3
  it('C3: a grant the daemon refuses with an error, does not know, does not answer in time or that throws: refused unavailable, nothing opened', async () => {
    const failures: Grant[] = [
      async () => ({ ok: false, error: { code: 'unknown_command', message: 'files.grant' } }), // a daemon of an older build
      async () => ({ ok: false, error: { code: 'timeout', message: 'machine did not answer files.grant in 10000 ms' } }),
      async () => ({ ok: false, error: { code: 'host_unavailable', message: 'machine is not running' } }),
      async () => ({ ok: false, error: { code: 'internal', message: 'could not write the grants file' } }),
      async () => {
        throw new Error('the transport broke');
      },
    ];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const grant of failures) {
      const { deps } = depsOf({ grant });
      await expect(openChosenFile({ appSessionId: SESSION }, asker(), deps)).resolves.toEqual({ status: 'refused', reason: 'unavailable' });
    }
    expect(logged).toHaveBeenCalledOnce(); // the throw alone is a fault; an answered refusal is the daemon's
    logged.mockRestore();
  });

  // C4
  it('C4: the daemon refuses the chosen path as no regular file (a folder, a package): refused not-a-file', async () => {
    const { deps, grant } = depsOf({ pick: async () => ({ paths: ['/work/Tools.app'] }), grant: async () => ({ ok: true, value: { status: 'refused', reason: 'not-a-file' } }) });
    await expect(openChosenFile({ appSessionId: SESSION }, asker(), deps)).resolves.toEqual({ status: 'refused', reason: 'not-a-file' });
    expect(grant).toHaveBeenCalledExactlyOnceWith({ appSessionId: SESSION, path: '/work/Tools.app' });
  });
});

// Fake web contents and windows, shaped as `clientOf` and `registerAppWindow` read them.
let contentsIds = 0;
const windowsOpen: EventEmitter[] = [];
function windowWithPage() {
  const webContents = Object.assign(new EventEmitter(), { id: ++contentsIds, isDestroyed: () => false });
  const win = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  windowsOpen.push(win);
  return { webContents, win };
}
function appWindowWithPage() {
  const made = windowWithPage();
  registerAppWindow(made.win as never);
  return made;
}
afterEach(() => {
  for (const win of windowsOpen.splice(0)) win.emit('closed');
});

describe('the guard’s predicate: a live page of an app window', () => {
  it('holds for the page of an app window, and for no page of a window the registry does not hold (a presentation, the repair window)', () => {
    const app = appWindowWithPage();
    const presentation = windowWithPage();
    expect(isAppPage(clientOf(app.webContents as never))).toBe(true);
    expect(isAppPage(clientOf(presentation.webContents as never))).toBe(false);
  });

  it('holds for no client that is not a page: main itself, another machine’s asker', () => {
    expect(isAppPage(mainClient)).toBe(false);
    expect(isAppPage(endableClientRef('remote:1/page:3.1'))).toBe(false);
  });

  it('stops holding for a page instance once it navigated away, and for every page of a closed window', () => {
    const app = appWindowWithPage();
    const before = clientOf(app.webContents as never);
    app.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    const after = clientOf(app.webContents as never);
    expect([isAppPage(before), isAppPage(after)]).toEqual([false, true]);
    app.win.emit('closed');
    expect(isAppPage(after)).toBe(false);
  });

  it('refuses every other asker forbidden_sender, naming the command, and lets an app page through', () => {
    const app = appWindowWithPage();
    const presentation = windowWithPage();
    expect(appPageOnly('files.writeOutside', {}, { client: clientOf(app.webContents as never), target: LOCAL })).toBeUndefined();
    expect(appPageOnly('files.writeOutside', {}, { client: clientOf(presentation.webContents as never), target: LOCAL })).toEqual({
      code: 'forbidden_sender',
      message: 'files.writeOutside may only be invoked by the app window',
    });
    expect(appPageOnly('layout.openFile', {}, { client: mainClient, target: LOCAL })).toEqual({ code: 'forbidden_sender', message: 'layout.openFile may only be invoked by the app window' });
  });

  it('C1 over the real predicate: the page reloads while the chooser is open, so no grant is sent', async () => {
    const app = appWindowWithPage();
    const choice = held<PickAnswer>();
    const { deps, grant } = depsOf({ pick: () => choice.promise });
    const ctx = { client: clientOf(app.webContents as never), target: LOCAL };
    const answering = openChosenFile({ appSessionId: SESSION }, ctx, { ...deps, isAppPage });
    await tick();
    app.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    choice.settle({ paths: [CHOSEN] });
    await expect(answering).resolves.toEqual({ status: 'cancelled' });
    expect(grant).not.toHaveBeenCalled();
  });
});
