// The caller at every place main turns a request into an outside act (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, the write rule's line 2, decisions 5, 13
// and 15, §D; the sequences P1 to P3; B10, B15): the keyed read, the copy "Open externally" opens and the copy a file's
// frame is drawn from, each through main's real router, with the app-window registry and main's page instances the real
// modules and the predicate the real `isAppPage` bound to the app's URL, as src/main/app.ts binds it. Remote lane B is the
// real adapter over the link's fake, which records every call and act. Each refusal stands beside its control: the
// same request from an app page of an owner sends the act. Electron is faked as in the router's suite. Every path, name
// and byte is invented.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTSIDE_FILES_CAPABILITY } from '@shared/files/outside';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import type { CallResult } from '../machines/remote/link';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const DEV_URL = 'http://localhost:5173/';
const APP = 'app-elsewhere';
const NOTES = '/srv/elsewhere/notes.txt';
const PDF = '/srv/elsewhere/ledger draft.pdf';
const PRIVATE_PDF = '/Users/someone/Documents/minutes.pdf'; // in a folder macOS protects there, which nobody opened yet
const REFUSAL = "path outside the session's directories"; // the files service's, as it crosses a call's answer
const SERVES = ['rl2.executor.machine', OUTSIDE_FILES_CAPABILITY];
const TEXT = 'an invented line outside the session’s folders\n';
const PDF_BYTES = Buffer.from('%PDF-1.4\n% an invented document\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

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
  openFile: typeof import('../files/open-file');
  laneB: typeof import('./remote');
  frames: typeof import('../file-frames');
};
let m: Modules;
let link: FakeLink;
let owners: Map<MachineRef, boolean | null>;
let opened: string[];
let logs: string[];
let dirs: string[];
let profile: string;
let stops: Array<() => void>;

let ids = 0;
/** A window of the app's origin with its top frame: the app window once registered, else a presentation or the repair window. */
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

const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** One page of `bytes` as `files.read` answers it, from `offset` for `length`, with the mark given. */
function pageOf(bytes: Buffer, args: Record<string, unknown>, mime: string, mark: Record<string, unknown> = {}) {
  const offset = typeof args.offset === 'number' ? args.offset : 0;
  const length = typeof args.length === 'number' ? args.length : 1024 * 1024;
  const slice = bytes.subarray(offset, offset + length);
  const text = mime.startsWith('text/');
  return {
    encoding: text ? 'utf8' : 'base64',
    content: text ? slice.toString('utf8') : slice.toString('base64'),
    bytes: bytes.length,
    offset,
    length: slice.length,
    truncated: offset + slice.length < bytes.length,
    mime,
    hash: args.hash === true ? hashOf(bytes) : null,
    utf8: args.hash === true ? text : null,
    ...mark,
  };
}

/**
 * The machine refuses every plain read of the files, and answers every page of `files.readOutside` from them; the one in
 * a protected folder only for a read that carries `open` (decision 18), refused `protected` otherwise.
 */
function machineServes(): void {
  link.answers.set('files.read', (): CallResult => ({ ok: false, error: { code: 'internal', message: REFUSAL } }));
  link.onAct = (act: FakeAct) => {
    const args = act.request.args as Record<string, unknown>;
    if (act.request.action !== 'files.readOutside') return;
    if (args.path === PRIVATE_PDF && args.open !== true) return act.settle({ state: 'failed', error: { code: 'internal', message: 'the file is in a folder macOS protects', issues: { refusal: 'protected' } } });
    const mark = { named: true, outside: { real: args.path, writable: true } };
    act.settle({ state: 'done', result: args.path === NOTES ? pageOf(Buffer.from(TEXT, 'utf8'), args, 'text/plain', mark) : pageOf(PDF_BYTES, args, 'application/pdf', mark) });
  };
}
const outsideActs = () => link.acts.filter((act) => act.request.action === 'files.readOutside');
const plainReads = () => link.calls.filter((call) => call.name === 'files.read');

beforeEach(async () => {
  vi.resetModules();
  electron.handlers.clear();
  electron.windows.clear();
  dirs = [];
  stops = [];
  logs = [];
  opened = [];
  const scratch = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  profile = scratch('maws-outside-route-profile-');
  const copies = scratch('maws-outside-route-copies-');
  m = {
    router: await import('../ipc/router'),
    windows: await import('../windows'),
    clients: await import('../ipc/clients'),
    openFile: await import('../files/open-file'),
    laneB: await import('./remote'),
    frames: await import('../file-frames'),
  };
  link = new FakeLink();
  link.relink(SERVES);
  owners = new Map([[MINI, true]]);
  const { router, openFile, clients, laneB, frames } = m;
  const remote = (machine: MachineRef) => (machine === MINI ? link : null);
  // remote lane B as src/main/app.ts makes it: the predicate bound to the app's URL, and the roster's word on ownership
  const adapter = laneB.createRemoteLaneB({
    local: LOCAL,
    layout: { get: () => null, onChange: () => () => {} },
    remote,
    onRemote: () => () => {},
    emit: () => {},
    isAppPage: (client: ClientRef) => openFile.isAppPage(client, DEV_URL),
    owns: (machine: MachineRef) => owners.get(machine) ?? null,
    openPath: async (path: string) => (opened.push(path), ''),
    tempDir: () => copies,
    env: {},
    timing: { sendPendingMs: 60_000 },
    log: (line: string) => void logs.push(line),
  } as Parameters<typeof laneB.createRemoteLaneB>[0]);
  stops.push(() => adapter.stop());
  const base = async () => ({ ok: false, error: { code: 'host_unavailable', message: 'not on the manager’s path in this suite' } }) as CommandResult<CommandName>;
  router.installRouter({ appUrl: DEV_URL, local: LOCAL, dispatchToHost: vi.fn(), remote: laneB.routeLaneB(base, remote, adapter), machine: { kind: 'host' } });
  router.guardCommand(openFile.APP_PAGE_ONLY, openFile.appPageOnly(DEV_URL));
  router.guardCommand(openFile.OPENS_FROM_APP_PAGE_ONLY, openFile.openFromAppPageOnly(DEV_URL)); // M3's fix wave (Decision Log 26)
  // as src/main/app.ts registers it: the asking caller passed on
  router.registerMainHandler('remote.openCopy', async (input, { target, client }) => {
    if (target !== LOCAL && target !== input.machine) throw new Error('remote.openCopy: its source is on another machine');
    const result = await (adapter.artifacts.openCopy as (input: unknown, client: ClientRef) => Promise<CommandResult<'remote.openCopy'>>)(input, client);
    if (!result.ok) throw new router.CommandFailure(result.error);
    return result.value;
  });
  const fileFrames = frames.startFileFrames({
    local: LOCAL,
    read: async () => {
      throw new Error('no file of this Mac is framed in this suite');
    },
    copy: (machine, source, sink, max, options) => adapter.artifacts.copyInto(machine, source, sink, max, options),
    page: (client) => {
      const page = clients.pageOf(client);
      return page && { id: page.id, send: () => {} };
    },
    userData: () => profile,
    register: router.registerMainHandler,
    log: (line) => void logs.push(line),
  });
  stops.push(fileFrames.stop);
  machineServes();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The callers that are no app page: a window of the app's origin that is no app window, dispatchLocal's and main's own. */
function noPageCallers() {
  const presentation = windowAt().event;
  return {
    'a window that is no app window': (name: string, input: unknown, machine?: MachineRef) => (machine === undefined ? invoke(presentation, name, input) : invoke(presentation, name, input, machine)),
    dispatchLocal: (name: string, input: unknown, machine: MachineRef = LOCAL) => m.router.dispatchLocal(name as CommandName, input, { client: { id: 'remote:1/page:3.1', onGone: () => () => {} } as unknown as ClientRef, target: machine }),
    invokeOwn: (name: string, input: unknown, machine: MachineRef = LOCAL) => m.router.invokeOwn(name as CommandName, input, { client: m.clients.mainClient, target: machine }),
  };
}

const keyed = { appSessionId: APP, path: NOTES, offset: 0, length: 4096, named: true };

describe('the keyed read (P1, P2; B10)', () => {
  it('from a window that is no app window, through dispatchLocal and through invokeOwn: the plain read’s answer, and no act', async () => {
    for (const [who, ask] of Object.entries(noPageCallers())) {
      expect([who, await ask('files.read', keyed, MINI)]).toEqual([who, { ok: false, error: { code: 'internal', message: REFUSAL } }]);
    }
    expect(plainReads()).toHaveLength(3);
    expect(link.acts).toEqual([]);
  });

  it('the control: the same read from an app page of an owner sends files.readOutside and answers the file', async () => {
    expect(await invoke(appWindow().event, 'files.read', keyed, MINI)).toMatchObject({ ok: true, value: { content: TEXT, named: true, outside: { real: NOTES, writable: true } } });
    expect(outsideActs()).toHaveLength(1);
  });

  it('from an app page of a person the roster says does not own the machine, or does not yet say: no act, the ownership sentence (P2; R10)', async () => {
    for (const owner of [false, null]) {
      owners.set(MINI, owner);
      expect([owner, await invoke(appWindow().event, 'files.read', keyed, MINI)]).toEqual([owner, { ok: false, error: { code: 'internal', message: 'Not opened: only mini’s owners can', issues: { refusal: 'owners-only' } } }]);
    }
    expect(link.acts).toEqual([]);
  });
});

describe('“Open externally” on an outside file (remote.openCopy; P1, P2; decision 15)', () => {
  const copyOf = (path: string) => ({ machine: MINI, source: { appSessionId: APP, path } });

  it('passes the asking caller on, as src/main/app.ts registers it', () => {
    expect(readFileSync(join(import.meta.dirname, '../app.ts'), 'utf8')).toContain('remoteLaneB.artifacts.openCopy(input, client)');
  });

  it('from a window that is no app window, through dispatchLocal and through invokeOwn: the plain read’s refusal, no act, nothing opened', async () => {
    for (const [who, ask] of Object.entries(noPageCallers())) {
      expect([who, await ask('remote.openCopy', copyOf(NOTES))]).toMatchObject([who, { ok: false, error: { code: 'internal', message: REFUSAL } }]);
    }
    expect(link.acts).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('from an app page of a person the roster does not say owns the machine: the plain read’s refusal, no act (P2)', async () => {
    for (const owner of [false, null]) {
      owners.set(MINI, owner);
      expect([owner, await invoke(appWindow().event, 'remote.openCopy', copyOf(NOTES))]).toMatchObject([owner, { ok: false, error: { code: 'internal', message: REFUSAL } }]);
    }
    expect(link.acts).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('the control: from an app page of an owner the copy is read by the act, written byte for byte and opened', async () => {
    expect(await invoke(appWindow().event, 'remote.openCopy', copyOf(NOTES))).toEqual({ ok: true, value: { opened: true, message: null } });
    expect(outsideActs().length).toBeGreaterThan(0);
    expect(opened).toHaveLength(1);
    expect(readFileSync(opened[0]!, 'utf8')).toBe(TEXT);
    // the copy's plain read is today's to the byte (Decision Log 27): it may be carried to any peer
    expect(plainReads().filter((call) => ['named', 'agent', 'open', 'raw'].some((key) => key in (call.input as object)))).toEqual([]);
  });

  // The branch review (scalpel-3#1; Decision Log 33 (2)): a copy's act is bound, whole, to the channel of its first page
  it('a copy of two pages whose channel is replaced after the first: no page goes on the new channel, and nothing is opened', async () => {
    const big = Buffer.from('E'.repeat(300_000), 'utf8');
    let first = true;
    link.onAct = (act: FakeAct) => {
      if (act.request.action !== 'files.readOutside') return;
      act.settle({ state: 'done', result: pageOf(big, act.request.args as Record<string, unknown>, 'text/plain', { named: true, outside: { real: NOTES, writable: true } }) });
      if (first) {
        first = false;
        link.lose();
        link.relink([...SERVES]);
      }
    };
    expect(await invoke(appWindow().event, 'remote.openCopy', copyOf(NOTES))).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(outsideActs()).toHaveLength(1);
    expect(opened).toEqual([]);
  });

  it('with the channel gone between the plain read’s refusal and the act: answers at once, and no act is sent (Decision Log 27)', async () => {
    link.answers.set('files.read', (): CallResult => (link.lose(), { ok: false, error: { code: 'internal', message: REFUSAL } }));
    expect(await invoke(appWindow().event, 'remote.openCopy', copyOf(NOTES))).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(link.acts).toEqual([]);
    expect(opened).toEqual([]);
  });
});

describe('a file’s frame of an outside file (layout.frameFile; P1 to P3; decision 15; B15)', () => {
  const frame = { appSessionId: APP, path: PDF, agent: true };
  const copiesListed = () => readdirSync(join(profile, 'frame-copies'));

  it('the control: from an app page of an owner, the copy is read by files.readOutside in pages with the tab’s agent, the plain read today’s, and a token is issued over the nameless descriptor', async () => {
    expect(await invoke(appWindow().event, 'layout.frameFile', frame, MINI)).toMatchObject({ ok: true, value: { status: 'ready', framed: 'pdf' } });
    expect(outsideActs().length).toBeGreaterThan(0);
    for (const act of outsideActs()) {
      expect(act.request.args).toMatchObject({ appSessionId: APP, path: PDF, hash: true, agent: true });
      expect(act.request.args).not.toHaveProperty('named');
      expect(act.request.args).not.toHaveProperty('open'); // main adds no open of its own (Decision Log 26)
    }
    // the copy's plain read is today's to the byte (Decision Log 27): it may be carried to any peer
    for (const call of plainReads()) expect(Object.keys(call.input as object).sort()).toEqual(['appSessionId', 'hash', 'length', 'offset', 'path']);
    expect(copiesListed()).toEqual([]);
  });

  it('a frame asked without the agent’s mark reads without it', async () => {
    await invoke(appWindow().event, 'layout.frameFile', { appSessionId: APP, path: PDF }, MINI);
    for (const act of outsideActs()) expect(act.request.args).not.toHaveProperty('agent');
  });

  it('a frame in a protected folder there: asked without open, refused protected; asked with open, drawn, the open on its act alone (Decision Log 26)', async () => {
    const page = appWindow().event;
    expect(await invoke(page, 'layout.frameFile', { appSessionId: APP, path: PRIVATE_PDF }, MINI)).toMatchObject({ ok: false, error: { issues: { refusal: 'protected' } } });
    for (const act of outsideActs()) expect(act.request.args).not.toHaveProperty('open');
    const before = outsideActs().length;
    expect(await invoke(page, 'layout.frameFile', { appSessionId: APP, path: PRIVATE_PDF, open: true }, MINI)).toMatchObject({ ok: true, value: { status: 'ready', framed: 'pdf' } });
    const withOpen = outsideActs().slice(before);
    expect(withOpen.length).toBeGreaterThan(0);
    for (const act of withOpen) expect(act.request.args).toMatchObject({ path: PRIVATE_PDF, open: true });
    for (const call of plainReads()) expect(call.input).not.toHaveProperty('open');
  });

  it('a frame asked with open by a caller that is no app page is refused before anything is read; the same request from an app page is drawn (Decision Log 26)', async () => {
    const withOpen = { appSessionId: APP, path: PRIVATE_PDF, open: true };
    for (const [who, ask] of Object.entries(noPageCallers())) {
      expect([who, await ask('layout.frameFile', withOpen, MINI)]).toEqual([who, { ok: false, error: { code: 'forbidden_sender', message: 'layout.frameFile with open may only be invoked by the app window' } }]);
    }
    expect(link.calls).toEqual([]);
    expect(link.acts).toEqual([]);
    // the control
    expect(await invoke(appWindow().event, 'layout.frameFile', withOpen, MINI)).toMatchObject({ ok: true, value: { status: 'ready' } });
  });

  it('registers the guard of a frame’s open as src/main/app.ts does', () => {
    expect(readFileSync(join(import.meta.dirname, '../app.ts'), 'utf8')).toContain('guardCommand(OPENS_FROM_APP_PAGE_ONLY, openFromAppPageOnly(appUrl))');
  });

  it('from a window that is no app window, through dispatchLocal and through invokeOwn: plain reads alone, no act, and the command fails with the read’s refusal (P1)', async () => {
    for (const [who, ask] of Object.entries(noPageCallers())) {
      expect([who, await ask('layout.frameFile', frame, MINI)]).toMatchObject([who, { ok: false, error: { message: REFUSAL } }]);
    }
    expect(plainReads().length).toBeGreaterThanOrEqual(3);
    expect(link.acts).toEqual([]);
  });

  it('with the channel gone between the plain read’s refusal and the act: answers at once, and no act is sent (Decision Log 27)', async () => {
    link.answers.set('files.read', (): CallResult => (link.lose(), { ok: false, error: { code: 'internal', message: REFUSAL } }));
    expect(await invoke(appWindow().event, 'layout.frameFile', frame, MINI)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(link.acts).toEqual([]);
    expect(copiesListed()).toEqual([]);
  });

  it('from an app page of a person the roster does not say owns the machine: no act, the read’s refusal (P2)', async () => {
    for (const owner of [false, null]) {
      owners.set(MINI, owner);
      expect([owner, await invoke(appWindow().event, 'layout.frameFile', frame, MINI)]).toMatchObject([owner, { ok: false, error: { message: REFUSAL } }]);
    }
    expect(link.acts).toEqual([]);
  });

  it('a file inside the folders is copied by plain calls for every caller, and no act', async () => {
    link.answers.set('files.read', (input) => ({ ok: true, output: pageOf(PDF_BYTES, input, 'application/pdf') }));
    expect(await invoke(appWindow().event, 'layout.frameFile', frame, MINI)).toMatchObject({ ok: true, value: { status: 'ready', framed: 'pdf' } });
    expect(await noPageCallers()['a window that is no app window']('layout.frameFile', frame, MINI)).toMatchObject({ ok: true, value: { status: 'ready' } });
    expect(link.acts).toEqual([]);
  });

  it('no log line of a frame’s copy holds the path, on the act’s route as on the call’s', async () => {
    const big = Buffer.alloc(600 * 1024, 0x25);
    link.onAct = (act) => act.settle({ state: 'done', result: pageOf(big, act.request.args as Record<string, unknown>, 'application/pdf', { named: true, outside: { real: PDF, writable: true } }) });
    let changing = 0;
    const answerChanging = link.onAct;
    link.onAct = (act) => {
      // the second pass's first page answers a file that changed, so the copy logs it read again
      if (++changing === 2) act.settle({ state: 'done', result: { ...pageOf(big, act.request.args as Record<string, unknown>, 'application/pdf', { named: true, outside: { real: PDF, writable: true } }), hash: 'c'.repeat(64) } });
      else answerChanging(act);
    };
    expect(await invoke(appWindow().event, 'layout.frameFile', frame, MINI)).toMatchObject({ ok: true, value: { status: 'ready' } });
    expect(logs.some((line) => line.includes('read again'))).toBe(true);
    // the call's route: a file inside the folders whose first read is too large for one answer, read in pages
    link.answers.set('files.read', (input) => (typeof input.length === 'number' && input.length > 128 * 1024 ? { ok: false, error: { code: 'too-large' } } : { ok: true, output: pageOf(big, input, 'application/pdf') }));
    expect(await invoke(appWindow().event, 'layout.frameFile', frame, MINI)).toMatchObject({ ok: true, value: { status: 'ready' } });
    expect(logs.some((line) => line.includes('read in pages'))).toBe(true);
    for (const line of logs) expect(line).not.toContain('ledger draft');
  });

  it('a copy whose page ends while it is under way records no token and leaves no copy; no act is sent after (P3)', async () => {
    let held: FakeAct | null = null;
    const answer = link.onAct;
    link.onAct = (act) => (held === null ? (held = act) : answer(act));
    const { event } = appWindow();
    const asked = invoke(event, 'layout.frameFile', frame, MINI);
    await vi.waitFor(() => expect(held).not.toBeNull());
    event.sender.emit('destroyed'); // the page ends
    answer(held!);
    expect(await asked).toMatchObject({ ok: false, error: { message: 'layout.frameFile: the window that asked has gone' } });
    const sent = link.acts.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(link.acts).toHaveLength(sent);
    expect(copiesListed()).toEqual([]);
  });

  it('a copy whose link drops under it fails the command, and no act is sent after the failure (P3)', async () => {
    let held: FakeAct | null = null;
    link.onAct = (act) => void (held = act);
    const asked = invoke(appWindow().event, 'layout.frameFile', frame, MINI);
    await vi.waitFor(() => expect(held).not.toBeNull());
    link.lose(); // the channel ends: a channel-bound act out ends unknown
    expect(await asked).toMatchObject({ ok: false });
    expect(link.acts).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(link.acts).toHaveLength(1);
    expect(copiesListed()).toEqual([]);
  });
});
